"""Voice endpoints — Sarvam-compatible STT/TTS with honest browser fallback (§19).

Without SARVAM_API_KEY the API says so explicitly (provider=browser-fallback)
and the frontend uses the Web Speech API. Rural-accessible either way.

Latency instrumentation: transcribe/synthesize/synthesize-stream all report
``X-TTFB-Ms`` (internal time-to-first-byte) and log a structured
``voice_ttfb_ms=...`` line so the demo path can be held to < 1.5 s.
transcribe-stream additionally logs ``voice_stream_first_partial_ms=...`` —
the time from socket accept to the first interim transcript, i.e. the number
the < 1 s STT budget is measured against.
"""
import asyncio
import json
import logging
import time

from fastapi import APIRouter, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse

from ..adapters import stt_provider, tts_provider
from ..adapters.registry import AdapterUnavailable
from ..utils.speak_sanitize import expand_spoken_forms, sanitize_for_tts

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


def _spoken_fallback_text(text: str, language: str) -> str:
    """Sanitized + spoken-form-expanded text for the browser speechSynthesis path.

    The frontend speaks `text` itself when no provider is configured, so it
    gets the same number/unit expansion Sarvam-bound text gets. An
    unsupported language falls back to English expansion — never a 500,
    never Tamil.
    """
    clean = sanitize_for_tts(text)
    try:
        return expand_spoken_forms(clean, language)
    except ValueError:
        logger.warning("unsupported TTS language %r in voice fallback; expanding as en",
                       language)
        return expand_spoken_forms(clean, "en")


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
            {"text": _spoken_fallback_text(text, language), "audio_url": None,
             "provider": "browser-fallback", "client_speech": True},
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
            {"text": _spoken_fallback_text(text, language), "audio_url": None,
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


@router.websocket("/api/voice/transcribe-stream")
async def transcribe_stream(websocket: WebSocket, language: str = "en"):
    """Streaming STT relay: browser -> this socket -> Sarvam streaming STT.

    Browser protocol (JSON text frames):
      -> {"audio": "<base64 16kHz PCM>"}   mic frames, ~4 per second
      -> {"flush": true}                   user stopped; finalize now
      <- {"partial": "..."}                interim transcript (live)
      <- {"final": "..."}                  final transcript after flush
      <- {"error": "<code>", "message": "..."}  honest failure

    The Sarvam leg is the provider's WebSocket streaming API (16 kHz PCM in,
    partial transcripts out) — the only path that can put a first interim on
    screen in < 1 s. Without a configured key this socket closes immediately
    with an error frame and the frontend uses on-device recognition instead.
    """
    t0 = time.perf_counter()
    await websocket.accept()
    if not stt_provider.streaming_available():
        await websocket.send_json({"error": "browser-fallback",
                                   "message": "No STT provider configured"})
        await websocket.close()
        return
    try:
        session = await stt_provider.open_stream(language)
    except AdapterUnavailable as exc:
        await websocket.send_json({"error": "provider-unavailable", "message": str(exc)})
        await websocket.close()
        return

    first_partial_ms: float | None = None

    async def pump_sarvam():
        nonlocal first_partial_ms
        try:
            async for kind, text in session:
                if kind == "partial":
                    if first_partial_ms is None:
                        first_partial_ms = (time.perf_counter() - t0) * 1000
                        logger.info("voice_stream_first_partial_ms=%.1f", first_partial_ms)
                    await websocket.send_json({"partial": text})
                elif kind == "error":
                    await websocket.send_json({"error": "provider-error", "message": text})
        except Exception as exc:  # socket already gone — nothing to report to
            logger.debug("transcribe-stream pump ended: %s", exc)

    pump = asyncio.ensure_future(pump_sarvam())
    try:
        while True:
            try:
                msg = await websocket.receive_json()
            except WebSocketDisconnect:
                break
            if not isinstance(msg, dict):
                continue
            if msg.get("audio"):
                await session.send_audio(msg["audio"])
            elif msg.get("flush"):
                final = await session.flush()
                await websocket.send_json({"final": final})
                break
    except AdapterUnavailable as exc:
        try:
            await websocket.send_json({"error": "provider-error", "message": str(exc)})
        except Exception:
            pass
    except Exception as exc:
        logger.warning("transcribe-stream relay error: %s", exc)
    finally:
        pump.cancel()
        try:
            await session.aclose()
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass


@router.get("/api/voice/status")
async def voice_status() -> dict:
    # NOTE: no `stt_streaming` field here on purpose — streaming availability
    # is exactly "a key is configured", i.e. stt == "sarvam-live", and an
    # existing backend test pins this payload's exact shape. The frontend
    # treats stt == "sarvam-live" as streaming-eligible.
    return {"stt": stt_provider.provider_name(), "tts": tts_provider.provider_name()}
