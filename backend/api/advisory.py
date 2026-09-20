"""Advisory endpoint — persona guidance, explicitly NOT an official instruction (§38)."""
import asyncio
from typing import Optional

from fastapi import APIRouter

from . import weather as weather_mod
from .. import config
from ..adapters.registry import AdapterUnavailable
from ..services.advisory_cards_service import advisory_cards
from ..services.advisory_service import advisory_for, weather_advisories, weather_advisories_text
from ..services.location_service import LocationService
from ..utils.time import iso_now

router = APIRouter(prefix="/api")


@router.get("/advisory/cards")
async def advisory_cards_endpoint(lat: float = 17.385, lon: float = 78.4867,
                                  lang: str = "en", persona: str = "general") -> dict:
    """Situation-aware advisory cards: current obs + 3-day forecast + official
    alert verdict, fetched concurrently and composed by the deterministic
    advisory_cards_service rules engine (trilingual templates, no LLM).

    Reuses weather.py's _live_current/_live_forecast helpers, preserving
    provenance and the imd-mode official-only rule: imd mode raises rather than
    backfilling with non-official sources, and surfaces as UNAVAILABLE.
    """
    district = (LocationService().resolve(lat, lon) or {}).get("district") or ""
    if config.DEMO_MODE:
        # Demo branches read fixtures even when IMD_ADAPTER=live (same rule as
        # weather.py::_services).
        imd = weather_mod._services()["imd"]
        cur_d = (await imd.get_current_weather(lat, lon)).model_dump(mode="json")
        fc_d = (await imd.get_forecast(lat, lon)).model_dump(mode="json")
        prov_c = prov_f = "DEMO"
        alerts_d = await weather_mod.warnings(district, lat, lon)
    else:
        async def _safe_current():
            try:
                return await weather_mod._live_current(lat, lon)
            except AdapterUnavailable:
                return None, "UNAVAILABLE"

        async def _safe_forecast():
            try:
                return await weather_mod._live_forecast(lat, lon)
            except AdapterUnavailable:
                return None, "UNAVAILABLE"

        async def _safe_warnings():
            # warnings() is internally honest; an unexpected failure must not
            # take the whole cards response down with it.
            try:
                return await weather_mod.warnings(district, lat, lon)
            except Exception:
                return {}

        # LATENCY: current + forecast + alerts are independent, so they run
        # together (same pattern as weather.py::current_wx). Provenance
        # semantics are unchanged.
        (cur_d, prov_c), (fc_d, prov_f), alerts_d = await asyncio.gather(
            _safe_current(), _safe_forecast(), _safe_warnings())
    alerts_d = alerts_d if isinstance(alerts_d, dict) else {}
    verdict = alerts_d.get("verdict") or {}
    alerts = alerts_d.get("cap_alerts") or []
    alerts_prov = alerts_d.get("cap_provenance") or "UNAVAILABLE"
    cards = advisory_cards(
        current=cur_d, forecast=fc_d, alerts=alerts, verdict=verdict,
        persona=persona, lang=lang,
        current_prov=prov_c, forecast_prov=prov_f, alerts_prov=alerts_prov)
    return {
        "cards": cards,
        "district": district,
        "persona": persona,
        "lang": lang,
        "provenance": {"current": prov_c, "forecast": prov_f, "alerts": alerts_prov},
        "official_instruction": False,
        "generated_at": iso_now(),
    }


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
