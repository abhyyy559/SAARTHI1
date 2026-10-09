"""Weather endpoints — single IMD-first mode, always provenance-labelled.

One chain (2026-09-27, Abhiram's order):
  IMD live -> Open-Meteo -> OpenWeatherMap -> file cache -> honest UNAVAILABLE.
IMD is always tried first; a fallback engages only when IMD is unreachable or
returns nothing. Provenance names the actual source — never IMD for a fallback
number. Nothing is presented as live when it is not.
"""
import asyncio
import time
from datetime import timedelta
from typing import Optional
from fastapi import APIRouter

from ..adapters import openmeteo_adapter, owm_adapter
from ..adapters.registry import AdapterUnavailable
from ..models.weather import Location, NormalizedWeather
from ..services import nwp_service
from ..services.alert_service import gather_alerts
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


def _services():
    # Single IMD-first mode: always the live adapter. IMD is tried first;
    # Open-Meteo / OWM / cache engage only when IMD is unreachable.
    imd = IMDService(adapter="live")
    return {"imd": imd, "val": ValidationService(imd), "risk": RiskService(), "loc": LocationService()}


def _key(kind: str, lat: float, lon: float, extra: str = "") -> str:
    return f"{kind}:{round(lat, 2)}:{round(lon, 2)}:{extra}"


# LATENCY: short-TTL in-memory front cache for the live weather chain.
# _live_current/_live_forecast persist to the file cache (30min/3h) but only
# consult it as a last-resort fallback — every chat turn was paying full
# network time for Open-Meteo. This front cache serves successful fetches for
# 5 minutes with honest CACHED provenance; failures are never stored, so a
# failed fetch can never become a stale all-clear.
_FRONT_TTL_S = 300.0
_front: dict[str, tuple[dict, str, float]] = {}


def _front_get(kind: str, lat: float, lon: float) -> tuple[dict, str] | None:
    entry = _front.get(_key(kind, lat, lon))
    if entry and (time.monotonic() - entry[2]) < _FRONT_TTL_S:
        return entry[0], "CACHED"
    return None


def _front_set(kind: str, lat: float, lon: float, data: dict, prov: str) -> None:
    _front[_key(kind, lat, lon)] = (data, prov, time.monotonic())


def _as_json(x) -> dict:
    """Adapters return pydantic models or dicts; normalize for cache/response."""
    return x if isinstance(x, dict) else x.model_dump(mode="json")


async def _live_current(lat: float, lon: float) -> tuple[dict, str]:
    """IMD first, then Open-Meteo, OpenWeatherMap, file cache last.

    Single IMD-first mode (2026-09-27): IMD is always tried first; a fallback
    engages only when IMD is unreachable or returns nothing. Provenance names
    the actual source — never IMD for a fallback number.
    """
    hit = _front_get("current", lat, lon)
    if hit:
        return hit
    try:
        obs = await IMDService(adapter="live").get_current_weather(lat, lon)
        data = obs.model_dump(mode="json")
        cache.set(_key("current", lat, lon), data, TTLS["current"])
        _front_set("current", lat, lon, data, "LIVE")
        return data, "LIVE"
    except AdapterUnavailable:
        pass
    try:
        obs, _ = await openmeteo_adapter.get_current(lat, lon)
        data = obs.model_dump(mode="json")
        cache.set(_key("current", lat, lon), data, TTLS["current"])
        _front_set("current", lat, lon, data, "LIVE")
        return data, "LIVE"
    except AdapterUnavailable:
        try:
            obs, _ = await owm_adapter.get_current(lat, lon)
            data = _as_json(obs)
            cache.set(_key("current", lat, lon), data, TTLS["current"])
            _front_set("current", lat, lon, data, "LIVE")
            return data, "LIVE"
        except AdapterUnavailable:
            cached = cache.get(_key("current", lat, lon))
            if cached:
                return {**cached, "stale_note": "Showing last retrieved information; may be outdated."}, "CACHED"
            raise


