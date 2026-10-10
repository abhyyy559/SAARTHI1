"""Chat answers are short and plain, and every free official source is used.

The user asked for answers a non-expert can read at a glance: the direct
answer first, rain in words (IMD's categories) instead of millimetres, few
numbers, and nothing about how the answer was produced inside the text (the
app shows sources and the rule-based note under the answer).
"""
import re

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.services.llm_service import _template_answer, rain_category, rain_sentence


def _evidence(*, rain=22.0, verified=None, temp=31.4, cond="Partly Cloudy"):
    return {
        "location": {"city": "Hyderabad", "district": "Hyderabad"},
        "current_weather": {"temperature": temp, "condition": cond},
        "forecast": {"days": [{"rainfall": 0.0, "min_temperature": 24.6, "max_temperature": 33.2},
                              {"rainfall": rain, "min_temperature": 25.3, "max_temperature": 33.4}]},
        "verified_warning": verified if verified is not None else {"verified": False},
        "source_name": "Open-Meteo",
    }


@pytest.mark.parametrize("mm, category", [
    (0.0, "none"), (1.2, "drops"), (2.5, "light"), (22.0, "moderate"),
    (70.0, "heavy"), (150.0, "very_heavy"), (250.0, "extreme"), (None, None),
])
def test_rain_follows_imd_categories(mm, category):
    assert rain_category(mm) == category


def test_under_2_5_mm_is_never_a_yes():
    """IMD does not count a rainy day below 2.5 mm."""
    assert not rain_sentence(1.2, "en").startswith("Yes")


def test_rain_question_gets_a_short_plain_answer():
    answer = _template_answer(_evidence(), "en", "Will it rain tomorrow?")
    assert answer.startswith("Yes — moderate rain is likely tomorrow."), answer
    assert "mm" not in answer and "Open-Meteo" not in answer, answer
    assert "Risk" not in answer and "Advisory tab" not in answer, answer
    assert len(re.findall(r"\d+(?:\.\d+)?", answer)) == 0, answer
    assert len(answer.split()) <= 25, answer


def test_temperature_question_rounds_numbers():
    answer = _template_answer(_evidence(), "en", "How hot is it?")
    assert "31°C" in answer and "25 to 33°C" in answer, answer
    assert not re.search(r"\d\.\d", answer), answer


def test_active_warning_still_comes_first():
    verified = {"verified": True, "severity": "ORANGE", "hazard": "Cyclone"}
    answer = _template_answer(_evidence(verified=verified), "en", "Will it rain tomorrow?")
    assert answer.startswith("Official warning for Hyderabad: ORANGE — Cyclone."), answer


def test_unreachable_warning_service_is_never_an_all_clear():
    verified = {"verified": False, "warning_service": "unavailable"}
    answer = _template_answer(_evidence(verified=verified), "en", "Will it rain tomorrow?")
    assert "could not be checked" in answer and "No official" not in answer, answer


@pytest.mark.parametrize("lang, yes", [("hi", "हाँ"), ("te", "అవును")])
def test_short_answer_in_hindi_and_telugu(lang, yes):
    answer = _template_answer(_evidence(), lang, "कल बारिश होगी?")
    assert answer.startswith(yes), answer
    assert "mm" not in answer and "मिमी" not in answer and "మిమీ" not in answer, answer


def test_chat_endpoint_answer_has_no_process_talk(monkeypatch):
    from backend.main import app
    monkeypatch.setattr(config, "DEMO_MODE", True)
    monkeypatch.setattr(config, "LLM_API_KEY", "")
    with TestClient(app) as c:
        body = c.post("/api/chat", json={"message": "Will it rain tomorrow?",
                                         "latitude": 17.6868, "longitude": 83.2185}).json()
    answer = body["answer"]
    assert "STRUCTURED" not in answer and "fallback" not in answer.lower(), answer
    assert "mm" not in answer, answer
    assert body["structured_fallback"] is True  # the app shows the note under the answer


def test_public_sachet_feeds_are_on_by_default(monkeypatch):
    """With no CAP setting at all, the official keyless feeds are used."""
    import importlib
    import sys
    monkeypatch.delenv("CAP_FEED_URLS", raising=False)
    monkeypatch.delenv("CAP_FEED_URL", raising=False)
    fresh = importlib.reload(sys.modules["backend.config"])
    try:
        assert fresh.CAP_FEED_URLS == fresh.DEFAULT_CAP_FEED_URLS
        assert all(u.startswith("https://sachet.ndma.gov.in/") for u in fresh.CAP_FEED_URLS)
    finally:
        monkeypatch.setenv("CAP_FEED_URLS", "")
        importlib.reload(sys.modules["backend.config"])
