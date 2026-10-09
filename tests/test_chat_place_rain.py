"""Chat answers about other places, trace rain, climate questions, and the
Hindi/Telugu template wording."""
import asyncio

from backend.api import chat as chat_api
from backend.services.llm_service import _template_answer, build_evidence_package, imd_rain_category
from backend.services.place_parser import asked_place

HOME = {"district": "Visakhapatnam", "state": "Andhra Pradesh"}


def test_imd_rain_categories():
    assert imd_rain_category(None) is None
    assert imd_rain_category(0) == "no rain"
    assert imd_rain_category(0.1) == "very light rain"
    assert imd_rain_category(2.4) == "very light rain"
    assert imd_rain_category(2.5) == "light rain"
    assert imd_rain_category(20) == "moderate rain"
    assert imd_rain_category(70) == "heavy rain"
    assert imd_rain_category(150) == "very heavy rain"
    assert imd_rain_category(250) == "extremely heavy rain"


def _fc(mm):
    return {"days": [{"rainfall": 0}, {"rainfall": mm}]}


def test_trace_rain_is_not_a_yes():
    """0.1 mm is a trace, not a rainy day: never 'yes, it will rain'."""
    out = chat_api._ensure_rain_lead("will it rain tomorrow?", _fc(0.1), "Some facts.")
    assert out.startswith("Only very light rain expected tomorrow (0.1 mm)")
    out = chat_api._ensure_rain_lead("will it rain tomorrow?", _fc(12.0), "Some facts.")
    assert out.startswith("Yes — rain likely tomorrow (12.0 mm)")
    out = chat_api._ensure_rain_lead("will it rain tomorrow?", _fc(0), "Some facts.")
    assert out.startswith("No rain expected tomorrow.")
    out = chat_api._ensure_rain_lead("कल बारिश होगी?", _fc(0.4), "तथ्य।", "hi")
    assert out.startswith("कल सिर्फ़ बहुत हल्की बारिश (0.4 मिमी)")


def test_evidence_carries_the_imd_category():
    ev = build_evidence_package(location={"district": "X"}, current={}, forecast=_fc(0.1),
                                verified={}, risk={"level": "LOW"}, user_type="farmer")
    assert ev["tomorrow_rain_category"] == "very light rain"
    assert ev["forecast"]["days"][1]["rain_category_imd"] == "very light rain"


def _evidence(rain=0.1):
    return build_evidence_package(
        location={"district": "Medak", "coastal": False},
        current={"temperature": 30, "condition": "Clear", "wind_speed": 5},
        forecast=_fc(rain), verified={"verified": False}, risk={"level": "LOW"}, user_type="farmer")


def test_template_speaks_the_users_language_throughout():
    te = _template_answer(_evidence(), "రేపు వర్షం పడుతుందా?", "te")
    hi = _template_answer(_evidence(), "क्या कल बारिश होगी?", "hi")
    for text in (te, hi):
        assert "farmer" not in text and "LOW" not in text
    assert "రైతు" in te and "తక్కువ" in te and "చాలా తేలికపాటి వర్షం" in te
    assert "किसान" in hi and "कम" in hi and "बहुत हल्की बारिश" in hi
    now_te = _template_answer(_evidence(), "ఇప్పుడు ఎలా ఉంది?", "te")
    assert "నిర్మలమైన ఆకాశం" in now_te and "Clear" not in now_te


def test_place_named_in_the_question():
    assert asked_place("Will it rain in Patna tomorrow?", [], HOME)["district"] == "Patna"
    assert asked_place("patna mein kal barish hogi?", [], HOME)["district"] == "Patna"
    assert asked_place("Patna weather?", [], HOME)["district"] == "Patna"
    assert asked_place("రేపు పాట్నాలో వర్షం పడుతుందా?", [], HOME)["district"] == "Patna"
    assert asked_place("क्या कल पटना में बारिश होगी?", [], HOME)["district"] == "Patna"
    assert asked_place("rain in East Godavari tomorrow", [], HOME)["district"] == "East Godavari"


def test_no_place_or_home_place_keeps_the_saved_place():
    for q in ("Will it rain tomorrow?", "Is it safe to go out in the evening?", "rain in west bengal?",
              "Can I go out at night?", "rain for the next 3 days", "Will it rain in Visakhapatnam?"):
        assert asked_place(q, [], HOME) is None, q


def test_short_follow_up_inherits_the_previous_place():
    hist = ["Will it rain in Patna today?"]
    assert asked_place("What about tomorrow there?", hist, HOME)["district"] == "Patna"
    # A full new question is about home again.
    assert asked_place("Will it rain tomorrow?", hist, HOME) is None


def test_climate_question_uses_the_20_year_series(monkeypatch):
    from backend.api import climate as climate_api

    async def fake_trends(lat, lon, years=20):
        yearly = [{"year": y, "tmean_c": 27.0, "rain_mm": 900.0} for y in range(2006, 2026)]
        return {"trends": {"yearly": yearly, "baseline_rain_mm": 870.0, "latest_rain_mm": 911.0,
                           "baseline_temp_c": 27.1, "latest_temp_c": 26.2, "temp_anomaly_c": -0.9,
                           "temp_trend_c_per_year": 0.02}}

    monkeypatch.setattr(climate_api, "climate_trends", fake_trends)
    assert chat_api._CLIMATE_RE.search("Was this year hotter than usual?")
    assert chat_api._CLIMATE_RE.search("क्या इस साल बारिश सामान्य से ज़्यादा थी?")
    assert not chat_api._CLIMATE_RE.search("Will it rain tomorrow?")
    block, nums = asyncio.run(chat_api._climate_evidence(17.7, 83.2))
    assert block["last_complete_year"] == 2025
    assert block["normal_period"] == "2006-2020"
    assert block["rain_change_percent"] == 5
    assert 5.0 in nums and 911.0 in nums


def test_official_alert_is_not_described_as_unconfirmed():
    """IMD down + a SACHET alert for the place: the phrasing layer must see a
    confirmed warning, not a 'service unavailable' flag beside it."""
    verdict = {"basis": "cap_alert", "level": "MODERATE", "severity": "YELLOW",
               "hazard": "Flood", "source": "NDMA-Sachet-CAP"}
    view = chat_api._llm_warning_view(
        {"verified": False, "severity": "GREEN", "source": "IMD", "warning_service": "unavailable"}, verdict)
    assert view["verified"] is True and view["severity"] == "YELLOW" and view["hazard"] == "Flood"
    assert "warning_service" not in view


def test_category_opening_is_not_answered_twice():
    fc = {"days": [{"rainfall": 0}, {"rainfall": 2.4}]}
    llm = "Very light rain is expected tomorrow in Patna, Bihar.\n\nMore facts."
    assert chat_api._ensure_rain_lead("will it rain in patna tomorrow?", fc, llm) == llm
