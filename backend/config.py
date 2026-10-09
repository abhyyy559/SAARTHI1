"""Central configuration. All secrets via env, safe defaults for demo."""
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


# IMD_KEY accepted as an alias: the key IMD issues is often saved under that name.
IMD_API_KEY = _get("IMD_API_KEY", "") or _get("IMD_KEY", "")
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
# How often the watcher loop wakes to see whether the network pass is due.
# The network pass itself is guarded by ALERT_WATCH_INTERVAL above.
WATCH_TICK = int(_get("WATCH_TICK", "10") or 10)

# --- Single source mode: IMD-first (2026-09-27, Abhiram's order) --------------
# Demo mode, hybrid mode and the mode switcher are removed entirely. The app
# runs exactly one chain everywhere:
#   weather:  IMD live -> Open-Meteo -> OpenWeatherMap -> file cache
#   warnings: IMD live -> SACHET/CAP feeds
# IMD is always tried first; a fallback engages only when IMD is unreachable
# or returns nothing. Provenance always names the source that actually
# supplied the numbers — never IMD for a fallback number.
#
# DEMO_MODE only switches the chat to the labelled fixture path (rehearsals,
# no-network stages). It defaults OFF: with it on, chat answered from a
# September fixture and reported a "verified YELLOW Thunderstorm" from IMD that
# no source had issued. Set DEMO_MODE=true explicitly to rehearse offline.
DEMO_MODE = _get("DEMO_MODE", "false").strip().lower() in ("1", "true", "yes")

IMD_ADAPTER = "live"


def current_source_mode() -> str:
    """The app has exactly one mode: "imd" (IMD-first with honest fallbacks)."""
    return "imd"

# Live-source keys (all optional — absence is reported, never faked)
OWM_API_KEY = _get("OWM_API_KEY", "")
DATAGOV_API_KEY = _get("DATAGOV_API_KEY", "")
DATAGOV_RESOURCE_ID = _get("DATAGOV_RESOURCE_ID", "")
CAP_FEED_URL = _get("CAP_FEED_URL", "")
# NDMA SACHET public CAP feeds: keyless, official (state SDMAs and IMD centres
# issue through them). The all-India feed carries only the latest ~10 alerts,
# so the state feeds for the districts in our gazetteer are read too. A
# fisherman in Visakhapatnam is covered by the Andhra feed, not Telangana's.
SACHET_RSS = "https://sachet.ndma.gov.in/cap_public_website/rss/rss_{}.xml"
DEFAULT_CAP_FEED_URLS = [SACHET_RSS.format(s) for s in ("india", "telangana", "andhra")]
# CAP_FEED_URLS: comma-separated override; "off" disables CAP (tests, offline).
_cap_env = _get("CAP_FEED_URLS", "").strip()
if _cap_env.lower() == "off":
    CAP_FEED_URLS = []
elif _cap_env:
    CAP_FEED_URLS = [u.strip() for u in _cap_env.split(",") if u.strip()]
elif CAP_FEED_URL:
    CAP_FEED_URLS = [CAP_FEED_URL]
else:
    CAP_FEED_URLS = list(DEFAULT_CAP_FEED_URLS)
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
