"""Voice endpoints - STT/TTS. For robust hackathon demo use browser Web Speech API when keys absent."""
from fastapi import APIRouter, UploadFile, File
from ..services.translation_service import translate

router = APIRouter()


@router.post("/api/voice/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict:
    # Without STT_API_KEY, client falls back to Web Speech API.
    return {"text": "", "using_browser_speech": True}


@router.post("/api/voice/synthesize")
async def synthesize(payload: dict) -> dict:
    text = payload.get("text", "")
    return {"text": text, "audio_url": None, "client_speech": True}