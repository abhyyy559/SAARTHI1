"""Central configuration. All secrets via env, safe defaults for demo."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    # Load weathergpt/.env (repo root of the app) — keys stay server-side.
    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
except ImportError:
    pass


def _get(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


IMD_API_KEY = _get("IMD_API_KEY", "")
LLM_API_KEY = _get("LLM_API_KEY", "")
DATABASE_URL = _get("DATABASE_URL", "")
REDIS_URL = _get("REDIS_URL", "")
STT_API_KEY = _get("STT_API_KEY", "")
TTS_API_KEY = _get("TTS_API_KEY", "")

IMD_BASE_URL = _get("IMD_BASE_URL", "https://mausam.imd.gov.in/api/v1").rstrip("/")
DEMO_MODE = _get("DEMO_MODE", "true").lower() in ("1", "true", "yes")
IMD_ADAPTER = _get("IMD_ADAPTER", "demo" if DEMO_MODE else "live")

# Live-source keys (all optional — absence is reported, never faked)
OWM_API_KEY = _get("OWM_API_KEY", "")
DATAGOV_API_KEY = _get("DATAGOV_API_KEY", "")
DATAGOV_RESOURCE_ID = _get("DATAGOV_RESOURCE_ID", "")
CAP_FEED_URL = _get("CAP_FEED_URL", "")
SARVAM_API_KEY = _get("SARVAM_API_KEY", "")
SARVAM_STT_URL = _get("SARVAM_STT_URL", "https://api.sarvam.ai/speech-to-text")
SARVAM_STT_MODEL = _get("SARVAM_STT_MODEL", "saarika:v2.5")
SARVAM_TTS_URL = _get("SARVAM_TTS_URL", "https://api.sarvam.ai/text-to-speech")
SARVAM_TTS_MODEL = _get("SARVAM_TTS_MODEL", "bulbul:v3")
SARVAM_TTS_SPEAKER = _get("SARVAM_TTS_SPEAKER", "priya")

# Conversational layer (OpenAI-compatible endpoint; Groq by default)
LLM_BASE_URL = _get("LLM_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
LLM_MODEL = _get("LLM_MODEL", "qwen/qwen3.8-27b")
LLM_TIMEOUT = float(_get("LLM_TIMEOUT", "25"))

CACHE_FILE = _get("CACHE_FILE", "weathergpt_cache.json")
DEFAULT_LAT = float(_get("DEFAULT_LAT", "17.385"))
DEFAULT_LON = float(_get("DEFAULT_LON", "78.4867"))
