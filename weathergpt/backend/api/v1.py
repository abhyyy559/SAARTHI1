"""Versioned API v1 (§39). Core reads reuse existing handlers; new logic (impact,
emergency, reports, status) lives here. Old /api/* routes keep working."""
from typing import Optional

from fastapi import APIRouter

from .. import config
from ..adapters import cap_adapter
from ..adapters.registry import AdapterUnavailable, snapshot
from ..models.emergency import EMERGENCY_TYPES
from ..services import impact_service, rag_service, report_service
from ..services.emergency_service import EmergencyMessagingService, inbox
from ..services.location_service import LocationService
from ..utils.time import iso_now
from . import advisory as advisory_mod
from . import chat as chat_mod
from . import climate as climate_mod
from . import location as location_mod
from . import weather as weather_mod
from ..models.chat import ChatRequest

router = APIRouter(prefix="/api/v1")
_emergency = EmergencyMessagingService()


@router.get("/weather/current")
async def v1_current(lat: float = 17.385, lon: float = 78.4867):
    return await weather_mod.current_wx(lat, lon)


@router.get("/weather/forecast")
async def v1_forecast(lat: float = 17.385, lon: float = 78.4867):
    return await weather_mod.forecast(lat, lon)


@router.get("/warnings")
async def v1_warnings(district: str = "Hyderabad", lat: Optional[float] = None, lon: Optional[float] = None):
    return await weather_mod.warnings(district, lat, lon)


@router.get("/warnings/{warning_id}")
async def v1_warning_by_id(warning_id: str):
    """Lookup by CAP identifier (or 'imd-warning' for the active IMD warning)."""
    if warning_id == "imd-warning":
        d = await weather_mod.warnings("Hyderabad")
        if d.get("warning"):
            return {"warning": d["warning"], "provenance": d.get("warning_provenance", d.get("provenance"))}
        return {"status": "not-found", "warning_id": warning_id}
    try:
        alerts, prov = await cap_adapter.fetch_alerts()
    except AdapterUnavailable:
        return {"status": "unavailable", "provenance": "UNAVAILABLE",
                "note": "no official CAP feed configured - nothing invented"}
    for a in alerts:
        if a.get("identifier") == warning_id:
            return {"warning": a, "provenance": prov}
    return {"status": "not-found", "warning_id": warning_id}


@router.get("/impact/analyze")
async def v1_impact(lat1: float, lon1: float, lat2: float, lon2: float, user_type: str = "driver"):
    data, prov = await impact_service.analyze_route(lat1, lon1, lat2, lon2, user_type)
    return {**data, "provenance": prov, "generated_at": iso_now()}


@router.get("/advisories")
async def v1_advisories(severity: str = "GREEN", hazard: str = "", user_type: str = "general",
                        language: str = "en", district: Optional[str] = None,
                        lat: Optional[float] = None, lon: Optional[float] = None):
    if district is not None:
        from ..services.advisory_service import advisory_for
        data = await weather_mod.warnings(district, lat, lon)
        verified = data.get("verified") or {}
        unavailable = data.get("status") == "unavailable" or not data.get("provenance") or data.get("provenance") == "UNAVAILABLE"
        return {
            "advisory": advisory_for(verified, user_type, language,
                                     warning_status="unavailable" if unavailable else ""),
            "user_type": user_type, "language": language,
            "official_instruction": False,
            "provenance": data.get("provenance", "UNAVAILABLE"),
            "generated_at": iso_now(),
        }
    return await advisory_mod.advisory(severity, hazard, user_type, language)


