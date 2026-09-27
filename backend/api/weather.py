"""Weather endpoints — demo fixtures or live adapters, always provenance-labelled (§51).

Three source modes (docs/SOURCE-MODES.md):
  demo   fixtures labelled DEMO.
  imd    IMD only. An unreachable IMD is UNAVAILABLE — never backfilled with
         Open-Meteo/OWM/cache, which would present a non-official number.
  hybrid IMD -> Open-Meteo -> OWM -> file cache CACHED -> honest UNAVAILABLE.
Nothing is presented as live when it is not.
"""
import asyncio
from datetime import timedelta
from typing import Optional
from fastapi import APIRouter

from .. import config
from ..adapters import cap_adapter, openmeteo_adapter, owm_adapter
from ..adapters.registry import AdapterUnavailable
from ..models.weather import Location, NormalizedWeather
from ..services import district_service, nwp_service
from ..services.advisory_service import role_weather_brief
from ..services.alert_service import classify_alert, gather_alerts
from ..services.cache_service import CacheService, TTLS
from ..services.imd_service import IMDService
from ..services.location_service import LocationService
from ..services.risk_service import RiskService
from ..services.validation_service import ValidationService
from ..services.verdict_service import build_verdict
from ..utils.time import iso_now

router = APIRouter(prefix="/api")
cache = CacheService()

UNAVAILABLE_MSG = "Weather information is temporarily unavailable."


def _official_only() -> bool:
    """`imd` mode: official sources only.

    An unreachable IMD is reported as UNAVAILABLE and is never silently
    backfilled with a non-official number — the console's whole claim is
    provenance honesty (docs/SOURCE-MODES.md)."""
    return config.current_source_mode() == "imd"


def _services():
    # Always the live adapter: demo mode was removed, so fixtures can never be
    # served as if they were official.
    imd = IMDService(adapter="live")
    return {"imd": imd, "val": ValidationService(imd), "risk": RiskService(), "loc": LocationService()}


def _imd_keyed() -> bool:
    """True when an IMD API key is configured.

    IMD without a key always fails closed — but only after a ~2s doomed
    network round trip. Every weather/warning endpoint tries IMD first, so
    an unkeyed deployment pays that penalty on every call before falling
    back to Open-Meteo. Callers skip the attempt when this is False and go
    straight to the fallback chain: identical outcome, ~2s faster per call,
    which is what keeps the Home screen inside the app's fetch timeout.
    (The teammate-owned imd_service.py is untouched; this is a caller-side
    short-circuit, not a behavior change.)
    """
    return bool(config.IMD_API_KEY)


def _key(kind: str, lat: float, lon: float, extra: str = "") -> str:
    return f"{kind}:{round(lat, 2)}:{round(lon, 2)}:{extra}"


def _as_json(x) -> dict:
    """Adapters return pydantic models or dicts; normalize for cache/response."""
    return x if isinstance(x, dict) else x.model_dump(mode="json")


async def _live_current(lat: float, lon: float) -> tuple[dict, str]:
    """IMD first whenever official access works, then Open-Meteo,
    OpenWeatherMap, file cache last. Provenance names the actual source."""
    if _imd_keyed():
        try:
            obs = await IMDService(adapter="live").get_current_weather(lat, lon)
            data = obs.model_dump(mode="json")
            cache.set(_key("current", lat, lon), data, TTLS["current"])
            return data, "LIVE"
        except AdapterUnavailable:
            pass
    if _official_only():
        # imd mode stops here. Backfilling with Open-Meteo/OWM/cache would
        # present a non-official number as the console's answer.
        raise AdapterUnavailable(
            "IMD unreachable — imd mode does not fall back to non-official sources")
    try:
        obs, _ = await openmeteo_adapter.get_current(lat, lon)
        data = obs.model_dump(mode="json")
        cache.set(_key("current", lat, lon), data, TTLS["current"])
        return data, "LIVE"
    except AdapterUnavailable:
        try:
            obs, _ = await owm_adapter.get_current(lat, lon)
            data = _as_json(obs)
            cache.set(_key("current", lat, lon), data, TTLS["current"])
            return data, "LIVE"
        except AdapterUnavailable:
            cached = cache.get(_key("current", lat, lon))
            if cached:
                return {**cached, "stale_note": "Showing last retrieved information; may be outdated."}, "CACHED"
            raise


