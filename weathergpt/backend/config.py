"""Central configuration. All secrets via env, safe defaults for demo."""
import os


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

CACHE_FILE = _get("CACHE_FILE", "weathergpt_cache.json")
DEFAULT_LAT = float(_get("DEFAULT_LAT", "17.385"))
DEFAULT_LON = float(_get("DEFAULT_LON", "78.4867"))
