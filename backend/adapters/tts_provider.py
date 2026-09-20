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
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
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


async def synthesize_chunked(text: str, language: str = "en-IN"):
    """Yield (audio_base64, provider, index, total) per sentence-chunk.

    HONESTY NOTE: Sarvam bulbul has no streaming API — this is
    sentence-chunked progressive generation, NOT provider streaming. Each
    chunk is yielded as soon as its own synthesize() call completes, so a
    streaming endpoint can emit audio progressively instead of waiting for
    the whole text. Raises AdapterUnavailable if no chunk could be made.

    Chunking happens on the RAW text (then each chunk is sanitized): the
    whole-text sanitize_for_tts() truncates at 600 chars, which would
    silently drop safety advice on long texts.
    """
    chunks = [c for c in (sanitize_for_tts(c) for c in split_sentences(text, max_chars=450)) if c]
    if not chunks:
        report(NAME, UNCONFIGURED, "empty text after sanitize — browser fallback")
        raise AdapterUnavailable("browser-fallback")
    for i, chunk in enumerate(chunks):
        audio_b64, provider = await synthesize(chunk, language)
        yield audio_b64, provider, i, len(chunks)
