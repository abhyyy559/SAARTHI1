"""Climate trends endpoint — real ERA5 series, honestly labelled (§17, §43)."""
import time

from fastapi import APIRouter

from ..adapters.registry import AdapterUnavailable
from ..services import climate_service
from ..services.location_service import LocationService
from ..utils.time import iso_now

router = APIRouter(prefix="/api")

# Complete years only, so the answer changes once a year: one 20-year ERA5
# download per place per 12 h instead of one per screen view.
_TTL_S = 12 * 3600
_cache: dict[tuple, tuple[dict, str, float]] = {}


@router.get("/climate/trends")
async def climate_trends(lat: float = 17.385, lon: float = 78.4867, years: int = 20) -> dict:
    loc = LocationService().resolve(lat, lon)
    years = max(5, min(30, years))
    key = (round(lat, 2), round(lon, 2), years)
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[2] < _TTL_S:
        return {"location": loc, "trends": hit[0], "provenance": hit[1], "generated_at": iso_now()}
    try:
        data, prov = await climate_service.trends(lat, lon, years)
        _cache[key] = (data, prov, time.monotonic())
    except AdapterUnavailable as exc:
        return {
            "status": "unavailable",
            "message": "Historical climate information is temporarily unavailable.",
            "detail": str(exc), "provenance": "UNAVAILABLE",
            "location": loc, "generated_at": iso_now(),
        }
    return {"location": loc, "trends": data, "provenance": prov, "generated_at": iso_now()}
