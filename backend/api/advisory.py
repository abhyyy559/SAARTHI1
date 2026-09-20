"""Advisory endpoint — persona guidance, explicitly NOT an official instruction (§38)."""
from typing import Optional

from fastapi import APIRouter

from ..services.advisory_service import advisory_for, weather_advisories, weather_advisories_text
from ..utils.time import iso_now

router = APIRouter(prefix="/api")


@router.get("/advisory")
async def advisory(severity: str = "GREEN", hazard: str = "", user_type: str = "general",
                   language: str = "en", rain_mm: Optional[float] = None,
                   wind_kph: Optional[float] = None, temp_c: Optional[float] = None) -> dict:
    sev = (severity or "GREEN").upper()
    verified = {"verified": sev not in ("GREEN", "NONE", ""), "severity": sev, "hazard": hazard}
    floor = advisory_for(verified, user_type, language)
    # Rule layer (T2.1 S2.1.3): append-only, never softens the floor above.
    current = {"rain_mm": rain_mm, "wind_kph": wind_kph, "temp_c": temp_c}
    extra = weather_advisories(current, None, user_type, language)
    return {
        "advisory": floor + weather_advisories_text(extra, language),
        "user_type": user_type,
        "official_instruction": False,
        "note": "WeatherGPT contextual recommendation — not an official government instruction.",
        "generated_at": iso_now(),
    }
