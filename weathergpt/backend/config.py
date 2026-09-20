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

# IMD endpoint paths, one env var each.
#
# These are the ONLY unverified part of the IMD integration: the auth header
# (`Authorization: Bearer <IMD_API_KEY>`) and the request/response handling are
# exercised and working, but nobody has seen IMD's real path list yet — the
# platform is credential-gated. They are therefore configurable so that when the
# key arrives and a path differs, the fix is a .env line rather than a code edit.
# Verified behaviour today: with a key set, a real request goes out to
# {IMD_BASE_URL}/{path} and a bad key returns 400/401 — i.e. the wiring is
# complete and only the paths are provisional.
IMD_PATH_CURRENT = _get("IMD_PATH_CURRENT", "current_wx")
IMD_PATH_FORECAST = _get("IMD_PATH_FORECAST", "cityforecastloc")
IMD_PATH_WARNING = _get("IMD_PATH_WARNING", "districtwarning")
IMD_PATH_NOWCAST = _get("IMD_PATH_NOWCAST", "districtnowcast")

# --- Web Push (background notifications) ------------------------------------
# A VAPID pair identifies this server to the browser push services. Left unset,
# a pair is generated once and kept beside the cache, so local development works
# with no setup. A deployment should pin both so subscriptions survive restarts
# and multiple instances agree on the same key.
VAPID_PRIVATE_KEY = _get("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = _get("VAPID_PUBLIC_KEY", "")
# Contact address the push service can use if we misbehave. The spec requires
# a mailto: or https: URL; the default is deliberately non-routable so nobody
# mistakes it for a monitored mailbox.
VAPID_SUBJECT = _get("VAPID_SUBJECT", "mailto:ops@weathergpt.local")
# How often the background watcher re-checks subscribed districts against the
# NETWORK sources (CAP/IMD/Open-Meteo). Bulletins are issued on the scale of
# hours, so five minutes is responsive without hammering NDMA.
ALERT_WATCH_INTERVAL = int(_get("ALERT_WATCH_INTERVAL", "300") or 300)
# How often the watcher advances the local demo lifecycle. This pass touches
# only the local store — no network — and it is what makes the on-stage
# lifecycle land on time: the one-tap scenarios schedule pre-alert at ~12s,
# ACTIVE at ~40s and ENDED at ~3min, and their own comments say "let the 10s
# lifecycle loop deliver it". Sharing the 300s network cadence meant the
# pre-alert notification could arrive up to five minutes late — by which point
# the demo alert had already ended.
DEMO_TICK = int(_get("DEMO_TICK", "10") or 10)

# --- Source modes (docs/SOURCE-MODES.md): "demo" | "imd" | "hybrid" ----------
# SOURCE_MODE wins; if unset it derives from the legacy DEMO_MODE boolean so old
# .env files keep working. DEMO_MODE stays a plain boolean because it is read at
# many call sites, and is re-derived so the two can never drift.
DEMO_MODE = _get("DEMO_MODE", "true").lower() in ("1", "true", "yes")
_SOURCE_MODE_ENV = _get("SOURCE_MODE", "").strip().lower()
if _SOURCE_MODE_ENV in ("demo", "imd", "hybrid"):
    SOURCE_MODE = _SOURCE_MODE_ENV
elif _SOURCE_MODE_ENV == "live":  # legacy env alias for "hybrid"
    SOURCE_MODE = "hybrid"
else:
    SOURCE_MODE = "demo" if DEMO_MODE else "hybrid"
DEMO_MODE = SOURCE_MODE == "demo"  # derived, always in sync

IMD_ADAPTER = _get("IMD_ADAPTER", "demo" if DEMO_MODE else "live")

# Per-mode source chains, reported verbatim by GET /api/mode so the console can
# name the sources actually carrying the answer, not just the mode label.
MODE_SOURCES = {
    "demo": {"weather": "DEMO fixtures", "warnings": "DEMO fixtures"},
    "imd": {"weather": "IMD only", "warnings": "IMD → SACHET/CAP"},
    "hybrid": {"weather": "IMD → Open-Meteo → OpenWeatherMap",
               "warnings": "IMD → SACHET/CAP → InTouch → WeatherAPI → GDACS"},
}


def current_source_mode() -> str:
    """Effective mode for source selection.

    `DEMO_MODE` is the runtime demo switch read by many call sites (and set
    directly by tests), so it always wins for the demo branch. `SOURCE_MODE`
    distinguishes the official-only `imd` chain from the full `hybrid` chain.
    """
    if DEMO_MODE:
        return "demo"
    return "imd" if SOURCE_MODE == "imd" else "hybrid"

# Live-source keys (all optional — absence is reported, never faked)
OWM_API_KEY = _get("OWM_API_KEY", "")
DATAGOV_API_KEY = _get("DATAGOV_API_KEY", "")
DATAGOV_RESOURCE_ID = _get("DATAGOV_RESOURCE_ID", "")
CAP_FEED_URL = _get("CAP_FEED_URL", "")
# Extra SACHET state feeds, comma-separated. A fisherman in Visakhapatnam is
# covered by the Andhra feed, not the Telangana one — one feed is not enough.
CAP_FEED_URLS = [u.strip() for u in _get("CAP_FEED_URLS", "").split(",") if u.strip()] or (
    [CAP_FEED_URL] if CAP_FEED_URL else []
)
# Multi-source alert chain (adapters/alert_sources.py)
WEATHERAPI_KEY = _get("WEATHERAPI_KEY", "")   # free key, weatherapi.com
WEATHERUNION_KEY = _get("WEATHERUNION_KEY", "")  # free key, Zomato Weather Union

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

# Backend package root (…/weathergpt). Every relative data path hangs off this,
# never off the process working directory.
BASE_DIR = Path(__file__).resolve().parent.parent

_cache_file = Path(_get("CACHE_FILE", "weathergpt_cache.json"))
# A relative CACHE_FILE resolved against the CWD, so `uvicorn backend.main:app`
# from the repo root and from weathergpt/ pointed at two DIFFERENT store/ dirs —
# the persisted mode, the demo alert store and the delivery ledger silently
# diverged depending on where the server was started. Absolute paths make the
# store single-instance. An explicitly absolute CACHE_FILE is still honoured.
CACHE_FILE = str(_cache_file if _cache_file.is_absolute() else BASE_DIR / _cache_file)
DEFAULT_LAT = float(_get("DEFAULT_LAT", "17.385"))
DEFAULT_LON = float(_get("DEFAULT_LON", "78.4867"))
