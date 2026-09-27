"""Versioned API v1 (§39). Core reads reuse existing handlers; new logic (impact,
emergency, reports, status) lives here. Old /api/* routes keep working."""
from typing import Optional

from fastapi import APIRouter, HTTPException

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
                        lat: Optional[float] = None, lon: Optional[float] = None,
                        rain_mm: Optional[float] = None, wind_kph: Optional[float] = None,
                        temp_c: Optional[float] = None, humidity_pct: Optional[float] = None):
    from ..services.advisory_service import weather_advisories, weather_advisories_text
    # Rule layer (T2.1 S2.1.3): append-only weather-grounded lines; never softens the floor.
    # When the client did not pass weather numbers, the server fetches the current
    # observation for lat/lon itself (DEMO fixtures / live chain / UNAVAILABLE —
    # same provenance semantics as /api/advisory/cards), so persona advice reflects
    # real conditions, not alerts alone. Missing/unreachable weather yields no
    # lines — never an invented calm, never a false all-clear.
    _current, _weather_basis = await weather_mod.resolve_advisory_weather(
        lat, lon, {"rain_mm": rain_mm, "wind_kph": wind_kph,
                   "temp_c": temp_c, "humidity_pct": humidity_pct})
    _rule_extra = weather_advisories_text(
        weather_advisories(_current, None, user_type, language), language)
    if district is not None:
        from ..services.advisory_service import advisory_for, caveat_for
        data = await weather_mod.warnings(district, lat, lon)
        verified = data.get("verified") or {}
        # Live warnings() reports per-source keys (warning_provenance /
        # cap_provenance); only the unavailable-status branch carries a
        # top-level "provenance". Checking only the top level mislabels live
        # success as unreachable.
        provs = [data.get("provenance"), data.get("warning_provenance"), data.get("cap_provenance")]
        live = [p for p in provs if p and p not in ("UNAVAILABLE", "UNCONFIGURED")]
        prov = live[0] if live else "UNAVAILABLE"
        # The server-side verdict is authoritative: UNKNOWN means the warning
        # service could not be reached, which is NOT the same as "no warning".
        # Provenance alone wrongly looks reachable when only the CAP feed is
        # live, so prefer the verdict and fall back to the old rule if absent.
        verdict = data.get("verdict") or {}
        if verdict:
            unavailable = verdict.get("level") == "UNKNOWN" or data.get("status") == "unavailable"
        else:
            unavailable = data.get("status") == "unavailable" or not live
        nearby = data.get("nearby_alerts") or []
        cap_relevant = data.get("cap_alerts") or []
        nearby_count = verdict.get("nearby_count", len(nearby)) if verdict else len(nearby)
        # The verdict MUST be handed to advisory_for. Without it, advisory_for
        # falls back to reading only the IMD `verified` block — so when IMD is
        # down but SACHET/CAP is live and naming the user's district, the page
        # said "no severe-weather warning" directly above three official YELLOW
        # alerts for that same district. The verdict is the one severity
        # authority; the advisory has to read from it like every other view.
        # `coastal` comes from the resolved location, so a sea-going persona in an
        # inland district is told that plainly instead of being sent to a shore
        # that does not exist.
        resolved = data.get("location") or {}
        advice = advisory_for(verified, user_type, language, verdict=verdict,
                              coastal=resolved.get("coastal"),
                              district=resolved.get("district") or district,
                              warning_status="unavailable" if unavailable else "")
        if (not unavailable and not (verified or {}).get("verified")
                and not cap_relevant and nearby_count):
            # Nothing relevant to this district, but official state-level alerts
            # exist: say so plainly without promoting them to a warning.
            # One short sentence — the area enumeration was unreadable and is
            # already shown alert-by-alert on the Alerts page. Guarded on
            # `cap_relevant` because when an alert IS relevant to this district
            # the line above already reported it, and appending "none is
            # verified for <district>" would contradict the alert list.
            advice = (f"{advice} Note: {nearby_count} official state-level alerts "
                      f"are active in your state, but none is verified for {district} specifically.")
        return {
            "advisory": advice + _rule_extra,
            "weather_basis": _weather_basis,
            "caveat": caveat_for(user_type, language),
            "user_type": user_type, "language": language,
            "official_instruction": False,
            "provenance": prov,
            "verdict": verdict,
            "relevant_alerts": len(cap_relevant),
            "generated_at": iso_now(),
        }
    # No district = no verified warning data. A client-supplied non-GREEN severity
    # here would invent an active-warning advisory out of thin air — reject it.
    sev_norm = (severity or "GREEN").upper()
    if sev_norm not in ("GREEN", "NONE", ""):
        raise HTTPException(
            status_code=400,
            detail=(f"severity '{severity}' is not allowed without a district: a client-supplied "
                    "non-GREEN severity cannot be used to build an advisory without verified "
                    "district warning data. Pass ?district=<name> or omit severity (GREEN)."),
        )
    r = await advisory_mod.advisory(severity, hazard, user_type, language,
                                    rain_mm, wind_kph, temp_c,
                                    humidity_pct=humidity_pct, lat=lat, lon=lon)
    return r


