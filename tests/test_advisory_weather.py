"""Worker 6 (advisory-weather): persona advice must be grounded in BOTH active
alerts AND current weather conditions (temperature, rain, wind, humidity).

Pinned behaviours:
(a) weather-only guidance fires when NO alert is active (44C observed ->
    heatwave line appended to the no-warning floor);
(b) calm weather NEVER softens an active-alert floor;
(c) unreachable weather service -> no weather lines, no false "all clear",
    basis provenance UNAVAILABLE;
(d) the humidity rule fires only at its documented threshold (35C + 60% RH);
(e) EN/HI/TE parity for every new string; no Tamil script anywhere.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import backend.config as config  # noqa: E402
import backend.api.weather as weather_mod  # noqa: E402
from backend.main import app  # noqa: E402
from backend.services import advisory_service as adv  # noqa: E402
from backend.services.advisory_service import (  # noqa: E402
    advisory_for,
    observation_numbers,
    weather_advisories,
    weather_advisories_text,
)
from backend.services.cache_service import CacheService  # noqa: E402

_TAMIL = re.compile(r"[\u0B80-\u0BFF]")


@pytest.fixture(autouse=True)
def _isolate_runtime_stores(tmp_path, monkeypatch):
    """Never read/write the developer's real weathergpt_cache.json."""
    cache_file = str(tmp_path / "weathergpt_cache.json")
    monkeypatch.setattr(config, "CACHE_FILE", cache_file)
    monkeypatch.setattr(weather_mod, "cache", CacheService(cache_file))
    monkeypatch.setattr(config, "DEMO_MODE", True)


def _kinds(items):
    return [i["kind"] for i in items]


# --- (a) weather-only guidance fires with no alert active --------------------
def test_heatwave_appends_to_no_warning_floor():
    floor = advisory_for({"verified": False}, "general", "en")
    items = weather_advisories(
        {"rain_mm": None, "wind_kph": None, "temp_c": 44, "humidity_pct": 30},
        None, "general", "en")
    assert _kinds(items) == ["heatwave"], items
    text = weather_advisories_text(items, "en")
    assert "44" in text and "Extreme heat" in text
    combined = floor + text
    assert combined.startswith(floor), "weather lines must append, never replace the floor"


# --- (b) calm weather never softens an active-alert floor --------------------
def test_calm_weather_never_softens_active_alert():
    verdict = {"confirmed": True, "level": "HIGH", "severity": "ORANGE",
               "hazard": "Thunderstorm", "basis": "cap_alert",
               "source": "NDMA-Sachet-CAP"}
    floor = advisory_for({}, "farmer", "en", verdict=verdict)
    assert "ORANGE" in floor and "Thunderstorm" in floor
    calm = {"rain_mm": 0, "wind_kph": 10, "temp_c": 25, "humidity_pct": 50}
    items = weather_advisories(calm, None, "farmer", "en")
    assert items == [], "calm weather must produce no rule lines at all"
    combined = floor + weather_advisories_text(items, "en")
    assert combined == floor
    assert "all clear" not in combined.lower()


# --- (c) unreachable weather service ----------------------------------------
def test_unreachable_weather_yields_no_lines_and_unavailable_basis(monkeypatch):
    async def fake_resolve(lat, lon, explicit):
        return ({"rain_mm": None, "wind_kph": None, "temp_c": None,
                 "humidity_pct": None}, {"provenance": "UNAVAILABLE"})

    monkeypatch.setattr(weather_mod, "resolve_advisory_weather", fake_resolve)
    r = TestClient(app).get("/api/v1/advisories",
                            params={"district": "Hyderabad", "lat": 17.385, "lon": 78.4867})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["weather_basis"] == {"provenance": "UNAVAILABLE"}
    # No weather rule line may be appended, and nothing may read as calm.
    assert "observed/forecast" not in body["advisory"]
    assert "all clear" not in body["advisory"].lower()