async def _live_forecast(lat: float, lon: float) -> tuple[dict, str]:
    if _imd_keyed():
        try:
            fc = await IMDService(adapter="live").get_forecast(lat, lon)
            data = fc.model_dump(mode="json")
            cache.set(_key("forecast", lat, lon), data, TTLS["forecast"])
            return data, "LIVE"
        except AdapterUnavailable:
            pass
    if _official_only():
        # imd mode stops here — no Open-Meteo, no cache. Official-only means
        # official-only (docs/SOURCE-MODES.md).
        raise AdapterUnavailable(
            "IMD unreachable — imd mode does not fall back to non-official sources")
    try:
        fc, _ = await openmeteo_adapter.get_forecast(lat, lon)
        data = fc.model_dump(mode="json")
        cache.set(_key("forecast", lat, lon), data, TTLS["forecast"])
        return data, "LIVE"
    except AdapterUnavailable:
        pass
    # Abhiram's fallback rule: if one weather API fails, try another before
    # giving up — OpenWeatherMap is the forecast backstop, mirroring the
    # current-weather chain. imd mode never reaches this leg (guard above).
    try:
        fc, _ = await owm_adapter.get_forecast(lat, lon)
        data = fc.model_dump(mode="json")
        cache.set(_key("forecast", lat, lon), data, TTLS["forecast"])
        return data, "LIVE"
    except AdapterUnavailable:
        cached = cache.get(_key("forecast", lat, lon))
        if cached:
            return {**cached, "stale_note": "Showing last retrieved information; may be outdated."}, "CACHED"
        raise


async def _cross_check(lat: float, lon: float) -> tuple[dict | None, str]:
    """Second-opinion panel. Unconfigured -> honestly omitted."""
    try:
        data, prov = await owm_adapter.get_current(lat, lon)
        return data, prov
    except AdapterUnavailable:
        return None, "UNCONFIGURED"


async def advisory_current_observation(lat: float, lon: float) -> tuple[dict | None, str]:
    """Current-observation blob for server-side advisory weather grounding.

    Live chain (_live_current: IMD -> Open-Meteo -> OWM -> cache, imd mode
    official-only). An unreachable IMD in imd mode raises AdapterUnavailable
    inside _live_current rather than backfilling with non-official sources —
    surfaced here as (None, "UNAVAILABLE"). Never returns invented numbers.
    """
    try:
        return await _live_current(lat, lon)
    except AdapterUnavailable:
        return None, "UNAVAILABLE"


async def resolve_advisory_weather(lat: Optional[float], lon: Optional[float],
                                  explicit: dict) -> tuple[dict, dict]:
    """Merge client-supplied weather numbers with a server-side fetch.

    `explicit` holds the optional client query values for rain_mm / wind_kph /
    temp_c / humidity_pct (None = not passed). When every explicit value is
    absent and lat/lon are present, the current observation is fetched
    server-side via advisory_current_observation(); otherwise only the
    explicit numbers are used — a client-supplied partial set is never
    silently padded with fetched data.

    Returns (current, weather_basis): `current` feeds weather_advisories();
    `weather_basis` is the honest "based on" block — the observed values we
    actually have plus provenance (LIVE/CACHED/DEMO/CLIENT/UNAVAILABLE).
    Missing or unreachable weather yields provenance UNAVAILABLE with no
    values and no weather lines: never an invented calm, never a false
    all-clear.
    """
    from ..services.advisory_service import observation_numbers
    keys = ("rain_mm", "wind_kph", "temp_c", "humidity_pct")
    have_explicit = any(explicit.get(k) is not None for k in keys)
    fetched = {k: None for k in keys}
    prov = "UNAVAILABLE"
    if not have_explicit and lat is not None and lon is not None:
        obs, prov = await advisory_current_observation(lat, lon)
        if obs is not None:
            fetched = observation_numbers(obs)
        # obs None -> prov UNAVAILABLE, fetched stays all-None: no weather
        # lines, no invented values.
    elif have_explicit:
        prov = "CLIENT"
    current = {k: (explicit.get(k) if explicit.get(k) is not None else fetched[k])
               for k in keys}
    basis = {"provenance": prov}
    for k in keys:
        if current[k] is not None:
            basis[k] = current[k]
    return current, basis


