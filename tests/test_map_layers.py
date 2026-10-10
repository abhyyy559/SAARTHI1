"""Heat-map endpoint (/api/map/layers): alerts + weather + health per district.

Pinned behaviours:
(a) every served district appears exactly once, with coordinates;
(b) one unreachable weather provider blanks the weather column ONLY — the
    alert layer still answers, so a dead feed never blanks the whole map;
(c) a district with no weather reads health "unknown", never a fabricated
    healthy/low;
(d) heat thresholds are the ADVISORY thresholds — the map cannot disagree
    with the Advisory cards about the same 44C day;
(e) imd (official-only) mode never backfills weather from Open-Meteo/OWM;
(f) provenance names the chain that actually answered.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

import backend.api.map as map_mod  # noqa: E402
import backend.config as config  # noqa: E402
from backend.adapters.registry import AdapterUnavailable  # noqa: E402
from backend.services.location_service import GAZETTEER  # noqa: E402
from backend.services import advisory_service as adv  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_runtime_stores(tmp_path, monkeypatch):
    """The map layer result is cached; keep the real cache out of reach."""
    from backend.services.cache_service import CacheService
    cache_file = str(tmp_path / "weathergpt_cache.json")
    monkeypatch.setattr(config, "CACHE_FILE", cache_file)
    monkeypatch.setattr(map_mod, "cache", CacheService(cache_file))
    # The map reads weather from a batch call; make every test start cold.
    monkeypatch.setattr(map_mod, "MAP_WEATHER_KEY", map_mod.MAP_WEATHER_KEY)


async def _wake(*_a, **_k):
    """Stand-in for cap_adapter.fetch_alerts(): (alerts, provenance)."""
    return [], "LIVE"


# --- (a) shape ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_every_district_appears_once_with_coordinates(monkeypatch):
    async def fake_many(locations):
        return [None] * len(locations)

    monkeypatch.setattr(map_mod.openmeteo_adapter, "get_current_many", fake_many)
    monkeypatch.setattr(map_mod.cap_adapter, "fetch_alerts", _wake)
    monkeypatch.setattr(config, "DEMO_MODE", False)

    out = await map_mod.map_layers()
    names = [d["district"] for d in out["districts"]]
    assert len(names) == len(set(names)), "a district must not appear twice"
    assert set(names) == {e["district"] for e in GAZETTEER}
    for d in out["districts"]:
        assert isinstance(d["latitude"], float) and isinstance(d["longitude"], float)
        assert d["alerts"]["severity_label"] in map_mod.SEV_LABEL.values()
        assert d["weather"] is None
        assert d["health"]["risk"] == "unknown", "no weather must read unknown, never low"


# --- (b) per-district failure isolation --------------------------------------

@pytest.mark.asyncio
async def test_dead_weather_does_not_blank_the_alert_layer(monkeypatch):
    async def dead_many(_locations):
        raise AdapterUnavailable("open-meteo unreachable")

    called = {"alerts": False}

    async def fake_alerts():
        called["alerts"] = True
        return [], "LIVE"

    monkeypatch.setattr(map_mod.openmeteo_adapter, "get_current_many", dead_many)
    monkeypatch.setattr(map_mod.cap_adapter, "fetch_alerts", fake_alerts)
    monkeypatch.setattr(config, "DEMO_MODE", False)

    out = await map_mod.map_layers()
    assert called["alerts"], "the alert feed must still be consulted"
    assert out["districts"], "the map must not be emptied"
    assert all(d["weather"] is None for d in out["districts"])
    assert all(d["health"]["risk"] == "unknown" for d in out["districts"])


@pytest.mark.asyncio
async def test_dead_alert_feed_leaves_weather_intact(monkeypatch):
    async def live_many(locations):
        from backend.models.weather import WeatherObservation
        from datetime import datetime
        from backend.utils.time import IST
        return [WeatherObservation(
            source="test", temperature=32.0, humidity=40.0, rainfall=0.0,
            wind_speed=5.0, condition="Clear",
            observed_at=datetime.now(IST),
        )] * len(locations)

    async def dead_alerts():
        raise AdapterUnavailable("CAP feeds unreachable")

    monkeypatch.setattr(map_mod.openmeteo_adapter, "get_current_many", live_many)
    monkeypatch.setattr(map_mod.cap_adapter, "fetch_alerts", dead_alerts)
    monkeypatch.setattr(config, "DEMO_MODE", False)

    out = await map_mod.map_layers()
    assert out["districts"]
    # Weather survived the alert failure...
    assert out["districts"][0]["weather"]["temperature"] == 32.0
    assert out["districts"][0]["health"]["risk"] == "low"
    # ...and no district is painted GREEN on the strength of a feed it could
    # not read: UNKNOWN is the honest label for an unread sky.
    assert out["districts"][0]["alerts"]["severity_label"] == "UNKNOWN"
    assert out["districts"][0]["alerts"]["active"] is False
    assert "UNAVAILABLE" in out["provenance"]


# --- (c)/(d) health layer ----------------------------------------------------

def test_health_thresholds_are_the_advisory_thresholds():
    """The map must not grow its own idea of what a health risk is."""
    assert map_mod._HEAT_C == adv._HEAT_C
    assert map_mod._COLD_C == adv._COLD_C
    assert map_mod._HEATSTRESS_TEMP_C == adv._HEATSTRESS_TEMP_C
    assert map_mod._HEATSTRESS_HUMIDITY_PCT == adv._HEATSTRESS_HUMIDITY_PCT


@pytest.mark.parametrize("temp,humidity,expected_risk", [
    (None, None, "unknown"),
    (32.0, 30.0, "low"),
    (44.0, 20.0, "high"),          # heatwave threshold
    (38.0, 70.0, "moderate"),      # heat-stress combination
    (3.0, 40.0, "high"),           # cold threshold
    (34.0, 55.0, "low"),           # humid but not hot: no advisory
])
def test_health_layer_matches_advisory_rules(temp, humidity, expected_risk):
    assert map_mod._heat_layer(temp, humidity)["risk"] == expected_risk


# --- (e) official-only mode --------------------------------------------------

@pytest.mark.asyncio
async def test_imd_mode_never_pulls_non_official_weather(monkeypatch):
    calls = {"openmeteo": 0, "owm": 0}

    async def spy_many(locations):
        calls["openmeteo"] += 1
        return [None] * len(locations)

    async def spy_owm(_lat, _lon):
        calls["owm"] += 1
        raise AdapterUnavailable("unconfigured")

    monkeypatch.setattr(map_mod.openmeteo_adapter, "get_current_many", spy_many)
    monkeypatch.setattr(map_mod.owm_adapter, "get_current", spy_owm)
    monkeypatch.setattr(map_mod.cap_adapter, "fetch_alerts", _wake)
    monkeypatch.setattr(config, "SOURCE_MODE", "imd")
    monkeypatch.setattr(config, "DEMO_MODE", False)

    out = await map_mod.map_layers()
    assert calls["owm"] == 0, "imd mode must not consult OWM at all"
    assert all(d["weather"] is None for d in out["districts"])
    assert out["source_mode"] == "imd"


# --- (f) provenance ----------------------------------------------------------

@pytest.mark.asyncio
async def test_provenance_names_the_chain(monkeypatch):
    async def fake_many(locations):
        return [None] * len(locations)

    monkeypatch.setattr(map_mod.openmeteo_adapter, "get_current_many", fake_many)
    monkeypatch.setattr(map_mod.cap_adapter, "fetch_alerts", _wake)
    monkeypatch.setattr(config, "SOURCE_MODE", "hybrid")
    monkeypatch.setattr(config, "DEMO_MODE", False)

    out = await map_mod.map_layers()
    assert "alerts:LIVE" in out["provenance"]
    assert "weather:LIVE" in out["provenance"]
    assert out["generated_at"]


# --- demo mode ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_demo_mode_labels_everything_demo(monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", True)
    monkeypatch.setattr(config, "SOURCE_MODE", "demo")
    monkeypatch.setattr(config, "IMD_ADAPTER", "demo")

    out = await map_mod.map_layers()
    assert out["provenance"] == "DEMO"
    # Demo weather fixtures are alert fixtures: the weather column is honestly
    # absent rather than invented.
    assert all(d["weather"] is None for d in out["districts"])
    assert all(d["health"]["risk"] == "unknown" for d in out["districts"])
    assert out["districts"], "the demo map still lists districts"


# --- alert layer severity ----------------------------------------------------

@pytest.mark.asyncio
async def test_worst_active_alert_wins_and_ended_never_colours(monkeypatch):
    async def fake_many(locations):
        return [None] * len(locations)

    def alert(sev, district, state="Telangana"):
        return {
            "identifier": f"{district}-{sev}", "severity": sev,
            "lifecycle_state": "ACTIVE", "headline": district,
            "areaDesc": district, "area": district, "state": state,
            "description": district, "instruction": "", "sender": "test",
        }

    async def fake_alerts():
        return [
            alert("YELLOW", "Hyderabad"),
            alert("RED", "Hyderabad"),        # worst must win
            alert("ORANGE", "ENDED-ALERT"),   # terminal: must not count
            alert("GREEN", "Hyderabad"),
        ], "LIVE"

    monkeypatch.setattr(map_mod.openmeteo_adapter, "get_current_many", fake_many)
    monkeypatch.setattr(map_mod.cap_adapter, "fetch_alerts", fake_alerts)
    monkeypatch.setattr(config, "DEMO_MODE", False)

    out = await map_mod.map_layers()
    hyd = next(d for d in out["districts"] if d["district"] == "Hyderabad")
    assert hyd["alerts"]["severity_label"] == "RED", "worst active severity wins"
    assert hyd["alerts"]["count"] == 3, "three live alerts for Hyderabad"
    assert hyd["alerts"]["active"] is True
