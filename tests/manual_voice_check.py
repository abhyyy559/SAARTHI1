"""Manual voice-loop check: Sarvam TTS -> wav file -> Sarvam STT transcript.
Run:  python tests/manual_voice_check.py   (not a pytest module)
"""
import base64
import os
import sys

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
key = ""
for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
    if line.startswith("SARVAM_API_KEY="):
        key = line.split("=", 1)[1].strip()
if not key:
    sys.exit("no SARVAM_API_KEY in .env")

H = {"api-subscription-key": key}

# 1) TTS: speak an English question, save real audio
r = httpx.post(
    "https://api.sarvam.ai/text-to-speech",
    headers=H,
    json={"inputs": ["Will it rain tomorrow in Hyderabad?"],
          "target_language_code": "en-IN", "model": "bulbul:v3", "speaker": "priya"},
    timeout=60,
)
r.raise_for_status()
audio = base64.b64decode(r.json()["audios"][0])
wav_path = os.path.join(ROOT, "_tts_check.wav")
with open(wav_path, "wb") as f:
    f.write(audio)
print(f"TTS OK: {len(audio)} bytes -> {wav_path}")

# 2) STT: send that audio back, expect the transcript
r2 = httpx.post(
    "https://api.sarvam.ai/speech-to-text",
    headers=H,
    data={"model": "saarika:v2.5", "language_code": "en-IN"},
    files={"file": ("check.wav", open(wav_path, "rb"), "audio/wav")},
    timeout=60,
)
r2.raise_for_status()
print("STT transcript:", r2.json().get("transcript"))
os.remove(wav_path)