@router.get("/weather/current")
async def current_wx(lat: float = 17.385, lon: float = 78.4867, district: Optional[str] = None,
                     role: Optional[str] = None, lang: Optional[str] = "en") -> dict:
    s = _services()
    loc = s["loc"].resolve(lat, lon)
    if district:
        loc["district"] = district

    def _brief(current_dict: dict | None, forecast_dict: dict | None) -> dict:
        # Role-first interpreted weather: headline says what the weather MEANS
        # for the role; numbers stay supporting detail. Empty when no data.
        return role_weather_brief(current_dict, forecast_dict, role or "general",
                                  lang or "en", district=loc.get("district"),
                                  coastal=loc.get("coastal"))

    try:
        # LATENCY: the primary fetch and the OWM cross-check are independent
        # network calls, so they run together — this saves the cross-check
        # round trip before the response can render. Provenance semantics
        # are unchanged: the cross-check still names its own source, and a
        # failed primary fetch still returns the "unavailable" payload.
        if _official_only():
            # A second opinion is a non-official source; imd mode omits it
            # rather than mix it into an official-only answer.
            data, prov = await _live_current(loc["latitude"], loc["longitude"])
            cross, cross_prov = None, "UNCONFIGURED"
        else:
            (data, prov), (cross, cross_prov) = await asyncio.gather(
                _live_current(loc["latitude"], loc["longitude"]),
                _cross_check(loc["latitude"], loc["longitude"]),
            )
        try:
            fc, _ = await _live_forecast(loc["latitude"], loc["longitude"])
        except AdapterUnavailable:
            fc = None
        brief = _brief(data, fc)
        return {
            "location": loc, "current": data, "provenance": prov,
            "cross_check": {"data": cross, "provenance": cross_prov} if cross else None,
            "role_brief": brief,
            "generated_at": iso_now(),
        }
    except AdapterUnavailable as exc:
        return {
            "status": "unavailable", "message": UNAVAILABLE_MSG, "detail": str(exc),
            "provenance": "UNAVAILABLE", "location": loc, "role_brief": {},
            "generated_at": iso_now(),
        }


@router.get("/weather/forecast")
async def forecast(lat: float = 17.385, lon: float = 78.4867, district: Optional[str] = None) -> dict:
    s = _services()
    loc = s["loc"].resolve(lat, lon)
    if district:
        loc["district"] = district
    try:
        data, prov = await _live_forecast(loc["latitude"], loc["longitude"])
    except AdapterUnavailable as exc:
        return {
            "status": "unavailable", "message": UNAVAILABLE_MSG, "detail": str(exc),
            "provenance": "UNAVAILABLE", "location": loc, "generated_at": iso_now(),
        }
    return {"location": loc, "forecast": data, "provenance": prov, "generated_at": iso_now()}


@router.get("/weather/models")
async def model_comparison(lat: float = 17.385, lon: float = 78.4867) -> dict:
    """NWP multi-model comparison (§32): GFS/ECMWF spread = confidence context, never a warning."""
    loc = LocationService().resolve(lat, lon)
    try:
        data, prov = await nwp_service.compare_models(loc["latitude"], loc["longitude"])
    except AdapterUnavailable as exc:
        return {
            "status": "unavailable", "message": "Model comparison temporarily unavailable.",
            "detail": str(exc), "provenance": "UNAVAILABLE", "location": loc, "generated_at": iso_now(),
        }
    data = {**data, "model_status": nwp_service.model_status()}
    return {"location": loc, "comparison": data, "provenance": prov, "generated_at": iso_now()}


@router.get("/weather/nowcast")
async def nowcast(district: str = "Hyderabad", lat: Optional[float] = None, lon: Optional[float] = None) -> dict:
    s = _services()
    loc = s["loc"].resolve(lat, lon)
    try:
        if not _imd_keyed():
            raise AdapterUnavailable("no IMD_API_KEY — skipping doomed IMD attempt")
        data = await IMDService(adapter="live").get_district_nowcast(loc.get("district", district))
        prov = "LIVE"
    except AdapterUnavailable:
        if _official_only():
            return {
                "status": "unavailable", "message": UNAVAILABLE_MSG,
                "detail": "IMD unreachable — imd mode does not fall back to non-official sources",
                "provenance": "UNAVAILABLE", "district": district, "generated_at": iso_now(),
            }
        try:
            data, prov = await openmeteo_adapter.get_nowcast(loc["latitude"], loc["longitude"])
        except AdapterUnavailable as exc:
            return {
                "status": "unavailable", "message": UNAVAILABLE_MSG, "detail": str(exc),
                "provenance": "UNAVAILABLE", "district": district, "generated_at": iso_now(),
            }
    return {"district": loc.get("district", district), "nowcast": data, "provenance": prov, "generated_at": iso_now()}


