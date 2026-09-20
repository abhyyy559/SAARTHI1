"""Per-district demo fixtures — the location-switcher "different places,
different alerts" contract (backend/services/district_demo.py).

Eval-compliance (section 5, rules 2-3): demo severities come only from the
fixed registry table — never invented at request time. An unknown district
falls back to the generic fixture honestly; a calm district (Chennai)
reports an answered-but-empty check, never a guessed all-clear.
"""
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.adapters import cap_adapter  # noqa: E402
from backend.services import district_demo  # noqa: E402
from backend.services.imd_service import IMDService  # noqa: E402

svc = IMDService(adapter="demo")

# The distinct alert set each preset district must serve in demo mode:
# (hazard, severity) pairs from cap_adapter.demo_fixture.
EXPECTED_ALERTS = {
    "Visakhapatnam": [("Cyclone", "ORANGE"), ("Heavy rain", "ORANGE")],
    "Mumbai Suburban": [("Thunderstorm", "YELLOW")],
    "Chennai": [],
    # Medchal Malkajgiri deliberately serves the pre-existing demo set
    # (the Hyderabad thunderstorm sample, retargeted by name).
    "Medchal Malkajgiri": [("Thunderstorm", "YELLOW")],
}

ALLOWED_SEVERITIES = {"RED", "ORANGE", "YELLOW", "GREEN", "UNKNOWN"}


def test_each_preset_returns_its_distinct_alert_set():
    """The core demo contract: every preset district gets its own alert set."""
    seen = {}
    for district, expected in EXPECTED_ALERTS.items():
        alerts, _prov = cap_adapter.demo_fixture(district)
        got = [(a["hazard"], a["severity"]) for a in alerts]
        assert got == expected, f"{district}: expected {expected}, got {got}"
        seen[district] = got
    # The sets really differ per place (Medchal shares the generic set).
    assert seen["Visakhapatnam"] != seen["Mumbai Suburban"]
    assert seen["Chennai"] != seen["Visakhapatnam"]
    assert seen["Medchal Malkajgiri"] == [("Thunderstorm", "YELLOW")]
    print("PASS: test_each_preset_returns_its_distinct_alert_set")


def test_provenance_is_demo_on_all_fixtures():
    """Every fixture — alerts, warning, current, forecast, nowcast — stays
    labelled DEMO so the frontend's sample-data banner tells the truth."""
    for district in list(EXPECTED_ALERTS) + ["Hyderabad", "Somewhere Unknown"]:
        alerts, prov = cap_adapter.demo_fixture(district)
        assert prov == "DEMO", f"{district}: cap provenance is {prov!r}, not DEMO"
        for a in alerts:
            assert a.get("demo") is True or a.get("source", "").startswith("NDMA"), \
                f"{district}: fixture alert lost its demo labelling"
    print("PASS: test_provenance_is_demo_on_all_fixtures")


async def test_unknown_district_falls_back_honestly():
    """An unknown district gets the generic fixture retargeted by name —
    the SAME severity the file fixture carries, never an invented one."""
    alerts, prov = cap_adapter.demo_fixture("Nirmal")
    assert prov == "DEMO"
    got = [(a["hazard"], a["severity"]) for a in alerts]
    assert got == [("Thunderstorm", "YELLOW")], f"fallback invented data: {got}"
    assert "Nirmal" in alerts[0]["areaDesc"], "fallback must retarget the area by name"
    # The IMD demo warning path falls back the same honest way.
    w = await svc.get_district_warning("Nirmal")
    assert w is not None and w.severity == "YELLOW" and w.district == "Nirmal"
    print("PASS: test_unknown_district_falls_back_honestly")


def test_no_real_severity_invention():
    """Severities served in demo mode are exactly the registry's declared
    values — the code invents nothing at request time."""
    for district, expected in EXPECTED_ALERTS.items():
        alerts, _ = cap_adapter.demo_fixture(district)
        for a in alerts:
            assert a["severity"] in ALLOWED_SEVERITIES
        assert [(a["hazard"], a["severity"]) for a in alerts] == expected
    # Registry severities are the only ones the warning path can emit.
    for name, entry in district_demo.PRESETS.items():
        warn = entry["warning"]
        if warn is not None:
            assert warn["severity"] in ("RED", "ORANGE", "YELLOW"), name
    print("PASS: test_no_real_severity_invention")


