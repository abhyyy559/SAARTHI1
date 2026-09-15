"""Weather endpoints - orchestrates IMD + validation + risk + advisory + evidence."""
import asyncio
from typing import Optional
from fastapi import APIRouter, Depends
from ..models.weather import NormalizedWeather, Location
from ..services.imd_service import IMDService
from ..services.validation_service import ValidationService
from ..services.risk_service import RiskService
from ..services.location_service import LocationService
from ..utils.time import iso_now

router = APIRouter(prefix="/api")


def _services():
    imd = IMDService()
    return {"imd": imd, "val": ValidationService(imd), "risk": RiskService(), "loc": LocationService()}


async def _gather(imd: IMDService, loc: dict) -> dict:
    current, forecast, warning = await asyncio.gather(
        imd.get_current_weather(loc["latitude"], loc["longitude"]),
        imd.get_forecast(loc["latitude"], loc["longitude"]),
        imd.get_district_warning(loc["district"]),
    )
    return {"current": current, "forecast": forecast, "warning": warning}


@router.get("/weather/current")
async def current_wx(lat: float = 17.385, lon: float = 78.4867, district: Optional[str] = None) -> dict:
    s = _services()
    loc = s["loc"].resolve(lat, lon)
    if district:
        loc["district"] = district
    obs = await s["imd"].get_current_weather(loc["latitude"], loc["longitude"])
    return {"location": loc, "current": obs.model_dump(mode="json"), "generated_at": iso_now()}


@router.get("/weather/forecast")
async def forecast(lat: float = 17.385, lon: float = 78.4867) -> dict:
    s = _services()
    loc = s["loc"].resolve(lat, lon)
    fc = await s["imd"].get_forecast(loc["latitude"], loc["longitude"])
    return {"location": loc, "forecast": fc.model_dump(mode="json"), "generated_at": iso_now()}


@router.get("/weather/warnings")
async def warnings(district: str = "Hyderabad") -> dict:
    s = _services()
    loc = s["loc"].resolve(None, None) if not district else {"district": district}
    w = await s["imd"].get_district_warning(loc.get("district", district))
    verified = s["val"].validate_warning(w, loc.get("district", district)) if w else None
    return {"location": loc, "warning": w.model_dump(mode="json") if w else None, "verified": verified.model_dump(mode="json") if verified else None, "generated_at": iso_now()}


@router.get("/risk")
async def risk(severity: str = "YELLOW", user_type: str = "general") -> dict:
    s = _services()
    r = s["risk"].risk({"severity": severity, "hazard": "Thunderstorm"}, user_type)
    return {"risk": r, "generated_at": iso_now()}