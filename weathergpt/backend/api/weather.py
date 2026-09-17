"""Weather endpoints — demo fixtures or live adapters, always provenance-labelled (§51).

Live chain: Open-Meteo LIVE -> file cache CACHED -> honest UNAVAILABLE (§54).
Demo chain: fixtures labelled DEMO. Nothing presented as live when it is not.
"""
import asyncio
from datetime import timedelta
from typing import Optional
from fastapi import APIRouter

from .. import config
from ..adapters import cap_adapter, openmeteo_adapter, owm_adapter
from ..adapters.registry import AdapterUnavailable
from ..models.weather import Location, NormalizedWeather
from ..services import nwp_service
from ..services.cache_service import CacheService, TTLS
from ..services.gis_service import warning_relevant
from ..services.imd_service import IMDService
from ..services.location_service import LocationService
from ..services.risk_service import RiskService
from ..services.validation_service import ValidationService
from ..utils.time import iso_now

router = APIRouter(prefix="/api")
cache = CacheService()

UNAVAILABLE_MSG = "Weather information is temporarily unavailable."


def _services():
    imd = IMDService()
    return {"imd": imd, "val": ValidationService(imd), "risk": RiskService(), "loc": LocationService()}


def _key(kind: str, lat: float, lon: float, extra: str = "") -> str:
    return f"{kind}:{round(lat, 2)}:{round(lon, 2)}:{extra}"


def _as_json(x) -> dict:
    """Adapters return pydantic models or dicts; normalize for cache/response."""
    return x if isinstance(x, dict) else x.model_dump(mode="json")


async def _live_current(lat: float, lon: float) -> tuple[dict, str]:
    """Open-Meteo primary, OpenWeatherMap fallback, file cache last (all honest)."""
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
        fc, _ = await openmeteo_adapter.get_forecast(lat, lon)
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
            data, prov = await _live_current(loc["latitude"], loc["longitude"])
            cross, cross_prov = await _cross_check(loc["latitude"], loc["longitude"])
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
        obs = None
        data = None
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
    loc = s["loc"].resolve(lat, lon) if (lat is not None and lon is not None) else {"district": district}
    district_name = loc.get("district", district)

    if config.DEMO_MODE:
        w = await s["imd"].get_district_warning(district_name)
        verified = s["val"].validate_warning(w, district_name) if w else None
        cap_alerts, cap_prov = cap_adapter.demo_fixture()
        for a in cap_alerts:
            a["relevance"] = warning_relevant(a, lat, lon, district_name)
        return {
            "location": loc,
            "warning": w.model_dump(mode="json") if w else None,
            "verified": verified.model_dump(mode="json") if verified else None,
            "cap_alerts": cap_alerts, "cap_provenance": cap_prov,
            "provenance": "DEMO", "generated_at": iso_now(),
        }

    # LIVE: official IMD warning + CAP alerts, each honest about availability.
    warning, verified_d, warn_prov = None, None, "UNAVAILABLE"
    try:
        w = await s["imd"].get_district_warning(district_name)
        v = s["val"].validate_warning(w, district_name) if w else None
        warning = w.model_dump(mode="json") if w else None
        verified_d = v.model_dump(mode="json") if v else None
        warn_prov = "LIVE" if w else "UNAVAILABLE"
    except AdapterUnavailable:
        warning, verified_d, warn_prov = None, None, "UNAVAILABLE"

    cap_alerts: list[dict] = []
    cap_prov = "UNCONFIGURED"
    try:
        alerts, cap_prov = await cap_adapter.fetch_alerts()
        for a in alerts:
            a["relevance"] = warning_relevant(a, lat, lon, district_name)
        cap_alerts = [a for a in alerts if a["relevance"]["relevant"]]
    except AdapterUnavailable:
        pass

    if warning is None and not cap_alerts:
        return {
            "status": "unavailable", "message": "Warning information is temporarily unavailable.",
            "provenance": "UNAVAILABLE", "location": loc, "generated_at": iso_now(),
        }
    return {
        "location": loc, "warning": warning, "verified": verified_d,
        "warning_provenance": warn_prov, "cap_alerts": cap_alerts,
        "cap_provenance": cap_prov, "generated_at": iso_now(),
    }


@router.get("/risk")
async def risk(severity: str = "YELLOW", user_type: str = "general") -> dict:
    s = _services()
    r = s["risk"].risk({"severity": severity, "hazard": "Thunderstorm"}, user_type)
    return {"risk": r, "generated_at": iso_now()}
