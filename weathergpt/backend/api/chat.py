"""Chat endpoint — full pipeline: parse -> resolve -> retrieve -> validate -> risk -> advisory -> LLM.

Demo mode: IMD fixtures (DEMO). Live mode: Open-Meteo + IMD-live + CAP (provenance
per fact). Both modes refuse to invent (§54/§59). Spec alias: POST /api/chat/query.
"""
import asyncio

from fastapi import APIRouter

from .. import config
from ..adapters import cap_adapter
from ..adapters.registry import AdapterUnavailable
from ..models.chat import ChatRequest, ChatResponse
from ..rules.weather_rules import WeatherRules
from ..services.advisory_service import advisory_for
from ..services.gis_service import warning_relevant
from ..services.imd_service import IMDService
from ..services.llm_service import LLMService, build_evidence_package
from ..services.location_service import LocationService
from ..services.risk_service import RiskService
from ..services.validation_service import ValidationService
from ..utils.time import iso_now
from .weather import _live_current, _live_forecast

router = APIRouter()

UNAVAILABLE_ANSWERS = {
    "en": ("Weather information is temporarily unavailable. No verified warning, "
           "observation or forecast could be retrieved right now, so I cannot answer "
           "from data. Please try again shortly."),
    "hi": ("मौसम की जानकारी अभी उपलब्ध नहीं है। अभी कोई सत्यापित चेतावनी, माप या पूर्वानुमान "
           "नहीं मिला, इसलिए मैं आंकड़ों से जवाब नहीं दे सकता। कृपया थोड़ी देर बाद फिर कोशिश करें।"),
    "te": ("వాతావరణ సమాచారం ఇప్పుడు అందుబాటులో లేదు. ఇప్పుడు ఏ ధృవీకరించిన హెచ్చరిక, కొలత "
           "లేదా అంచనా అందలేదు, కాబట్టి డేటా ఆధారంగా సమాధానం చెప్పలేను. దయచేసి కొద్దిసేపట్లో మళ్లీ ప్రయత్నించండి."),
}


def _unavailable_answer(language: str) -> str:
    return UNAVAILABLE_ANSWERS.get(language, UNAVAILABLE_ANSWERS["en"])


def _build_response(loc, verified_dict, risk, current_dict, forecast_dict, answer,
                    advisory, language, weather_block, provenance_map, fallback=False) -> ChatResponse:
    warn = verified_dict or {}
    return ChatResponse(
        answer=answer,
        location={"city": loc.get("city"), "district": loc.get("district"), "state": loc.get("state")},
        weather=weather_block,
        risk={"level": risk.get("level"), "hazard": risk.get("hazard", ""), "source": risk.get("source")},
        warning={
            "active": bool(warn.get("verified", False)),
            "severity": warn.get("severity"),
            "hazard": warn.get("hazard"),
            "official": True,
            "source": warn.get("source"),
            "valid_until": warn.get("valid_until"),
        },
        advisory=advisory,
        evidence=[
            {"source": e["source"], "type": e["type"], "issued_at": e.get("issued_at"),
             "valid_until": e.get("valid_until"), "provenance": e.get("provenance", "DEMO")}
            for e in provenance_map
        ],
        language=language,
        structured_fallback=bool(fallback),
        generated_at=iso_now(),
    )


async def _retrieve_demo(loc) -> tuple[dict, dict, dict, list, dict]:
    imd = IMDService()
    current, forecast, warning = await asyncio.gather(
        imd.get_current_weather(loc["latitude"], loc["longitude"]),
        imd.get_forecast(loc["latitude"], loc["longitude"]),
        imd.get_district_warning(loc["district"]),
    )
    val = ValidationService(imd)
    verified = val.validate_warning(warning, loc["district"]) if warning else None
    verified_dict = verified.model_dump(mode="json") if verified else {"verified": False, "severity": "GREEN", "hazard": None}
    current_dict = current.model_dump(mode="json")
    forecast_dict = forecast.model_dump(mode="json")
    ev = [
        {"source": "IMD", "type": "district_warning", "issued_at": verified_dict.get("source_timestamp"),
         "valid_until": verified_dict.get("valid_until"), "provenance": "DEMO"},
        {"source": "IMD", "type": "city_forecast", "issued_at": forecast_dict.get("issued_at"), "provenance": "DEMO"},
        {"source": "IMD", "type": "current_observation", "issued_at": current_dict.get("observed_at"), "provenance": "DEMO"},
    ]
    return current_dict, forecast_dict, verified_dict, ev, {"source_name": "IMD"}