from fastapi import Response

@router.post("/chat")
async def v1_chat(payload: dict, response: Response):
    """Accepts spec shape {message, location:{lat,lon}, context, language} or flat shape."""
    loc = payload.get("location") or {}
    req = ChatRequest(
        message=payload.get("message", ""),
        latitude=loc.get("lat", payload.get("latitude", 17.385)),
        longitude=loc.get("lon", payload.get("longitude", 78.4867)),
        language=payload.get("language", "en"),
        user_type=payload.get("context", payload.get("user_type", "general")),
    )
    r = await chat_mod.chat(req, response)
    d = r.model_dump(mode="json")
    warn = d.get("warning") or {}
    verdict = d.get("verdict") or {}
    d["risk"] = {**d.get("risk", {}),
                 "reason": ("Official warning information is unavailable; risk cannot be confirmed."
                            if d.get("risk", {}).get("level") == "UNKNOWN" else
                            f"{verdict.get('severity') or warn.get('severity')} "
                            f"{verdict.get('hazard') or warn.get('hazard')}"
                            if verdict.get("confirmed") else
                            "no active verified hazard")}
    # The verdict is the authority, not the IMD-only warning block: a CAP-confirmed
    # hazard affects the user even when IMD reported nothing.
    d["location_affected"] = bool(verdict.get("confirmed"))
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


@router.post("/emergency/simulate")
async def v1_emergency_simulate(payload: dict):
    """Stage demo of the A→B→C store-and-forward chain. The packet carries a
    SIMULATED provenance label end to end — never mistaken for a live relay."""
    from ..services.emergency_service import EmergencyMessagingService, SimulatedTransport
    mtype = payload.get("message_type", "NEED_HELP")
    if mtype not in EMERGENCY_TYPES:
        return {"status": "error", "reason": f"unknown message_type (see {EMERGENCY_TYPES})"}
    demo = EmergencyMessagingService(SimulatedTransport())
    res = await demo.sendEmergencyMessage(payload.get("sender_id", "demo-A"), payload)
    # Build a visual hop trace the UI can render without interpreting.
    now = iso_now()
    trace = [
        {"node": "you", "icon": "phone", "state": "sealed", "at": now, "detail": "Encrypted + signed"},
        {"node": "relay-a", "icon": "radio", "state": "received", "at": now, "detail": "Store-and-forward"},
        {"node": "relay-b", "icon": "radio", "state": "forwarded", "at": now, "detail": "Hop 2/10"},
        {"node": "relay-c", "icon": "radio", "state": "forwarded", "at": now, "detail": "Hop 3/10"},
        {"node": "out", "icon": "check", "state": "delivered", "at": now, "detail": "SIMULATED"},
    ]
    return {
        "status": "relayed-simulated",
        **res,
        "trace": trace,
        "properties": {
            "sealed": True,
            "tamper_proof": True,
            "hop_limit": 10,
            "hops_used": 3,
            "queued": True,
            "provenance": "SIMULATED",
        },
        "generated_at": now,
    }


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
    # Persistence backend: postgres when DATABASE_URL works, else JSON files.
    # Reported so an operator can SEE that alerts/acks survive a redeploy.
    from ..services import db
    dbh = await db.health()
    return {
        "state": state,
        "internet_status": "reachable",
        "source_mode": config.current_source_mode(),
        "demo_mode": config.DEMO_MODE,
        "last_sync": iso_now(),
        "database": dbh,
        "data_source_status": srcs,
        "needs_keys": {
            "DATAGOV_API_KEY": not bool(config.DATAGOV_API_KEY),
            "OWM_API_KEY": not bool(config.OWM_API_KEY),
            "SARVAM_API_KEY": not bool(config.SARVAM_API_KEY),
            "CAP_FEED_URL": not bool(config.CAP_FEED_URL),
        },
        "generated_at": iso_now(),
    }
