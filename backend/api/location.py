"""Location endpoint."""
from fastapi import APIRouter
from ..services.location_service import LocationService

router = APIRouter()
svc = LocationService()


@router.get("/api/location/resolve")
async def resolve(lat: float | None = None, lon: float | None = None, q: str = "") -> dict:
    loc = svc.resolve(lat, lon, q)
    return {"location": loc}


@router.get("/api/location/search")
async def search(q: str) -> dict:
    return {"results": svc.search(q)}