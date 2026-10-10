"""Weather grid for the Alerts-page map (see services/map_grid_service.py)."""
from fastapi import APIRouter

from ..services import map_grid_service

router = APIRouter()


@router.get("/api/map/grid")
async def grid() -> dict:
    """Temperature, rain and wind every 2° over India, now and for three days."""
    return await map_grid_service.get_grid()
