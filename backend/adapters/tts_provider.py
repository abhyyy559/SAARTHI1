"""TTS provider — Sarvam-compatible HTTP with honest browser fallback.

Env: SARVAM_API_KEY, SARVAM_TTS_URL (default https://api.sarvam.ai/text-to-speech),
SARVAM_TTS_MODEL (default bulbul:v2). Without a key -> BROWSER_FALLBACK marker
and the frontend speaks via speechSynthesis.
"""
from __future__ import annotations

import base64
import logging

import httpx

from .. import config
from ..utils.speak_sanitize import sanitize_for_tts, split_sentences
from .registry import LIVE, UNCONFIGURED, AdapterUnavailable, report

logger = logging.getLogger(__name__)

NAME = "tts"
BROWSER_FALLBACK = "browser-fallback"


def provider_name() -> str:
    return "sarvam-live" if config.SARVAM_API_KEY else BROWSER_FALLBACK


# --- shared HTTP client (connection reuse) ---------------------------------
# synthesize_chunked() fires one request per sentence-chunk; without reuse each
# pays a fresh TCP+TLS handshake to api.sarvam.ai (~100-300 ms). One client for
# the process keeps every chunk after the first on a warm connection.

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


async def synthesize(text: str, language: str = "en-IN") -> tuple[str, str]:
    """Returns (audio_base64_wav, provider). Raises AdapterUnavailable when unconfigured."""
    # Sanitize text for TTS
    original_text = text
    text = sanitize_for_tts(text)
    if len(original_text) > len(text) * 1.1:  # >10% reduction
        logger.info(f"TTS sanitized: {len(original_text)} -> {len(text)} chars ({int((1 - len(text)/len(original_text))*100)}% reduction)")
    
    key = config.SARVAM_API_KEY
    if not key:
        report(NAME, UNCONFIGURED, "SARVAM_API_KEY not set — browser fallback")
        raise AdapterUnavailable("browser-fallback")
    lang = {"en": "en-IN", "hi": "hi-IN", "te": "te-IN"}.get(language, language)
    try:
        # TTS latency audit (2026-09-21): the bulbul request carries no padding
        # or quality knobs that inflate latency — inputs, language, model,
        # speaker. Latency scales with input length, so the lever is chunk
        # sizing (see synthesize_chunked): the first chunk is kept small so
        # first audio beats the < 2 s budget while playback pipelines the rest.
        # _http() reuses one connection for the whole process instead of paying
        # a fresh TCP+TLS handshake per chunk (~100-300 ms each).
        resp = await _http().post(
            config.SARVAM_TTS_URL,
            headers={"api-subscription-key": key},
            json={"inputs": [text], "target_language_code": lang,
                  "model": config.SARVAM_TTS_MODEL, "speaker": config.SARVAM_TTS_SPEAKER},
        )
        resp.raise_for_status()
        audios = (resp.json().get("audios") or [])
        if not audios:
            raise AdapterUnavailable("empty TTS response")
        raw = base64.b64decode(audios[0])
    except AdapterUnavailable:
        raise
    except Exception as exc:
        report(NAME, UNCONFIGURED, f"provider error: {type(exc).__name__} — browser fallback")
        raise AdapterUnavailable(f"TTS provider failed: {exc}") from exc
    report(NAME, LIVE, f"synthesized {len(text)} chars ({lang})")
    return base64.b64encode(raw).decode("ascii"), "sarvam-live"


async def synthesize_chunked(text: str, language: str = "en-IN",
                             first_chunk_chars: int = 220, chunk_chars: int = 450):
    """Yield (audio_base64, provider, index, total) per sentence-chunk.

    HONESTY NOTE: Sarvam bulbul has no streaming API — this is
    sentence-chunked progressive generation, NOT provider streaming. Each
    chunk is yielded as soon as its own synthesize() call completes, so a
    streaming endpoint can emit audio progressively instead of waiting for
    the whole text. Raises AdapterUnavailable if no chunk could be made.

    LATENCY: the FIRST chunk is capped at first_chunk_chars (default 220).
    Bulbul latency grows with input length, so the small first chunk is what
    lets first audio beat the < 2 s budget; playback pipelines the remaining
    full-size chunks while they generate. One extra provider call per answer
    is the trade — worth it for voice turns.

    Chunking happens on the RAW text (then each chunk is sanitized): the
    whole-text sanitize_for_tts() truncates at 600 chars, which would
    silently drop safety advice on long texts.
    """
    pieces = [p for p in split_sentences(text, max_chars=min(first_chunk_chars, chunk_chars))]
    chunks: list[str] = []
    cur, first_done = "", False
    for raw in pieces:
        clean = sanitize_for_tts(raw)
        if not clean:
            continue
        limit = chunk_chars if first_done else first_chunk_chars
        if cur and len(cur) + 1 + len(clean) > limit:
            chunks.append(cur)
            cur, first_done = clean, True
        else:
            cur = clean if not cur else f"{cur} {clean}"
    if cur:
        chunks.append(cur)
    if not chunks:
        report(NAME, UNCONFIGURED, "empty text after sanitize — browser fallback")
        raise AdapterUnavailable("browser-fallback")
    for i, chunk in enumerate(chunks):
        audio_b64, provider = await synthesize(chunk, language)
        yield audio_b64, provider, i, len(chunks)
