"""TTS provider — Sarvam-compatible HTTP with honest browser fallback.

Env: SARVAM_API_KEY, SARVAM_TTS_URL (default https://api.sarvam.ai/text-to-speech),
SARVAM_TTS_MODEL (default bulbul:v2). Without a key -> BROWSER_FALLBACK marker
and the frontend speaks via speechSynthesis.
"""
from __future__ import annotations

import base64

import httpx

from .. import config
from .registry import LIVE, UNCONFIGURED, AdapterUnavailable, report

NAME = "tts"
BROWSER_FALLBACK = "browser-fallback"


def provider_name() -> str:
    return "sarvam-live" if config.SARVAM_API_KEY else BROWSER_FALLBACK


async def synthesize(text: str, language: str = "en-IN") -> tuple[str, str]:
    """Returns (audio_base64_wav, provider). Raises AdapterUnavailable when unconfigured."""
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
