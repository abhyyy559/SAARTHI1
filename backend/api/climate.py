"""Climate trends endpoint — real ERA5 series or labelled DEMO series (§17, §43)."""
from fastapi import APIRouter

from .. import config
from ..adapters.registry import AdapterUnavailable
from ..services import climate_service
from ..services.location_service import LocationService
from ..utils.time import iso_now

router = APIRouter(prefix="/api")


@router.get("/climate/trends")
async def climate_trends(lat: float = 17.385, lon: float = 78.4867, years: int = 20) -> dict:
    loc = LocationService().resolve(lat, lon)
    years = max(5, min(30, years))
    if config.DEMO_MODE:
        data, prov = climate_service.demo_series()
    else:
        try:
            data, prov = await climate_service.trends(lat, lon, years)
        except AdapterUnavailable as exc:
            return {
                "status": "unavailable",
                "message": "Historical climate information is temporarily unavailable.",
                "detail": str(exc), "provenance": "UNAVAILABLE",
                "location": loc, "generated_at": iso_now(),
            }
    return {"location": loc, "trends": data, "provenance": prov, "generated_at": iso_now()}
