"""Chat endpoint - full pipeline: parse -> resolve -> retrieve -> validate -> risk -> advisory -> LLM."""
from fastapi import APIRouter
from ..models.chat import ChatRequest, ChatResponse
from ..services.imd_service import IMDService
from ..services.validation_service import ValidationService
from ..services.risk_service import RiskService
from ..services.advisory_service import advisory_for
from ..services.llm_service import LLMService, build_evidence_package
from ..services.location_service import LocationService
from ..rules.weather_rules import WeatherRules
from ..utils.time import iso_now
import asyncio

router = APIRouter()


def _build_response(loc, verified, risk, current, forecast, wgpt_answer, advisory, language) -> ChatResponse:
    return ChatResponse(
        answer=wgpt_answer,
        location={"city": loc.get("city"), "district": loc.get("district"), "state": loc.get("state")},
        risk={"level": risk.get("level"), "hazard": risk.get("hazard", ""), "source": risk.get("source")},
        warning={
            "active": verified.get("verified", False),
            "severity": verified.get("severity"),
            "hazard": verified.get("hazard"),
            "official": True,
            "source": verified.get("source"),
            "valid_until": verified.get("valid_until"),
        },
        evidence=[
            {"source": "IMD", "type": "district_warning", "issued_at": verified.get("source_timestamp"), "valid_until": verified.get("valid_until")},
            {"source": "IMD", "type": "city_forecast", "issued_at": forecast.get("issued_at")},
            {"source": "IMD", "type": "current_observation", "issued_at": current.get("observed_at")},
        ],
        language=language,
        structured_fallback=wgpt_answer.startswith("[STRUCTURED]"),
        generated_at=iso_now(),
    )


@router.post("/api/chat")
async def chat(req: ChatRequest) -> ChatResponse:
    rules = WeatherRules()
    parsed = rules.parse(req.message)
    loc_svc = LocationService()
    loc = loc_svc.resolve(req.latitude, req.longitude)

    imd = IMDService()
    current, forecast, warning = await asyncio.gather(
        imd.get_current_weather(loc["latitude"], loc["longitude"]),
        imd.get_forecast(loc["latitude"], loc["longitude"]),
        imd.get_district_warning(loc["district"]),
    )
    val = ValidationService(imd)
    verified = val.validate_warning(warning, loc["district"]) if warning else None
    verified_dict = verified.model_dump(mode="json") if verified else {"verified": False, "severity": "GREEN", "hazard": None}

    risk_svc = RiskService()
    risk = risk_svc.risk(verified_dict, req.user_type)
    advisory = advisory_for(verified_dict, req.user_type)

    current_dict = current.model_dump(mode="json")
    forecast_dict = forecast.model_dump(mode="json")

    evidence = build_evidence_package(
        location=loc, current=current_dict, forecast=forecast_dict, verified=verified_dict, risk=risk, user_type=req.user_type
    )

    llm = LLMService()
    answer, fallback = llm.generate_grounded_response(evidence)
    answer = f"[STRUCTURED] {answer}" if fallback else answer
    answer = f"{answer}\n\n{advisory}"

    return _build_response(loc, verified_dict, risk, current_dict, forecast_dict, answer, advisory, req.language)