# --- (d) humidity rule thresholds -------------------------------------------
@pytest.mark.parametrize("temp,hum,fires", [
    (35, 60, True),      # exact documented threshold
    (36, 65, True),
    (44, 90, True),      # heatwave + heat-stress can co-fire
    (34.9, 90, False),   # below the temperature leg
    (36, 59.9, False),   # below the humidity leg
    (30, 80, False),     # humid but not hot: comfort, not a health risk
    (36, None, False),   # unknown humidity: no line, never a guess
])
def test_heat_stress_thresholds(temp, hum, fires):
    items = weather_advisories(
        {"temp_c": temp, "humidity_pct": hum}, None, "general", "en")
    assert ("heat_stress" in _kinds(items)) is fires, (temp, hum, items)


def test_heat_stress_cites_both_facts():
    items = weather_advisories(
        {"temp_c": 36, "humidity_pct": 65}, None, "general", "en")
    item = next(i for i in items if i["kind"] == "heat_stress")
    assert "36" in item["fact"] and "65" in item["fact"], item["fact"]
    assert "36" in item["text"]["en"] and "65" in item["text"]["en"]


def test_heat_stress_fires_from_imd_model_dump_keys():
    # The adapters emit WeatherObservation.model_dump keys (temperature /
    # humidity / rainfall / wind_speed) — the rules must read them, not just
    # the client-param spellings.
    nums = observation_numbers(
        {"temperature": 36, "humidity": 65, "rainfall": 0, "wind_speed": 5})
    assert nums == {"rain_mm": 0.0, "wind_kph": 5.0, "temp_c": 36.0,
                    "humidity_pct": 65.0}, nums
    assert "heat_stress" in _kinds(weather_advisories(nums, None, "general", "en"))


# --- (e) EN/HI/TE parity, no Tamil script ------------------------------------
def test_new_strings_trilingual_and_tamil_free():
    items = weather_advisories(
        {"temp_c": 36, "humidity_pct": 65}, None, "general", "en")
    item = next(i for i in items if i["kind"] == "heat_stress")
    assert set(item["text"]) == {"en", "hi", "te"}
    for lang in ("en", "hi", "te"):
        rendered = weather_advisories_text([item], lang)
        assert rendered.strip(), lang
        assert "{t}" not in rendered and "{h}" not in rendered and "{v}" not in rendered, lang
        assert not _TAMIL.search(rendered), f"Tamil script in {lang} heat-stress line"
    # And no Tamil script anywhere in the rule texts, old or new.
    for kind, texts in adv._RULE_TEXT.items():
        assert set(texts) == {"en", "hi", "te"}, kind
        for lang, s in texts.items():
            assert not _TAMIL.search(s), f"Tamil script in {kind}/{lang}"


# --- end-to-end: DEMO fixtures flow into the basis -----------------------------
def test_demo_mode_fixture_observation_grounds_basis():
    r = TestClient(app).get("/api/v1/advisories",
                            params={"district": "Hyderabad", "lat": 17.385, "lon": 78.4867})
    assert r.status_code == 200, r.text
    basis = r.json()["weather_basis"]
    assert basis["provenance"] == "DEMO", basis
    # Fixture: temp 28, humidity 82, rainfall 12, windspeed 9.
    assert basis["temp_c"] == 28.0 and basis["humidity_pct"] == 82.0, basis
    assert basis["rain_mm"] == 12.0 and basis["wind_kph"] == 9.0, basis
    # None of the rules fire at these values — basis present, no lines appended.
    assert "observed/forecast" not in r.json()["advisory"]


def test_explicit_params_take_client_provenance():
    r = TestClient(app).get("/api/advisory",
                            params={"temp_c": 44, "user_type": "general", "language": "en"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["weather_basis"] == {"provenance": "CLIENT", "temp_c": 44.0}
    assert "Extreme heat" in body["advisory"]
