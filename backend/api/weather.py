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
    # Demo branches below must read fixtures even when IMD_ADAPTER=live is set
    # explicitly; otherwise they hit the live endpoint and 500 (AdapterUnavailable).
    # Non-demo modes always use the live adapter so `imd` can never serve a
    # fixture as if it were official.
    imd = IMDService(adapter="demo" if config.DEMO_MODE else "live")
    return {"imd": imd, "val": ValidationService(imd), "risk": RiskService(), "loc": LocationService()}


def _key(kind: str, lat: float, lon: float, extra: str = "") -> str:
    return f"{kind}:{round(lat, 2)}:{round(lon, 2)}:{extra}"


def _as_json(x) -> dict:
    """Adapters return pydantic models or dicts; normalize for cache/response."""
    return x if isinstance(x, dict) else x.model_dump(mode="json")


async def _live_current(lat: float, lon: float) -> tuple[dict, str]:
    """IMD first whenever official access works, then Open-Meteo,
    OpenWeatherMap, file cache last. Provenance names the actual source."""
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


@router.get("/weather/current")
async def current_wx(lat: float = 17.385, lon: float = 78.4867, district: Optional[str] = None) -> dict:
    s = _services()
    loc = s["loc"].resolve(lat, lon)
    if district:
        loc["district"] = district
    if config.DEMO_MODE:
        obs = await s["imd"].get_current_weather(loc["latitude"], loc["longitude"])
        cross, cross_prov = None, "UNCONFIGURED"
        prov = "DEMO"
    else:
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
    return {
        "location": loc,
        "current": obs.model_dump(mode="json") if obs is not None else data,
        "provenance": prov, "generated_at": iso_now(),
    }


@router.get("/weather/forecast")
async def forecast(lat: float = 17.385, lon: float = 78.4867) -> dict:
    s = _services()
    loc = s["loc"].resolve(lat, lon)
    if config.DEMO_MODE:
        fc = await s["imd"].get_forecast(loc["latitude"], loc["longitude"])
        return {"location": loc, "forecast": fc.model_dump(mode="json"), "provenance": "DEMO", "generated_at": iso_now()}
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
    if config.DEMO_MODE:
        text = await s["imd"].get_district_nowcast(district)
        return {"district": district, "nowcast": text, "provenance": "DEMO", "generated_at": iso_now()}
    loc = s["loc"].resolve(lat, lon)
    try:
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

    if config.DEMO_MODE:
        w = await s["imd"].get_district_warning(district_name)
        verified = s["val"].validate_warning(w, district_name) if w else None
        cap_alerts, cap_prov = cap_adapter.demo_fixture(district_name)
        # Same classifier the live path uses, so a demo fixture and a real feed
        # cannot disagree about what counts as relevant.
        state_name = loc.get("state") or district_service.state_of(district_name)
        for a in cap_alerts:
            classify_alert(a, lat=lat, lon=lon, district=district_name, state_name=state_name)
        warning_d = w.model_dump(mode="json") if w else None
        verified_d = verified.model_dump(mode="json") if verified else None
        # Fixtures always answer, so the warning service is genuinely available.
        verdict = build_verdict(
            verified=verified_d, warning=warning_d,
            cap_alerts=[a for a in cap_alerts if a["relevance"]["relevant"]],
            nearby_alerts=[], warning_service_available=True,
        )
        return {
            "status": "ok",
            "location": loc,
            "warning": warning_d,
            "verified": verified_d,
            "cap_alerts": cap_alerts, "cap_provenance": cap_prov,
            "provenance": "DEMO", "verdict": verdict, "generated_at": iso_now(),
        }

    # LIVE: official IMD warning + CAP alerts, each honest about availability.
    # `warn_call_ok` separates two facts that must never be conflated:
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

    warning_service_available = warn_call_ok

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
