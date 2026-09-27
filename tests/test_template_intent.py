"""The template answer must open with a direct answer to the question asked,
not the same warning+rain+temp dump for every question."""
from backend.services.llm_service import _template_answer, _detect_intent, build_evidence_package

_LOC = {"city": "Hyderabad", "district": "Hyderabad", "state": "Telangana", "coastal": False}
_CURRENT = {"temperature": 28.0, "humidity": 82.0, "wind_speed": 9.0, "condition": "Cloudy"}
_FORECAST = {"days": [
    {"date": "2026-09-15", "min_temperature": 24.0, "max_temperature": 31.0, "rainfall": 15.0},
    {"date": "2026-09-16", "min_temperature": 23.0, "max_temperature": 30.0, "rainfall": 22.0},
]}
_WARN = {"verified": True, "severity": "YELLOW", "hazard": "Thunderstorm",
         "valid_until": "2026-09-27T20:00:00+05:30"}


def _ev(**kw):
    return build_evidence_package(location=_LOC, current=_CURRENT, forecast=_FORECAST,
                                  verified=kw.get("verified", _WARN),
                                  risk={"level": "MODERATE"}, user_type="general")


def test_detect_intent_sea_beats_safe():
    assert _detect_intent("is it safe to go to sea") == "sea"
    assert _detect_intent("is it safe to go out") == "warning"
    assert _detect_intent("will it rain tomorrow") == "rain"
    assert _detect_intent("how is the wind") == "wind"
    assert _detect_intent("how hot is it") == "temp"
    assert _detect_intent("hello") == "general"


def test_sea_question_leads_with_inland_fact():
    a = _template_answer(_ev(), "is it safe to go to sea", "en")
    assert a.startswith("Hyderabad is not a coastal district")


def test_rain_question_leads_with_yes():
    a = _template_answer(_ev(), "will it rain tomorrow", "en")
    assert a.startswith("Yes — rain likely tomorrow")


def test_temp_question_leads_with_now():
    a = _template_answer(_ev(), "how hot is it today", "en")
    assert a.startswith("Right now in Hyderabad: 28.0°C")


def test_wind_question_leads_with_wind():
    a = _template_answer(_ev(), "how is the wind", "en")
    assert a.startswith("Wind in Hyderabad is 9.0 km/h")


def test_warning_question_leads_with_warning():
    a = _template_answer(_ev(), "any warnings", "en")
    assert "YELLOW Thunderstorm warning is active" in a.split(".")[0]


def test_no_warning_says_so_explicitly():
    a = _template_answer(_ev(verified={"verified": False}), "what is the weather", "en")
    assert "No active weather warnings for Hyderabad" in a


def test_unreachable_warning_never_claims_all_clear():
    a = _template_answer(_ev(verified={"verified": False, "warning_service": "unavailable"}),
                         "what is the weather", "en")
    assert "could not be reached" in a
    assert "No active weather warnings" not in a


def test_hindi_sea_lead():
    a = _template_answer(_ev(), "samudra me jana surakshit hai", "hi")
    assert a.startswith("Hyderabad एक तटीय जिला नहीं है")
