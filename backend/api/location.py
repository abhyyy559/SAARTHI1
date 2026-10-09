"""Location endpoint."""
from fastapi import APIRouter
from ..services.location_service import GAZETTEER, LocationService
from ..utils.time import iso_now

router = APIRouter()
svc = LocationService()


@router.get("/api/location/resolve")
async def resolve(lat: float | None = None, lon: float | None = None, q: str = "") -> dict:
    loc = svc.resolve(lat, lon, q)
    return {"location": loc}


@router.get("/api/location/search")
async def search(q: str) -> dict:
    return {"results": svc.search(q)}


@router.get("/api/location/districts")
async def districts() -> dict:
    """Static district coordinate table for the schematic warning map.

    Pure geography (names + centroids) — no live data, nothing that can go
    stale. The frontend caches it in localStorage, so the map renders fully
    offline after the first load.
    """
    return {
        "districts": [
            {
                "district": e.get("district"),
                "state": e.get("state"),
                "latitude": e.get("latitude"),
                "longitude": e.get("longitude"),
                "coastal": bool(e.get("coastal")),
            }
            for e in GAZETTEER
            if e.get("district") and e.get("latitude") is not None
        ],
        "generated_at": iso_now(),
    }