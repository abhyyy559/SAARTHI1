"""Aviation briefing endpoint — deterministic assembly, no LLM anywhere in
this path (see backend/services/aviation_service.py)."""
from fastapi import APIRouter

from ..services import aviation_service
from ..utils.time import iso_now

router = APIRouter(prefix="/api/aviation")


@router.get("/briefing")
async def aviation_briefing(lat: float = 17.385, lon: float = 78.4867, lang: str = "en") -> dict:
    """Location-based aviation briefing: winds aloft (GFS), cloud/visibility
    proxies, turbulence-icing proxies, sunrise/sunset, official alerts."""
    briefing = await aviation_service.build_briefing(lat=lat, lon=lon, lang=lang)
    briefing["generated_at"] = iso_now()
    return briefing
