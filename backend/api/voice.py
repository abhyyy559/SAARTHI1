"""Voice endpoints — Sarvam-compatible STT/TTS with honest browser fallback (§19).

Without SARVAM_API_KEY the API says so explicitly (provider=browser-fallback)
and the frontend uses the Web Speech API. Rural-accessible either way.

Latency instrumentation: transcribe/synthesize/synthesize-stream all report
``X-TTFB-Ms`` (internal time-to-first-byte) and log a structured
``voice_ttfb_ms=...`` line so the demo path can be held to < 1.5 s.
"""
import json
import logging
import time

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from ..adapters import stt_provider, tts_provider
from ..adapters.registry import AdapterUnavailable
from ..utils.speak_sanitize import sanitize_for_tts

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_TTS_CHARS = 2000
# Chunks are emitted as their own provider call returns — sentence-chunked
# progressive generation. Sarvam bulbul has no streaming API, so this is
# honestly labelled "sentence-chunked", never "streaming".
STREAM_CHUNK_CHARS = 450


def _ttfb_headers(ms: float) -> dict:
    return {"X-TTFB-Ms": f"{ms:.1f}"}


def _log_ttfb(endpoint: str, ms: float, provider: str) -> None:
    logger.info("voice_ttfb_ms=%.1f endpoint=%s provider=%s", ms, endpoint, provider)


@router.post("/api/voice/transcribe")
async def transcribe(audio: UploadFile = File(..., alias="file"), language: str = "en") -> JSONResponse:
    t0 = time.perf_counter()
    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(f"Voice upload too large ({len(audio_bytes)} bytes). "
                    "Maximum is 10 MB per upload."),
        )
    try:
        text, provider = await stt_provider.transcribe(audio_bytes, audio.filename or "audio.webm", language)
        ms = (time.perf_counter() - t0) * 1000
        _log_ttfb("transcribe", ms, provider)
        return JSONResponse(
            {"text": text, "provider": provider, "using_browser_speech": False},
            headers=_ttfb_headers(ms),
        )
    except AdapterUnavailable:
        ms = (time.perf_counter() - t0) * 1000
        _log_ttfb("transcribe", ms, "browser-fallback")
        return JSONResponse(
            {"text": "", "provider": "browser-fallback", "using_browser_speech": True},
            headers=_ttfb_headers(ms),
        )


@router.post("/api/voice/synthesize")
async def synthesize(payload: dict) -> JSONResponse:
    t0 = time.perf_counter()
    text = payload.get("text", "")
    language = payload.get("language", "en")
    if len(text) > MAX_TTS_CHARS:
        raise HTTPException(
            status_code=413,
            detail=(f"TTS text too long ({len(text)} characters). "
                    f"Maximum is {MAX_TTS_CHARS} characters per request."),
        )
    # Sanitize for both Sarvam and browser fallback
    text = sanitize_for_tts(text)
    try:
        audio_b64, provider = await tts_provider.synthesize(text, language)
        ms = (time.perf_counter() - t0) * 1000
        _log_ttfb("synthesize", ms, provider)
        return JSONResponse(
            {"audio_base64": audio_b64, "mime": "audio/wav",
             "provider": provider, "client_speech": False},
            headers=_ttfb_headers(ms),
        )
    except AdapterUnavailable:
        ms = (time.perf_counter() - t0) * 1000
        _log_ttfb("synthesize", ms, "browser-fallback")
        return JSONResponse(
            {"text": text, "audio_url": None, "provider": "browser-fallback", "client_speech": True},
            headers=_ttfb_headers(ms),
        )


@router.post("/api/voice/synthesize-stream")
async def synthesize_stream(payload: dict):
    """Progressive TTS: NDJSON chunks, each emitted as its provider call returns.

    Line format per chunk::
        {"done": false, "chunk": 0, "chunks": 3, "audio_base64": "...",
         "mime": "audio/wav", "provider": "sarvam-live"}
    Final trailer::
        {"done": true, "provider": "sarvam-live", "chunks": 3,
         "streaming": "sentence-chunked", "text_chars": 1234}

    The first chunk is fetched BEFORE the response headers are sent, so the
    ``X-TTFB-Ms`` header carries the real measured time-to-first-chunk.
    Without a configured provider this returns the same honest
    browser-fallback JSON as /synthesize (never ``sarvam-live``).
    """
    t0 = time.perf_counter()
    text = payload.get("text", "")
    language = payload.get("language", "en")
    if len(text) > MAX_TTS_CHARS:
        raise HTTPException(
            status_code=413,
            detail=(f"TTS text too long ({len(text)} characters). "
                    f"Maximum is {MAX_TTS_CHARS} characters per request."),
        )
    gen = tts_provider.synthesize_chunked(text, language)
    try:
        first_audio, provider, _, total = await gen.__anext__()
    except (AdapterUnavailable, StopAsyncIteration):
        await gen.aclose()
        ms = (time.perf_counter() - t0) * 1000
        _log_ttfb("synthesize-stream", ms, "browser-fallback")
        return JSONResponse(
            {"text": sanitize_for_tts(text), "audio_url": None,
             "provider": "browser-fallback", "client_speech": True},
            headers=_ttfb_headers(ms),
        )
    ms = (time.perf_counter() - t0) * 1000
    _log_ttfb("synthesize-stream", ms, provider)

    async def body():
        try:
            yield json.dumps({"done": False, "chunk": 0, "chunks": total,
                              "audio_base64": first_audio, "mime": "audio/wav",
                              "provider": provider}) + "\n"
            emitted = 1
            async for audio_b64, prov, i, _ in gen:
                yield json.dumps({"done": False, "chunk": i, "chunks": total,
                                  "audio_base64": audio_b64, "mime": "audio/wav",
                                  "provider": prov}) + "\n"
                emitted += 1
        except AdapterUnavailable:
            # Partial audio already emitted; say so honestly in the trailer.
            yield json.dumps({"done": True, "provider": "browser-fallback",
                              "error": "provider-failed-mid-stream",
                              "chunks_emitted": emitted,
                              "streaming": "sentence-chunked"}) + "\n"
            return
        finally:
            await gen.aclose()
        yield json.dumps({"done": True, "provider": provider, "chunks": total,
                          "streaming": "sentence-chunked",
                          "text_chars": len(text)}) + "\n"

    return StreamingResponse(
        body(),
        media_type="application/x-ndjson",
        headers={**_ttfb_headers(ms), "X-Provider": provider,
                 "Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/voice/status")
async def voice_status() -> dict:
    return {"stt": stt_provider.provider_name(), "tts": tts_provider.provider_name()}
