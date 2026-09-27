"""Unit tests for the role-first weather brief (2026-09-23).

role_weather_brief() translates observed/forecast numbers into what the
weather MEANS for the user's role: a plain-language headline + focus lines,
EN/HI/TE. Raw numbers stay supporting detail, never the headline.
"""
import re

from backend.services.advisory_service import role_weather_brief

TAMIL_RE = re.compile(r"[\u0b80-\u0bff]")


def _all_strings(brief):
    out = [brief["headline"], *brief["lines"]]
    return out


def test_farmer_heavy_rain_headline_is_plain_language():
    b = role_weather_brief({"rain_mm": 65, "wind_kph": 10, "temp_c": 28,
                            "humidity_pct": 70}, None, "farmer", "en")
    assert b["role"] == "farmer"
    assert not b["calm"]
    assert "heavy_rain" in b["fired"]
    assert "protect the crop" in b["headline"]
    assert any("spraying" in ln for ln in b["lines"])


def test_farmer_moderate_rain():
    b = role_weather_brief({"rain_mm": 25, "wind_kph": 10, "temp_c": 28,
                            "humidity_pct": 70}, None, "farmer", "en")
    assert "moderate_rain" in b["fired"]
    assert "field work" in b["headline"]


def test_fisherman_gale_and_rough_band():
    gale = role_weather_brief({"rain_mm": 0, "wind_kph": 65, "temp_c": 28,
                               "humidity_pct": 70}, None, "fisherman", "en")
    assert "gale" in gale["fired"]
    assert "stay off the water" in gale["headline"]
    rough = role_weather_brief({"rain_mm": 0, "wind_kph": 45, "temp_c": 28,
                                "humidity_pct": 70}, None, "fisherman", "en")
    assert "rough" in rough["fired"]
    assert "small boats" in rough["headline"]


def test_fisherman_inland_says_true_thing_first():
    b = role_weather_brief({"rain_mm": 65, "wind_kph": 10, "temp_c": 28,
                            "humidity_pct": 70}, None, "fisherman", "en",
                           district="Hyderabad", coastal=False)
    assert "not a coastal district" in b["headline"]
    assert any("tanks" in ln for ln in b["lines"])


def test_general_heat_stress_says_feels_hotter():
    b = role_weather_brief({"rain_mm": 0, "wind_kph": 10, "temp_c": 36,
                            "humidity_pct": 75}, None, "general", "en")
    assert "heat_stress" in b["fired"]
    assert "feel hotter than" in b["headline"]


def test_calm_day_never_silent():
    b = role_weather_brief({"rain_mm": 2, "wind_kph": 10, "temp_c": 28,
                            "humidity_pct": 50}, None, "student", "en")
    assert b["calm"] and b["fired"] == []
    assert b["headline"]  # interpretation, not numbers
    assert b["lines"]


def test_empty_input_yields_empty_brief():
    assert role_weather_brief(None, None, "farmer", "en") == {}
    assert role_weather_brief({}, None, "general", "en") == {}


def test_unknown_role_falls_back_to_general():
    b = role_weather_brief({"rain_mm": 65, "wind_kph": 10, "temp_c": 28,
                            "humidity_pct": 70}, None, "astronaut", "en")
    assert b["role"] == "general"


def test_hindi_telugu_parity_and_no_tamil():
    for lang in ("hi", "te"):
        for role in ("farmer", "fisherman", "driver", "commuter", "employee",
                     "outdoor-worker", "student", "aviation", "general"):
            b = role_weather_brief({"rain_mm": 65, "wind_kph": 65, "temp_c": 36,
                                    "humidity_pct": 75}, None, role, lang)
            assert b["headline"], f"{role}/{lang} headline missing"
            assert b["lines"], f"{role}/{lang} lines missing"
            for s in _all_strings(b):
                assert not TAMIL_RE.search(s), f"Tamil script in {role}/{lang}: {s[:40]}"


def test_disaster_manager_summary_lists_kinds():
    b = role_weather_brief({"rain_mm": 65, "wind_kph": 70, "temp_c": 30,
                            "humidity_pct": 70}, None, "disaster_manager", "en")
    assert "heavy rain" in b["headline"] and "strong wind" in b["headline"]
    assert any("Official warnings take precedence" in ln for ln in b["lines"])


def test_researcher_summary_is_data_forward():
    b = role_weather_brief({"rain_mm": 65, "wind_kph": 70, "temp_c": 30,
                            "humidity_pct": 70}, None, "researcher", "en")
    assert "Threshold crossings" in b["headline"]
    assert any("65mm" in ln for ln in b["lines"])


def test_forecast_widens_coverage():
    # Current is dry but the 3-day forecast brings heavy rain: the brief must
    # lead with the coming rain, not the dry now.
    fc = {"days": [{"rain_mm": 70, "wind_kph": 10, "temp_c": 28}]}
    b = role_weather_brief({"rain_mm": 0, "wind_kph": 10, "temp_c": 28,
                            "humidity_pct": 60}, fc, "farmer", "en")
    assert "heavy_rain" in b["fired"]
    assert "protect the crop" in b["headline"]


def test_headline_priority_most_dangerous_first():
    b = role_weather_brief({"rain_mm": 65, "wind_kph": 70, "temp_c": 28,
                            "humidity_pct": 70}, None, "farmer", "en")
    # heavy_rain outranks gale in the brief kind order
    assert b["fired"][0] == "heavy_rain"
    assert "protect the crop" in b["headline"]


def test_max_two_lines():
    b = role_weather_brief({"rain_mm": 65, "wind_kph": 70, "temp_c": 28,
                            "humidity_pct": 70}, None, "farmer", "en")
    assert len(b["lines"]) <= 2