async def test_chennai_calm_is_honest():
    """Chennai: the service answers and reports nothing — an honest
    all-clear, never a guessed one and never a hidden fixture."""
    alerts, prov = cap_adapter.demo_fixture("Chennai")
    assert prov == "DEMO" and alerts == []
    w = await svc.get_district_warning("Chennai")
    assert w is None, "calm preset must return no warning object"
    nc = await svc.get_district_nowcast("Chennai")
    assert "Chennai" in nc and "No significant weather" in nc
    c = await svc.get_current_weather(13.0827, 80.2707, district="Chennai")
    assert c.condition == "Clear" and c.rainfall == 0
    print("PASS: test_chennai_calm_is_honest")


def test_preset_fixtures_are_fresh():
    """Fixture timestamps are relative to now — a fixed 2026-09-15 date would
    silently expire and the demo would show nothing on stage."""
    now = datetime.now().astimezone()
    for district in ("Visakhapatnam", "Mumbai Suburban"):
        alerts, _ = cap_adapter.demo_fixture(district)
        assert alerts, f"{district} has no fixture alerts"
        for a in alerts:
            sent = datetime.fromisoformat(a["sent"])
            expires = datetime.fromisoformat(a["expires"])
            assert sent <= now <= expires, f"{district}: fixture alert not currently valid"
    print("PASS: test_preset_fixtures_are_fresh")


async def test_demo_weather_varies_per_district():
    """Different places, different weather: current + forecast + nowcast are
    distinct per preset district."""
    viz = await svc.get_current_weather(17.6868, 83.2185, district="Visakhapatnam")
    mum = await svc.get_current_weather(19.09, 72.8656, district="Mumbai Suburban")
    che = await svc.get_current_weather(13.0827, 80.2707, district="Chennai")
    assert (viz.temperature, viz.condition) == (29.0, "Heavy rain")
    assert (mum.temperature, mum.condition) == (27.0, "Rain")
    assert (che.temperature, che.condition) == (31.0, "Clear")
    fc = await svc.get_forecast(17.6868, 83.2185, district="Visakhapatnam")
    assert fc.location == "Visakhapatnam"
    assert any("rain" in d["condition"].lower() for d in fc.model_dump(mode="json")["days"])
    nc = await svc.get_district_nowcast("Visakhapatnam")
    assert "cyclonic" in nc.lower()
    print("PASS: test_demo_weather_varies_per_district")


async def test_preset_warnings_validate_and_stay_current():
    """Preset IMD warnings flow through the normal demo warning path: valid
    now, matching district, declared severity."""
    w = await svc.get_district_warning("Visakhapatnam")
    assert w is not None
    assert (w.hazard, w.severity, w.district) == ("Cyclone", "ORANGE", "Visakhapatnam")
    assert w.issued_at <= datetime.now(w.issued_at.tzinfo) <= w.valid_until
    w2 = await svc.get_district_warning("Mumbai Suburban")
    assert (w2.hazard, w2.severity) == ("Thunderstorm", "YELLOW")
    print("PASS: test_preset_warnings_validate_and_stay_current")


def test_district_name_normalization():
    """Registry lookup tolerates case and stray whitespace."""
    assert district_demo.preset_for("visakhapatnam")["district"] == "Visakhapatnam"
    assert district_demo.preset_for("  MUMBAI SUBURBAN ")["district"] == "Mumbai Suburban"
    assert district_demo.preset_for("Medchal Malkajgiri") is None  # generic path
    assert district_demo.demo_warning("Chennai") is None  # explicit calm
    assert district_demo.demo_warning("Nirmal") is district_demo.FALLBACK
    print("PASS: test_district_name_normalization")
