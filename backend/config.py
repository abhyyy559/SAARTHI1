"""Central configuration. All secrets via env, safe defaults for demo."""
import json
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    # Load .env from the repo root — keys stay server-side.
    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
except ImportError:
    pass


def _get(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


IMD_API_KEY = _get("IMD_API_KEY", "")
# Portal-issued JWT for api.imd.gov.in (see the auth note below). The hex API
# key alone can never pass the gateway — both values are required for IMD.
# Paste a fresh access_token here, or set IMD_API_EMAIL/PASSWORD below and the
# adapter mints + refreshes it itself (55-min TTL, refresh-on-401) so it never
# dies mid-demo. Email/password win only when IMD_JWT is empty.
IMD_JWT = _get("IMD_JWT", "")
IMD_API_EMAIL = _get("IMD_API_EMAIL", "")
IMD_API_PASSWORD = _get("IMD_API_PASSWORD", "")
IMD_TOKEN_URL = _get("IMD_TOKEN_URL", "https://api.imd.gov.in/api/oauth/token.php")
LLM_API_KEY = _get("LLM_API_KEY", "")
DATABASE_URL = _get("DATABASE_URL", "")
REDIS_URL = _get("REDIS_URL", "")
STT_API_KEY = _get("STT_API_KEY", "")
TTS_API_KEY = _get("TTS_API_KEY", "")

# Real public IMD API (api.imd.gov.in/api/v1 — verified 2026-10-09 against the
# official reference at https://api.imd.gov.in/public/api_reference.html).
# The old default (mausam.imd.gov.in/api/v1) was a guess and does not exist —
# every live call against it failed, which is why live mode never showed data.
IMD_BASE_URL = _get("IMD_BASE_URL", "https://api.imd.gov.in/api/v1").rstrip("/")

# IMD endpoint paths, one env var each. Names match the official reference
# (https://api.imd.gov.in/public/api_reference.html). They stay configurable
# so a renamed path is a .env line rather than a code edit.
IMD_PATH_CURRENT = _get("IMD_PATH_CURRENT", "current_wx")
IMD_PATH_FORECAST = _get("IMD_PATH_FORECAST", "cityforecastloc")
IMD_PATH_WARNING = _get("IMD_PATH_WARNING", "districtwarning")
IMD_PATH_NOWCAST = _get("IMD_PATH_NOWCAST", "districtnowcast")

# IMD request tuning — all env-driven so key day needs no code edit.
# Auth (PROVEN 2026-10-09 by probing the live API with a real portal key):
# the gateway is DUAL-credential. `x-api-key: <IMD_API_KEY>` identifies the
# caller; `Authorization: Bearer <IMD_JWT>` authorizes it. Key-only calls get
# `{"error":"Authorization header missing or invalid"}`; key + non-JWT Bearer
# gets `{"error":"Invalid or expired JWT token"}` — i.e. the gateway reads
# both headers and the Bearer value must be a real JWT. The JWT is issued
# inside the portal after login (email + password + CAPTCHA, a human step at
# https://api.imd.gov.in/public/login.php). IMD_AUTH_SCHEME positions the KEY:
# "bearer" (default) = `x-api-key` header; "header" = IMD_AUTH_HEADER verbatim;
# "query" = IMD_AUTH_PARAM query parameter. The JWT always rides as
# `Authorization: Bearer` whenever IMD_JWT is set.
IMD_AUTH_SCHEME = _get("IMD_AUTH_SCHEME", "bearer").strip().lower()
IMD_AUTH_HEADER = _get("IMD_AUTH_HEADER", "Authorization")
IMD_AUTH_PARAM = _get("IMD_AUTH_PARAM", "api_key")
IMD_TIMEOUT = float(_get("IMD_TIMEOUT", "10") or 10)
# Station/city the live current/forecast calls ask for when the caller passes
# no district (the /api/weather live paths only have lat/lon). Callers that
# know the district pass it and it wins over this default.
IMD_DEFAULT_STATION = _get("IMD_DEFAULT_STATION", "Hyderabad")

# IMD response field names are as provisional as the paths — the fixtures use
# our assumed schema ("temp", "humidity", ...). IMD_FIELD_MAP is a JSON object
# mapping our normalized name -> the provider's actual name, applied in the
# live branches only, e.g. '{"temp": "temperature_c", "windspeed": "wind_kph"}'.
# Unknown on key day: set the key, hit one endpoint, read the real names, and
# paste the map here. Demo fixtures keep the assumed schema untouched.
_IMD_FIELD_MAP_RAW = _get("IMD_FIELD_MAP", "").strip()
try:
    IMD_FIELD_MAP: dict = json.loads(_IMD_FIELD_MAP_RAW) if _IMD_FIELD_MAP_RAW else {}
except (json.JSONDecodeError, ValueError):
    IMD_FIELD_MAP = {}

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
# When neither variable is set at all, the public SACHET feeds are used by
# default: they are keyless, official (NDMA, carrying IMD's own warnings), and
# without them a fresh checkout with no .env checked no official warnings at
# all. Setting CAP_FEED_URLS to an empty value still turns them off.
DEFAULT_CAP_FEED_URLS = [
    "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml",
    "https://sachet.ndma.gov.in/cap_public_website/rss/rss_telangana.xml",
    # AP slug trap: only rss_andhra.xml works (see .env.example).
    "https://sachet.ndma.gov.in/cap_public_website/rss/rss_andhra.xml",
]
_CAP_FEED_URLS_RAW = os.environ.get("CAP_FEED_URLS")
CAP_FEED_URLS = [u.strip() for u in (_CAP_FEED_URLS_RAW or "").split(",") if u.strip()] or (
    [CAP_FEED_URL] if CAP_FEED_URL
    else (list(DEFAULT_CAP_FEED_URLS) if _CAP_FEED_URLS_RAW is None else [])
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
# Default model: must be a real, currently-supported Groq model ID.
# (Groq retired llama-3.3-70b-versatile and qwen/qwen3-32b in Aug 2026; per
# Groq's official deprecation table the current production instruct IDs are
# openai/gpt-oss-120b and qwen/qwen3.6-27b.)
LLM_MODEL = _get("LLM_MODEL", "openai/gpt-oss-120b")
LLM_TIMEOUT = float(_get("LLM_TIMEOUT", "25"))
# Groq's free tier limits tokens per minute PER MODEL. When the main model
# answers 429, the same request is retried once on this one (its own bucket)
# before the answer drops to the rule-based template. Empty disables it.
LLM_FALLBACK_MODEL = _get("LLM_FALLBACK_MODEL", "openai/gpt-oss-20b")

# Model IDs we know Groq actually serves. A custom LLM_BASE_URL means custom
# model names, so the check only applies to the default Groq endpoint.
_KNOWN_GROQ_MODELS = frozenset({
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.6-27b",
    "qwen/qwen3-32b",
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "moonshotai/kimi-k2-instruct",
    "groq/compound",
    "groq/compound-mini",
})
_USING_DEFAULT_GROQ = "groq.com" in LLM_BASE_URL
LLM_MODEL_KNOWN = LLM_MODEL in _KNOWN_GROQ_MODELS or not _USING_DEFAULT_GROQ

if _USING_DEFAULT_GROQ and LLM_API_KEY and not LLM_MODEL_KNOWN:
    # FAIL LOUD at startup: a bogus model name used to fail silently (LLMService
    # swallowed the provider 400 and fell back to the template answer, so the
    # LLM was effectively off with no one knowing). LLMService.generate() also
    # raises instead of falling back in this case.
    import sys
    print(
        f"\n[WeatherGPT CONFIG ERROR] LLM_MODEL='{LLM_MODEL}' is not a known Groq "
        f"model. Known IDs include: {', '.join(sorted(_KNOWN_GROQ_MODELS))}. "
        "Set LLM_MODEL to a valid ID or unset it to use the default.\n",
        file=sys.stderr,
    )

# Repo root (parent of the backend/ package). Every relative data path hangs off
# this, never off the process working directory.
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

# CORS allowlist for the real frontend origins. Comma-separated, e.g.
# FRONTEND_ORIGINS="https://saarthi.vercel.app,https://app.example.com".
# Local dev origins (Vite etc.) are always allowed.
FRONTEND_ORIGINS = _get("FRONTEND_ORIGINS", "")