@router.post("/chat")
async def v1_chat(payload: dict):
    """Accepts spec shape {message, location:{lat,lon}, context, language} or flat shape."""
    loc = payload.get("location") or {}
    req = ChatRequest(
        message=payload.get("message", ""),
        latitude=loc.get("lat", payload.get("latitude", 17.385)),
        longitude=loc.get("lon", payload.get("longitude", 78.4867)),
        language=payload.get("language", "en"),
        user_type=payload.get("context", payload.get("user_type", "general")),
    )
    r = await chat_mod.chat(req)
    d = r.model_dump(mode="json")
    warn = d.get("warning") or {}
    d["risk"] = {**d.get("risk", {}),
                 "reason": ("Official warning information is unavailable; risk cannot be confirmed."
                            if d.get("risk", {}).get("level") == "UNKNOWN" else
                            f"{warn.get('severity')} {warn.get('hazard')}" if warn.get("active")
                            else "no active verified hazard")}
    d["location_affected"] = bool(warn.get("active"))
    provs = [e.get("provenance") for e in d.get("evidence", [])]
    d["data_freshness"] = provs[0] if provs else "UNAVAILABLE"
    return d


@router.get("/location/resolve")
async def v1_resolve(lat: Optional[float] = None, lon: Optional[float] = None, q: str = ""):
    return {"location": LocationService().resolve(lat, lon, q)}


@router.get("/climate/trends")
async def v1_climate(lat: float = 17.385, lon: float = 78.4867, years: int = 20):
    return await climate_mod.climate_trends(lat, lon, years)


@router.post("/emergency/messages")
async def v1_emergency_send(payload: dict):
    mtype = payload.get("message_type", "NEED_HELP")
    if mtype not in EMERGENCY_TYPES:
        return {"status": "error", "reason": f"unknown message_type (see {EMERGENCY_TYPES})"}
    res = await _emergency.sendEmergencyMessage(payload.get("sender_id", "anonymous"), payload)
    return {"status": "queued", **res, "generated_at": iso_now()}


@router.get("/emergency/messages")
async def v1_emergency_inbox():
    return {"messages": inbox(), "generated_at": iso_now()}


@router.post("/emergency/sync")
async def v1_emergency_sync():
    return {**_emergency.syncWhenConnected(), "generated_at": iso_now()}


@router.get("/emergency/guidance")
async def v1_guidance(q: str, lang: str = "en"):
    """RAG retrieval over local emergency docs (also serves offline Q&A content)."""
    return {"hits": rag_service.retrieve(q, lang), "generated_at": iso_now()}


@router.post("/reports")
async def v1_report(payload: dict):
    """Community hazard report — ALWAYS labelled COMMUNITY, never official (§34)."""
    try:
        rep = report_service.submit(
            payload.get("report_type", ""), float(payload.get("latitude", 0)),
            float(payload.get("longitude", 0)), payload.get("district", ""),
            payload.get("text", ""), payload.get("reporter_id", "anonymous"))
    except (ValueError, TypeError) as exc:
        return {"status": "error", "reason": str(exc)}
    return {"status": "stored-community-report",
            "note": "Community report — not an official warning.",
            "report": rep.model_dump(mode="json")}


@router.get("/reports")
async def v1_reports(district: str = ""):
    return {"reports": report_service.list_reports(district), "generated_at": iso_now()}


@router.get("/system/status")
async def v1_status():
    """Connectivity + freshness overview (§41). OFFLINE is a client-measured state;
    backend reports its own reachability view: LIVE vs LIMITED."""
    srcs = snapshot()
    live_n = sum(1 for s in srcs if s["status"] == "LIVE")
    state = "LIVE" if (live_n >= 2 and not config.DEMO_MODE) else "LIMITED"
    if config.DEMO_MODE:
        state = "LIMITED"
    return {
        "state": state,
        "internet_status": "reachable",
        "demo_mode": config.DEMO_MODE,
        "last_sync": iso_now(),
        "data_source_status": srcs,
        "needs_keys": {
            "DATAGOV_API_KEY": not bool(config.DATAGOV_API_KEY),
            "OWM_API_KEY": not bool(config.OWM_API_KEY),
            "SARVAM_API_KEY": not bool(config.SARVAM_API_KEY),
            "CAP_FEED_URL": not bool(config.CAP_FEED_URL),
        },
        "generated_at": iso_now(),
    }