async def _retrieve_live(loc, lat, lon) -> tuple[dict | None, dict | None, dict, list, dict]:
    prov_notes: dict = {}
    try:
        current_dict, prov = await _live_current(lat, lon)
        prov_notes["current"] = prov
    except AdapterUnavailable:
        current_dict, prov_notes["current"] = None, "UNAVAILABLE"
    try:
        forecast_dict, prov = await _live_forecast(lat, lon)
        prov_notes["forecast"] = prov
    except AdapterUnavailable:
        forecast_dict, prov_notes["forecast"] = None, "UNAVAILABLE"

    imd = IMDService(adapter="live")
    warning, verified_dict = None, {"verified": False, "severity": "GREEN", "hazard": None, "source": "IMD"}
    try:
        warning = await imd.get_district_warning(loc["district"])
        v = ValidationService(imd).validate_warning(warning, loc["district"]) if warning else None
        if v:
            verified_dict = v.model_dump(mode="json")
    except AdapterUnavailable:
        pass

    ev = []
    if current_dict:
        ev.append({"source": current_dict.get("source", "Open-Meteo"), "type": "current_observation",
                   "issued_at": current_dict.get("observed_at"), "provenance": prov_notes["current"]})
    if forecast_dict:
        ev.append({"source": forecast_dict.get("source", "Open-Meteo"), "type": "city_forecast",
                   "issued_at": forecast_dict.get("issued_at"), "provenance": prov_notes["forecast"]})
    if warning is not None and verified_dict.get("verified"):
        ev.append({"source": "IMD", "type": "district_warning",
                   "issued_at": verified_dict.get("source_timestamp"),
                   "valid_until": verified_dict.get("valid_until"), "provenance": "LIVE"})
    try:
        alerts, cap_prov = await cap_adapter.fetch_alerts()
        for a in alerts:
            rel = warning_relevant(a, lat, lon, loc["district"])
            if rel["relevant"]:
                ev.append({"source": "NDMA-Sachet-CAP", "type": "cap_alert",
                           "issued_at": a.get("sent"), "valid_until": a.get("expires"),
                           "provenance": cap_prov})
    except AdapterUnavailable:
        pass
    return current_dict, forecast_dict, verified_dict, ev, {"source_name": "Open-Meteo", **prov_notes}


async def _handle(req: ChatRequest) -> ChatResponse:
    rules = WeatherRules()
    rules.parse(req.message)
    loc = LocationService().resolve(req.latitude, req.longitude)
    lat, lon = loc["latitude"], loc["longitude"]

    if config.DEMO_MODE:
        current_dict, forecast_dict, verified_dict, ev, notes = await _retrieve_demo(loc)
    else:
        current_dict, forecast_dict, verified_dict, ev, notes = await _retrieve_live(loc, lat, lon)
        if current_dict is None and forecast_dict is None and not verified_dict.get("verified"):
            risk = RiskService().risk({"severity": "GREEN", "hazard": ""}, req.user_type)
            return _build_response(loc, verified_dict, risk, None, None,
                                   _unavailable_answer(req.language),
                                   advisory_for({"verified": False}, req.user_type, req.language),
                                   req.language, {"status": "unavailable", "provenance": "UNAVAILABLE"}, [], True)

    risk = RiskService().risk(verified_dict, req.user_type)
    advisory = advisory_for(verified_dict, req.user_type, req.language)
    evidence = build_evidence_package(
        location=loc, current=current_dict or {}, forecast=forecast_dict or {},
        verified=verified_dict, risk=risk, user_type=req.user_type,
    )
    evidence["source_name"] = notes.get("source_name", "IMD")

    llm = LLMService()
    answer, fallback = await llm.generate(evidence, req.message, req.language)

    # Post-LLM response validation (§10, §43): the gate before delivery.
    from ..services.response_validator import validate as validate_answer
    numbers: list[float] = []
    for blob in (current_dict, forecast_dict):
        for v in blob.values():
            if isinstance(v, (int, float)):
                numbers.append(float(v))
        for day in blob.get("days", []) if isinstance(blob, dict) else []:
            for v in (day or {}).values():
                if isinstance(v, (int, float)):
                    numbers.append(float(v))
    answer, findings = validate_answer(answer, verified_dict, numbers, req.language)
    if findings:
        evidence["validation_findings"] = findings
        fallback = True
    answer = f"{answer}\n\n{advisory}"

    weather_block = {"current": current_dict, "forecast_days": (forecast_dict or {}).get("days", [])[:3]}
    return _build_response(loc, verified_dict, risk, current_dict or {}, forecast_dict or {},
                           answer, advisory, req.language, weather_block, ev, fallback)


@router.post("/api/chat")
async def chat(req: ChatRequest) -> ChatResponse:
    return await _handle(req)


@router.post("/api/chat/query")
async def chat_query(req: ChatRequest) -> ChatResponse:
    """Spec §51 alias."""
    return await _handle(req)
