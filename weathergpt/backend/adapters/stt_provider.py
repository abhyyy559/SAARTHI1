"""STT provider — Sarvam-compatible HTTP with honest browser fallback.

Env: SARVAM_API_KEY, SARVAM_STT_URL (default https://api.sarvam.ai/speech-to-text),
SARVAM_STT_MODEL (default saarika-v2.5). Without a key the provider reports
BROWSER_FALLBACK and the frontend uses Web Speech API — badge shows the truth.
"""
from __future__ import annotations

import httpx

from .. import config
from .registry import LIVE, UNCONFIGURED, AdapterUnavailable, report

NAME = "stt"
BROWSER_FALLBACK = "browser-fallback"


def provider_name() -> str:
    return "sarvam-live" if config.SARVAM_API_KEY else BROWSER_FALLBACK


async def transcribe(audio_bytes: bytes, filename: str, language: str = "en-IN") -> tuple[str, str]:
    key = config.SARVAM_API_KEY
    if not key:
        report(NAME, UNCONFIGURED, "SARVAM_API_KEY not set — browser fallback")
        raise AdapterUnavailable("browser-fallback")
    # Sarvam language codes: en-IN, hi-IN, te-IN, ...
    lang = {"en": "en-IN", "hi": "hi-IN", "te": "te-IN"}.get(language, language)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                config.SARVAM_STT_URL,
                headers={"api-subscription-key": key},
                data={"model": config.SARVAM_STT_MODEL, "language_code": lang},
                files={"file": (filename or "audio.webm", audio_bytes)},
            )
            resp.raise_for_status()
            text = (resp.json().get("transcript") or "").strip()
    except Exception as exc:
        report(NAME, UNCONFIGURED, f"provider error: {type(exc).__name__} — browser fallback")
        raise AdapterUnavailable(f"STT provider failed: {exc}") from exc
    report(NAME, LIVE, f"transcribed {len(text)} chars ({lang})")
    return text, "sarvam-live"
