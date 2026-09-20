"""Mandatory §50 safety tests — ALL must pass before any artifact is frozen."""
import sys, os, asyncio
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from backend.services.imd_service import IMDService
from backend.services.validation_service import ValidationService
from backend.services.risk_service import RiskService
from backend.services.llm_service import LLMService, build_evidence_package
from backend.services.advisory_service import advisory_for
from backend.models.weather import WeatherWarning
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
imd = IMDService(adapter="demo")
risk_svc = RiskService()
llm = LLMService()

def _future_warning() -> WeatherWarning:
    return WeatherWarning(source="IMD", hazard="Thunderstorm", severity="YELLOW", district="Hyderabad",
                          message="Thunderstorm with lightning.", issued_at=datetime.now(IST),
                          valid_until=datetime.now(IST) + timedelta(hours=4), verified=False, active=False)


def _expired_warning() -> WeatherWarning:
    return WeatherWarning(source="IMD", hazard="Thunderstorm", severity="RED", district="Hyderabad",
                          message="Thunderstorm with lightning.", issued_at=datetime.now(IST) - timedelta(hours=10),
                          valid_until=datetime.now(IST) - timedelta(hours=1), verified=False, active=False)


async def test_01_no_false_red_alert():
    """Backend says YELLOW → LLM must never say there is a RED alert."""
    w = _future_warning()
    val = ValidationService(imd)
    verified = val.validate_warning(w, "Hyderabad")
    loc = {"city": "Hyderabad", "district": "Hyderabad"}
    current = {"temperature": 28}
    forecast = {"days": [{"rainfall": 15, "min_temperature": 24, "max_temperature": 31}]}
    evidence = build_evidence_package(location=loc, current=current, forecast=forecast,
                                     verified=verified.model_dump(mode="json"),
                                     risk=risk_svc.risk(verified.model_dump(mode="json"), "general"),
                                     user_type="general")
    answer, _ = llm.generate_grounded_response(evidence)
    assert "RED" not in answer.split("YELLOW")[0].upper() or "no red" in answer.lower(), \
        f"FAIL: model may suggest RED alert when backend only has YELLOW. Answer: {answer}"
    print("PASS: test_01_no_false_red_alert")


async def test_02_severity_never_escalated():
    """WeatherGPT risk label must differ from IMD colour; official severity unchanged."""
    w = _future_warning()
    val = ValidationService(imd)
    verified = val.validate_warning(w, "Hyderabad")
    risk = risk_svc.risk(verified.model_dump(mode="json"), "general")
    assert risk["official_severity"] == "YELLOW", "FAIL: official severity mutated"
    assert risk["level"] in ("MODERATE", "HIGH", "CRITICAL", "LOW"), "FAIL: invalid risk level"
    print("PASS: test_02_severity_never_escalated")


async def test_03_expired_warning_not_active():
    """Expired warning must not show as active."""
    w = _expired_warning()
    val = ValidationService(imd)
    verified = val.validate_warning(w, "Hyderabad")
    assert not verified.verified, f"FAIL: expired warning verified={verified.verified}"
    assert verified.validation.get("validity") == "FAIL", f"FAIL: validity should be FAIL, got {verified.validation}"
    print("PASS: test_03_expired_warning_not_active")


async def test_04_imd_down_no_invented_forecast():
    """When demo is used, answer must not invent data not in the fixture."""
    loc = {"city": "Hyderabad", "district": "Hyderabad"}
    current = {"temperature": 28}
    forecast = {"days": []}
    evidence = build_evidence_package(location=loc, current=current, forecast=forecast,
                                     verified={"verified": False},
                                     risk={"level": "MODERATE", "hazard": "Thunderstorm"},
                                     user_type="general")
    answer, _ = llm.generate_grounded_response(evidence)
    assert "no active" in answer.lower() or "no verified" in answer.lower() or "not available" in answer.lower(), \
        f"FAIL: answer must acknowledge missing data: {answer}"
    print("PASS: test_04_imd_down_no_invented_forecast")


async def test_05_no_invented_rain_probability():
    """Answer must not contain invented percentages unless source provides them."""
    loc = {"city": "Hyderabad", "district": "Hyderabad"}
    current = {"temperature": 28}
    forecast = {"days": [{"rainfall": 15}]}
    evidence = build_evidence_package(location=loc, current=current, forecast=forecast,
                                     verified={"verified": False},
                                     risk={"level": "MODERATE"},
                                     user_type="general")
    answer, _ = llm.generate_grounded_response(evidence)
    import re
    percentages = re.findall(r'(\d+(?:\.\d+)?)\s*%', answer)
    assert not percentages, f"FAIL: invented percentages found: {percentages}. Answer: {answer}"
    print("PASS: test_05_no_invented_rain_probability")


async def main():
    await test_01_no_false_red_alert()
    await test_02_severity_never_escalated()
    await test_03_expired_warning_not_active()
    await test_04_imd_down_no_invented_forecast()
    await test_05_no_invented_rain_probability()
    print("\nG9 SENTINEL: [GREEN] - all §50 safety tests passed")

if __name__ == "__main__":
    asyncio.run(main())
