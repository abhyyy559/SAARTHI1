"""Voice endpoints — Sarvam-compatible STT/TTS with honest browser fallback (§19).

Without SARVAM_API_KEY the API says so explicitly (provider=browser-fallback)
and the frontend uses the Web Speech API. Rural-accessible either way.
"""
from fastapi import APIRouter, File, UploadFile

from ..adapters import stt_provider, tts_provider
from ..adapters.registry import AdapterUnavailable
from ..utils.speak_sanitize import sanitize_for_tts

router = APIRouter()


@router.post("/api/voice/transcribe")
async def transcribe(audio: UploadFile = File(..., alias="file"), language: str = "en") -> dict:
    audio_bytes = await audio.read()
    try:
        text, provider = await stt_provider.transcribe(audio_bytes, audio.filename or "audio.webm", language)
        return {"text": text, "provider": provider, "using_browser_speech": False}
    except AdapterUnavailable:
        return {"text": "", "provider": "browser-fallback", "using_browser_speech": True}


@router.post("/api/voice/synthesize")
async def synthesize(payload: dict) -> dict:
    text = payload.get("text", "")
    language = payload.get("language", "en")
    # Sanitize for both Sarvam and browser fallback
    text = sanitize_for_tts(text)
    try:
        audio_b64, provider = await tts_provider.synthesize(text, language)
        return {"audio_base64": audio_b64, "mime": "audio/wav",
                "provider": provider, "client_speech": False}
    except AdapterUnavailable:
        return {"text": text, "audio_url": None, "provider": "browser-fallback", "client_speech": True}


@router.get("/api/voice/status")
async def voice_status() -> dict:
    return {"stt": stt_provider.provider_name(), "tts": tts_provider.provider_name()}
