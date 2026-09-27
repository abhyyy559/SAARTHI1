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
LLM_API_KEY = _get("LLM_API_KEY", "")
DATABASE_URL = _get("DATABASE_URL", "")
REDIS_URL = _get("REDIS_URL", "")
STT_API_KEY = _get("STT_API_KEY", "")
TTS_API_KEY = _get("TTS_API_KEY", "")

IMD_BASE_URL = _get("IMD_BASE_URL", "https://api.imd.gov.in/api/v1").rstrip("/")

# IMD endpoint paths — VERIFIED 2026-09-27 against IMD's logged-in API docs
# (api.imd.gov.in/public/api_docs.php). Every endpoint takes ONE query
# parameter: `id`, an IMD numeric station/district ID (not a name, not lat/lon).
IMD_PATH_CURRENT = _get("IMD_PATH_CURRENT", "current_wx")
IMD_PATH_FORECAST = _get("IMD_PATH_FORECAST", "cityforecastloc")
IMD_PATH_WARNING = _get("IMD_PATH_WARNING", "districtwarning")
IMD_PATH_NOWCAST = _get("IMD_PATH_NOWCAST", "nowcast")

# IMD auth — VERIFIED 2026-09-27 against IMD's logged-in API docs. Every API
# call sends BOTH headers:
#   X-API-KEY: <IMD_API_KEY>        (bound to the server IP on the portal)
#   Authorization: Bearer <JWT>     (portal-user identity, expires after 1h)
# The JWT is minted by POSTing the portal email+password to IMD_TOKEN_URL and
# is cached in memory until shortly before expiry; it must belong to the same
# portal user as the API key. Earlier guesses (Bearer <API key> alone,
# query-param key) were wrong and have been removed.
IMD_TOKEN_URL = _get("IMD_TOKEN_URL", "https://api.imd.gov.in/api/oauth/token.php")
IMD_API_EMAIL = _get("IMD_API_EMAIL", "")
IMD_API_PASSWORD = _get("IMD_API_PASSWORD", "")
IMD_TIMEOUT = float(_get("IMD_TIMEOUT", "10") or 10)

# District used by the live current/forecast calls when the caller passes no
# district (the /api/weather live paths only have lat/lon). Callers that know
# the district pass it and it wins over this default.
IMD_DEFAULT_DISTRICT = _get("IMD_DEFAULT_DISTRICT", "Hyderabad")

# IMD station/district ID resolution. The API wants numeric IDs (?id=...); it
# does not accept names or coordinates. IMD_STATION_IDS is a JSON object
# mapping district/city name -> {"current": "<station id>",
# "forecast": "<station code>", "warning": "<district id>",
# "nowcast": "<district id>"}. It is a MANUAL OVERRIDE — the primary
# mechanism is the mapping tables below, which resolve ANY Indian location.
# Use the override to pin a wrong auto-match without touching code.
_IMD_STATION_IDS_RAW = _get("IMD_STATION_IDS", "").strip()
try:
    IMD_STATION_IDS: dict = json.loads(_IMD_STATION_IDS_RAW) if _IMD_STATION_IDS_RAW else {}
except (json.JSONDecodeError, ValueError):
    IMD_STATION_IDS = {}

# IMD mapping tables — how any Indian lat/lng resolves to IMD numeric IDs.
# Fetched once with the dual-header auth (same as other calls) and cached on
# disk at backend/data/imd_mapping_cache.json for IMD_MAPPING_TTL_S seconds.
#
# The endpoint names below are BEST-EFFORT GUESSES following IMD's naming
# (current_wx, districtwarning, ...) — the API docs sit behind the portal
# login, so they are NOT verified. A wrong name fails closed: the fetch 404s
# and resolution falls back to Open-Meteo with the tried URL in the message.
# Copy the exact endpoint names from
# https://api.imd.gov.in/public/api_docs.php into these two vars to confirm.
IMD_PATH_STATION_MAPPING = _get("IMD_PATH_STATION_MAPPING", "stationmapping")
IMD_PATH_DISTRICT_MAPPING = _get("IMD_PATH_DISTRICT_MAPPING", "districtmapping")
IMD_MAPPING_TTL_S = int(_get("IMD_MAPPING_TTL_S", "604800") or 604800)

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
# How often the watcher loop wakes to see whether the network pass is due.
# The network pass itself is guarded by ALERT_WATCH_INTERVAL above.
WATCH_TICK = int(_get("WATCH_TICK", "10") or 10)

# --- Source mode: exactly one (2026-09-27, Abhiram's order) ---------------------
# The app runs a single IMD-first mode: IMD -> Open-Meteo -> OpenWeatherMap
# for weather, SACHET/CAP feeds for alerts, file cache last. There is no mode
# switcher, no /api/mode, no SOURCE_MODE env var — status payloads carry a
# literal "imd" for older clients. When IMD has no key or is unreachable, the
# chain falls back with honest provenance — a fallback number is never
# presented as official IMD data.

# Live-source keys (all optional — absence is reported, never faked)
OWM_API_KEY = _get("OWM_API_KEY", "")
DATAGOV_API_KEY = _get("DATAGOV_API_KEY", "")
DATAGOV_RESOURCE_ID = _get("DATAGOV_RESOURCE_ID", "")
CAP_FEED_URL = _get("CAP_FEED_URL", "")
# Extra SACHET state feeds, comma-separated. A fisherman in Visakhapatnam is
# covered by the Andhra feed, not the Telangana one — one feed is not enough.
# Default: the official public SACHET CAP feeds (no key needed), so alerts
# work out of the box on any fresh deploy; override via env when needed.
_SACHET_DEFAULT_FEEDS = [
    "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml",
    "https://sachet.ndma.gov.in/cap_public_website/rss/rss_telangana.xml",
    "https://sachet.ndma.gov.in/cap_public_website/rss/rss_andhra.xml",
]
CAP_FEED_URLS = [u.strip() for u in _get("CAP_FEED_URLS", "").split(",") if u.strip()] or (
    [CAP_FEED_URL] if CAP_FEED_URL else list(_SACHET_DEFAULT_FEEDS)
)
# Multi-source alert chain (adapters/alert_sources.py)
WEATHERAPI_KEY = _get("WEATHERAPI_KEY", "")   # free key, weatherapi.com
WEATHERUNION_KEY = _get("WEATHERUNION_KEY", "")  # free key, Zomato Weather Union

# WIS2 (optional, unverified): public global brokers need no private key.
# The live MQTT subscriber is not implemented in the MVP — these only
# document intent; CAP polling remains the official-warning path.
WIS2_BROKER = _get("WIS2_BROKER", "")
WIS2_TOPICS = _get("WIS2_TOPICS", "origin/a/wis2/#")

SARVAM_API_KEY = _get("SARVAM_API_KEY", "")
SARVAM_STT_URL = _get("SARVAM_STT_URL", "https://api.sarvam.ai/speech-to-text")
SARVAM_STT_MODEL = _get("SARVAM_STT_MODEL", "saaras:v3")
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
