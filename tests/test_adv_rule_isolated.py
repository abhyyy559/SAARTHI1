"""ISOLATED Unit Test for advisory_service.py rule layer (T2.1 S2.1.1-S2.1.3).
Target: weathergpt/backend/services/advisory_service.py
Session: ses_adv — WILL BE DELETED AFTER PASS, code preserved in .opencode/unit-tests/
Mocks: none needed (module is dependency-free by design).
"""
from backend.services.advisory_service import (
    advisory_for,
    weather_advisories,
    weather_advisories_text,
)


def test_threshold_edges():
    assert weather_advisories({"rain_mm": 19.9}, None, "general", "en") == []
    assert len(weather_advisories({"rain_mm": 20}, None, "general", "en")) == 1
    assert weather_advisories({"rain_mm": 50}, None, "general", "en")[0]["kind"] == "heavy_rain"
    assert weather_advisories({"wind_kph": 59.9}, None, "general", "en") == []
    assert weather_advisories({"wind_kph": 60}, None, "general", "en")[0]["kind"] == "gale"
    assert weather_advisories({"temp_c": 42}, None, "general", "en")[0]["kind"] == "heatwave"
    assert weather_advisories({"temp_c": 5}, None, "general", "en")[0]["kind"] == "cold"
    assert weather_advisories({"temp_c": 25}, None, "general", "en") == []


def test_rainy_vs_dry_and_cap():
    dry = weather_advisories({"rain_mm": 0, "wind_kph": 10, "temp_c": 25}, None, "farmer", "en")
    wet = weather_advisories({"rain_mm": 65, "wind_kph": 70, "temp_c": 43}, None, "farmer", "en")
    assert dry == []
    assert 2 <= len(wet) <= 3
    assert all("fact" in w and w["fact"] for w in wet)
    assert all(set(w["text"]) >= {"en", "hi", "te"} for w in wet)


def test_floor_never_softened_append_only():
    floor = advisory_for({"verified": False}, "farmer", "en")
    wet = weather_advisories({"rain_mm": 65}, None, "farmer", "en")
    combined = floor + weather_advisories_text(wet, "en")
    assert combined.startswith(floor)
    assert weather_advisories_text([], "en") == ""
    assert weather_advisories(None, None, "general", "en") == []


def test_persona_matrix_kept():
    import backend.services.advisory_service as m
    for p in ["farmer", "driver", "fisherman", "commuter", "employee",
              "general", "outdoor-worker", "researcher", "disaster_manager"]:
        assert p in m._NO_WARN, p
        assert p in m._ACTION or p in ("general", "commuter", "employee",
                                       "outdoor-worker", "student"), p
        for lang in ("en", "hi", "te"):
            assert m._NO_WARN[p][lang], (p, lang)