@router.get("/weather/warnings")
async def warnings(district: str = "Hyderabad", lat: Optional[float] = None, lon: Optional[float] = None) -> dict:
    s = _services()
    if lat is not None and lon is not None:
        loc = s["loc"].resolve(lat, lon)
    else:
        # No GPS fix: place the named district so the response still carries its
        # state and coordinates. Without the state, `gather_alerts` cannot
        # classify anything as "nearby", and the console silently loses the
        # "official alerts exist in your state that we could not confirm for you"
        # signal — it would look like a quiet state instead of an unread one.
        loc = s["loc"].lookup(district) or {"district": district}
    district_name = loc.get("district", district)

    # LIVE: official IMD warning + CAP alerts, each honest about availability.
    # `warn_call_ok` separates two facts that must never be conflated:
    #   - the service answered and had no active warning  -> reachable, calm
    #   - we could not reach the service at all           -> reachable=False, UNKNOWN
    warning, verified_d, warn_prov = None, None, "UNAVAILABLE"
    warn_call_ok = False

    async def _imd_warning():
        # The IMD check and the CAP/chain gather are independent network
        # calls; run them together so one slow source cannot stack its
        # latency onto the other (this endpoint feeds the Home screen and
        # must answer inside the app's fetch timeout).
        if not _imd_keyed():
            return False, None, None, "UNAVAILABLE"
        try:
            w = await s["imd"].get_district_warning(district_name)
            v = s["val"].validate_warning(w, district_name) if w else None
            return (
                True,
                w.model_dump(mode="json") if w else None,
                v.model_dump(mode="json") if v else None,
                "LIVE",  # provenance of the CHECK, not of a warning that may be absent
            )
        except AdapterUnavailable:
            return False, None, None, "UNAVAILABLE"

    (warn_call_ok, warning, verified_d, warn_prov), gathered = await asyncio.gather(
        _imd_warning(),
        gather_alerts(lat=lat, lon=lon, district=district_name,
                      state=loc.get("state") or ""),
    )
    # the service answered and had no active warning -> reachable, calm;
    # we could not reach the service at all -> reachable=False, UNKNOWN.
    # These two facts must never be conflated.
    warning_service_available = warn_call_ok

    # A warning for a different district is context, not this district's warning.
    # The validation layer already ran the location check; read its verdict.
    warn_matches_location = (
        (verified_d or {}).get("validation", {}).get("location", "PASS") == "PASS"
        if warning else True
    )

    # One gatherer for both this endpoint and /api/chat, so the Alerts page and
    # the chat verdict can never see a different set of alerts (alert_service).
    # (gathered already holds the concurrent fetch from above — do not fetch twice.)
    cap_alerts = gathered["relevant"]
    nearby_alerts = gathered["nearby"]
    cap_prov = gathered["provenance"]

    # Truly nothing to report AND we could not check: honest unavailable.
    # If the service answered and simply had nothing, that is a reachable, calm
    # district -> status "ok" with a LOW verdict, not "unavailable".
    if warning is None and not cap_alerts and not nearby_alerts and not warning_service_available:
        return {
            "status": "unavailable", "message": "Warning information is temporarily unavailable.",
            "provenance": "UNAVAILABLE", "location": loc,
            "verdict": build_verdict(
                verified=verified_d, warning=warning, cap_alerts=cap_alerts,
                nearby_alerts=nearby_alerts,
                warning_service_available=warning_service_available,
                warning_matches_location=warn_matches_location,
            ),
            "generated_at": iso_now(),
        }
    return {
        "status": "ok",
        "location": loc, "warning": warning, "verified": verified_d,
        "warning_provenance": warn_prov, "cap_alerts": cap_alerts,
        "nearby_alerts": nearby_alerts,
        "cap_provenance": cap_prov,
        "verdict": build_verdict(
            verified=verified_d, warning=warning, cap_alerts=cap_alerts,
            nearby_alerts=nearby_alerts,
            warning_service_available=warning_service_available,
            warning_matches_location=warn_matches_location,
        ),
        "generated_at": iso_now(),
    }


@router.get("/risk")
async def risk(severity: str = "YELLOW", user_type: str = "general") -> dict:
    s = _services()
    r = s["risk"].risk({"severity": severity, "hazard": "Thunderstorm"}, user_type)
    return {"risk": r, "generated_at": iso_now()}
