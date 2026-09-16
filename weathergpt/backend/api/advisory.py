"""Advisory endpoint — persona guidance, explicitly NOT an official instruction (§38)."""
from fastapi import APIRouter

from ..services.advisory_service import advisory_for
from ..utils.time import iso_now

router = APIRouter(prefix="/api")


@router.get("/advisory")
async def advisory(severity: str = "GREEN", hazard: str = "", user_type: str = "general") -> dict:
    sev = (severity or "GREEN").upper()
    verified = {"verified": sev not in ("GREEN", "NONE", ""), "severity": sev, "hazard": hazard}
    return {
        "advisory": advisory_for(verified, user_type),
        "user_type": user_type,
        "official_instruction": False,
        "note": "WeatherGPT contextual recommendation — not an official government instruction.",
        "generated_at": iso_now(),
    }