async def _live_forecast(lat: float, lon: float) -> tuple[dict, str]:
    """IMD first, then Open-Meteo, OpenWeatherMap, file cache last.

    Single IMD-first mode (2026-09-27): IMD is always tried first; a fallback
    engages only when IMD is unreachable or returns nothing.
    """
    hit = _front_get("forecast", lat, lon)
    if hit:
        return hit
    try:
        fc = await IMDService(adapter="live").get_forecast(lat, lon)
        data = fc.model_dump(mode="json")
        cache.set(_key("forecast", lat, lon), data, TTLS["forecast"])
        _front_set("forecast", lat, lon, data, "LIVE")
        return data, "LIVE"
    except AdapterUnavailable:
        pass
    try:
        fc, _ = await openmeteo_adapter.get_forecast(lat, lon)
        data = fc.model_dump(mode="json")
        cache.set(_key("forecast", lat, lon), data, TTLS["forecast"])
        _front_set("forecast", lat, lon, data, "LIVE")
        return data, "LIVE"
    except AdapterUnavailable:
        pass
    # Abhiram's fallback rule: if one weather API fails, try another before
    # giving up — OpenWeatherMap is the forecast backstop, mirroring the
    # current-weather chain.
    try:
        fc, _ = await owm_adapter.get_forecast(lat, lon)
        data = fc.model_dump(mode="json")
        cache.set(_key("forecast", lat, lon), data, TTLS["forecast"])
        _front_set("forecast", lat, lon, data, "LIVE")
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

    Single IMD-first mode: the live chain (_live_current: IMD ->
    Open-Meteo -> OWM -> cache). An unreachable chain surfaces as (None,
    "UNAVAILABLE"). Never returns invented numbers.
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
async def current_wx(lat: float = 17.385, lon: float = 78.4867, district: Optional[str] = None) -> dict:
    s = _services()
    loc = s["loc"].resolve(lat, lon)
    if district:
        loc["district"] = district
    try:
        # LATENCY: the primary fetch and the OWM cross-check are independent
        # network calls, so they run together — this saves the cross-check
        # round trip before the response can render. Provenance semantics
        # are unchanged: the cross-check still names its own source, and a
        # failed primary fetch still returns the "unavailable" payload.
        (data, prov), (cross, cross_prov) = await asyncio.gather(
            _live_current(loc["latitude"], loc["longitude"]),
            _cross_check(loc["latitude"], loc["longitude"]),
        )
        return {
            "location": loc, "current": data, "provenance": prov,
            "cross_check": {"data": cross, "provenance": cross_prov} if cross else None,
            "generated_at": iso_now(),
        }
    except AdapterUnavailable as exc:
        return {
            "status": "unavailable", "message": UNAVAILABLE_MSG, "detail": str(exc),
            "provenance": "UNAVAILABLE", "location": loc, "generated_at": iso_now(),
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
        data = await IMDService(adapter="live").get_district_nowcast(loc.get("district", district))
        prov = "LIVE"
    except AdapterUnavailable:
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

    # Single IMD-first mode: official IMD warning + SACHET/CAP alerts, each
    # honest about availability. IMD is always tried first; the CAP chain
    # engages regardless. `warn_call_ok` separates two facts that must never
    # be conflated:
    #   - the service answered and had no active warning  -> reachable, calm
    #   - we could not reach the service at all           -> reachable=False, UNKNOWN
    warning, verified_d, warn_prov = None, None, "UNAVAILABLE"
    warn_call_ok = False
    try:
        w = await s["imd"].get_district_warning(district_name)
        warn_call_ok = True  # the service answered, possibly with nothing to report
        v = s["val"].validate_warning(w, district_name) if w else None
        warning = w.model_dump(mode="json") if w else None
        verified_d = v.model_dump(mode="json") if v else None
        warn_prov = "LIVE"  # provenance of the CHECK, not of a warning that may be absent
    except AdapterUnavailable:
        warning, verified_d, warn_prov = None, None, "UNAVAILABLE"

    # A warning for a different district is context, not this district's warning.
    # The validation layer already ran the location check; read its verdict.
    warn_matches_location = (
        (verified_d or {}).get("validation", {}).get("location", "PASS") == "PASS"
        if warning else True
    )

    # One gatherer for both this endpoint and /api/chat, so the Alerts page and
    # the chat verdict can never see a different set of alerts (alert_service).
    gathered = await gather_alerts(lat=lat, lon=lon, district=district_name,
                                   state=loc.get("state") or "")
    cap_alerts = gathered["relevant"]
    nearby_alerts = gathered["nearby"]
    cap_prov = gathered["provenance"]
    # Warnings were checked if IMD answered OR the official SACHET feed answered
    # live. An unconfigured IMD key is not an outage when SACHET was read.
    warning_service_available = warn_call_ok or bool(gathered.get("official_available"))
    checked = (["IMD"] if warn_call_ok else []) + (
        ["NDMA-SACHET"] if gathered.get("official_available") else [])
    unchecked = [] if warn_call_ok else ["IMD"]

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
                checked_sources=checked, unchecked_sources=unchecked,
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
            checked_sources=checked, unchecked_sources=unchecked,
        ),
        "generated_at": iso_now(),
    }


@router.get("/risk")
async def risk(severity: str = "YELLOW", user_type: str = "general") -> dict:
    s = _services()
    r = s["risk"].risk({"severity": severity, "hazard": "Thunderstorm"}, user_type)
    return {"risk": r, "generated_at": iso_now()}
