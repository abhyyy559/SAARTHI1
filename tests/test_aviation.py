"""Aviation briefing tests (eval gap #1 — Aviation weather briefing).

Contracts under test:
1. NEVER emit anything that looks like a synthetic METAR/TAF. The only
   occurrences of "METAR"/"TAF" in the whole payload are the mandatory
   disclaimer ("NOT an official METAR/TAF").
2. Missing GFS pressure-level data -> UNAVAILABLE sections with an honest
   reason, never synthesized numbers.
3. Severity is backend-authoritative: the briefing never escalates or
   re-grades; UNKNOWN stays UNKNOWN.
4. The mandatory disclaimer ships in en, hi and te.
5. imd mode: non-official meteorology is withheld (official-only rule) and
   alerts are gathered official-only. Demo mode: labelled DEMO fixtures.

All network calls are monkeypatched. Deterministic: same fake inputs give
the same briefing.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import asyncio  # noqa: E402

import backend.config as config  # noqa: E402
from backend.adapters import openmeteo_adapter  # noqa: E402
from backend.adapters.registry import AdapterUnavailable  # noqa: E402
from backend.services import alert_service  # noqa: E402
from backend.services import aviation_service  # noqa: E402

LAT, LON = 17.385, 78.4867


def _lvl(p, spd=20.0, deg=270.0, temp=None, rh=None):
    return {"level_hpa": p, "wind_speed_kt": spd, "wind_direction_deg": deg,
            "temperature_c": temp, "relative_humidity_pct": rh}


def _fake_inputs(**kw):
    d = {
        "source": "Open-Meteo", "model": "GFS (gfs_seamless)",
        "levels_now": [_lvl(1000, 8.0, 90.0, 30.0, 70.0),
                       _lvl(850, 20.0, 270.0, 18.0, 60.0),
                       _lvl(700, 35.0, 260.0, 5.0, 40.0),
                       _lvl(500, 50.0, 250.0, -12.0, 20.0)],
        "levels_plus6h": [_lvl(1000, 9.0, 95.0), _lvl(850, 22.0, 272.0),
                          _lvl(700, 38.0, 262.0), _lvl(500, 52.0, 252.0)],
        "visibility_m": 8000.0,
        "cloud_cover_low_pct": 20.0, "cloud_cover_mid_pct": 35.0,
        "cloud_cover_high_pct": 10.0,
        "sunrise": "06:10", "sunset": "18:32",
    }
    d.update(kw)
    return d


def _no_alerts():
    return {"relevant": [], "nearby": [], "provenance": "UNAVAILABLE",
            "feeds": [], "available": True}


def _wire(monkeypatch, *, inputs=None, inputs_error=None, alerts=None, mode="hybrid"):
    async def fake_inputs(lat, lon):
        if inputs_error:
            raise inputs_error
        return inputs if inputs is not None else _fake_inputs(), "LIVE"

    async def fake_gather(**kwargs):
        return dict(alerts if alerts is not None else _no_alerts())

    monkeypatch.setattr(openmeteo_adapter, "get_aviation_inputs", fake_inputs)
    monkeypatch.setattr(alert_service, "gather_alerts", fake_gather)
    monkeypatch.setattr(config, "SOURCE_MODE", mode)
    monkeypatch.setattr(config, "DEMO_MODE", mode == "demo")


def _strings(payload):
    """Every string value in the payload, nested."""
    out = []

    def walk(x):
        if isinstance(x, str):
            out.append(x)
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, (list, tuple)):
            for v in x:
                walk(v)

    walk(payload)
    return out


def _sections(b):
    return {s["section"]: s for s in b["sections"]}


# --- 1. No synthetic METAR/TAF ------------------------------------------------

METAR_LIKE = re.compile(r"^[A-Z]{4}\s+\d{6}Z")


def test_no_synthetic_metar_taf(monkeypatch):
    _wire(monkeypatch)
    b = asyncio.run(aviation_service.build_briefing(LAT, LON, "en"))
    for s in _strings(b):
        assert not METAR_LIKE.match(s), f"METAR-like string leaked: {s!r}"
    metar_hits = [s for s in _strings(b) if "METAR" in s or "TAF" in s]
    # The only allowed mention is the disclaimer's "NOT an official METAR/TAF".
    assert metar_hits == [b["disclaimer"]], metar_hits
    assert "NOT an official METAR/TAF" in b["disclaimer"]
    print("PASS: test_no_synthetic_metar_taf")


# --- 2. UNAVAILABLE honesty when GFS levels are missing ------------------------

def test_gfs_missing_is_unavailable_not_synthesized(monkeypatch):
    _wire(monkeypatch, inputs_error=AdapterUnavailable("open-meteo unreachable"))
    b = asyncio.run(aviation_service.build_briefing(LAT, LON, "en"))
    secs = _sections(b)
    for name in ("winds_aloft", "cloud", "visibility", "turbulence_icing", "sun"):
        s = secs[name]
        assert s["status"] == "UNAVAILABLE", (name, s)
        assert s.get("reason"), (name, s)
        assert "data" not in s, (name, s)  # no synthesized numbers
    # The alerts section must still run: one dead feed is not an excuse for
    # dropping official warnings from the briefing.
    assert secs["alerts"]["status"] == "OK"
    print("PASS: test_gfs_missing_is_unavailable_not_synthesized")


def test_no_cloud_proxy_without_labels(monkeypatch):
    _wire(monkeypatch, inputs=_fake_inputs(
        cloud_cover_low_pct=None, cloud_cover_mid_pct=None, cloud_cover_high_pct=None))
    b = asyncio.run(aviation_service.build_briefing(LAT, LON, "en"))
    s = _sections(b)["cloud"]
    assert s["status"] == "UNAVAILABLE", s
    print("PASS: test_no_cloud_proxy_without_labels")


# --- 3. Severity never escalated ----------------------------------------------

def _wire_alert(monkeypatch, severity):
    alert = {
        "identifier": "av-1", "headline": "Heavy rain expected",
        "severity": severity, "event": "Rain", "area": "Hyderabad",
        "source": "NDMA-Sachet-CAP", "provenance": "LIVE",
        "effective": "2026-09-20T00:00:00", "expires": "2026-09-21T00:00:00",
    }
    _wire(monkeypatch, alerts={"relevant": [alert], "nearby": [],
                              "provenance": "LIVE", "feeds": ["NDMA-Sachet-CAP"],
                              "available": True})


def test_severity_unknown_stays_unknown(monkeypatch):
    _wire_alert(monkeypatch, "UNKNOWN")
    b = asyncio.run(aviation_service.build_briefing(LAT, LON, "en"))
    verdict = _sections(b)["alerts"]["data"]["verdict"]
    assert verdict["level"] == "UNKNOWN", verdict
    row = _sections(b)["alerts"]["data"]["relevant"][0]
    assert row["severity"] == "UNKNOWN", row
    print("PASS: test_severity_unknown_stays_unknown")


def test_severity_passes_through_unescalated(monkeypatch):
    _wire_alert(monkeypatch, "ORANGE")
    b = asyncio.run(aviation_service.build_briefing(LAT, LON, "en"))
    verdict = _sections(b)["alerts"]["data"]["verdict"]
    # The verdict comes from the same build_verdict every view uses; the
    # briefing must carry exactly what it says — no re-grading here.
    assert verdict["level"] == "HIGH", verdict
    assert verdict["severity"] == "ORANGE", verdict
    row = _sections(b)["alerts"]["data"]["relevant"][0]
    assert row["severity"] == "ORANGE", row
    print("PASS: test_severity_passes_through_unescalated")


# --- 4. Disclaimer parity en/hi/te --------------------------------------------

def test_disclaimer_en_hi_te(monkeypatch):
    _wire(monkeypatch)
    for lang, must in (("en", "NOT an official METAR/TAF"),
                       ("hi", "आधिकारिक METAR/TAF"),
                       ("te", "అధికారిక METAR/TAF")):
        b = asyncio.run(aviation_service.build_briefing(LAT, LON, lang))
        assert must in b["disclaimer"], (lang, b["disclaimer"])
        assert b["disclaimer"] != aviation_service.DISCLAIMER["en"] or lang == "en", lang
    # All three languages have distinct, non-empty disclaimer text.
    texts = {aviation_service.DISCLAIMER[k] for k in ("en", "hi", "te")}
    assert len(texts) == 3 and all(texts), texts
    # Unknown language falls back to English.
    b = asyncio.run(aviation_service.build_briefing(LAT, LON, "ta"))
    assert b["disclaimer"] == aviation_service.DISCLAIMER["en"], b["disclaimer"]
    print("PASS: test_disclaimer_en_hi_te")


# --- 5. Mode semantics ---------------------------------------------------------

def test_route_registered_on_app():
    from backend import main

    paths = {getattr(r, "path", None) for r in main.app.routes}
    assert "/api/aviation/briefing" in paths, sorted(p for p in paths if p)
    print("PASS: test_route_registered_on_app")


def test_imd_mode_withholds_non_official_meteorology(monkeypatch):
    captured = {}

    async def fake_gather(**kwargs):
        captured.update(kwargs)
        return _no_alerts()

    async def fake_inputs(lat, lon):  # pragma: no cover — must not be called
        raise AssertionError("non-official fetch in imd mode")

    monkeypatch.setattr(openmeteo_adapter, "get_aviation_inputs", fake_inputs)
    monkeypatch.setattr(alert_service, "gather_alerts", fake_gather)
    monkeypatch.setattr(config, "SOURCE_MODE", "imd")
    monkeypatch.setattr(config, "DEMO_MODE", False)

    b = asyncio.run(aviation_service.build_briefing(LAT, LON, "en"))
    secs = _sections(b)
    for name in ("winds_aloft", "cloud", "visibility", "turbulence_icing", "sun"):
        assert secs[name]["status"] == "UNAVAILABLE", (name, secs[name])
        assert "imd mode" in secs[name]["reason"], (name, secs[name])
    # Official-only alert gather — the commercial chain is never consulted.
    assert captured.get("force_official_only") is True, captured
    print("PASS: test_imd_mode_withholds_non_official_meteorology")


def test_demo_mode_labels_sample_data(monkeypatch):
    _wire(monkeypatch, mode="demo")
    b = asyncio.run(aviation_service.build_briefing(LAT, LON, "en"))
    secs = _sections(b)
    for name in ("winds_aloft", "cloud", "visibility", "sun"):
        assert secs[name]["status"] == "OK", (name, secs[name])
        assert secs[name]["provenance"] == "DEMO", (name, secs[name])
    print("PASS: test_demo_mode_labels_sample_data")


# --- Determinism: proxies are labelled, numbers are real ------------------------

def test_proxies_are_labelled_and_numbers_real(monkeypatch):
    _wire(monkeypatch)
    b = asyncio.run(aviation_service.build_briefing(LAT, LON, "en"))
    secs = _sections(b)
    cloud = secs["cloud"]
    assert cloud["proxy"] is True
    assert "proxy" in cloud["note"].lower() and "measured" in cloud["note"].lower()
    vis = secs["visibility"]
    assert vis["proxy"] is True and vis["data"]["visibility_m"] == 8000.0
    winds = secs["winds_aloft"]["data"]
    rows = {r["level_hpa"]: r for r in winds["now"] if r}
    assert rows[850]["wind_speed_kt"] == 20.0
    assert rows[850]["wind_direction_deg"] == 270.0
    assert rows[850]["wind_from"] == "W"
    turb = secs["turbulence_icing"]
    assert turb["proxy"] is True
    assert turb["data"]["wind_shear_850_500_kt"] is not None
    assert turb["data"]["turbulence_proxy_band"] in ("low", "moderate", "elevated")
    # Temperature crosses 0 between 700 and 500 hPa in the fixture.
    fz = turb["data"]["freezing_level_proxy"]
    assert fz == {"between_hpa": [700, 500], "interp_fraction": 0.29}, fz
    sun = secs["sun"]
    assert sun["data"]["sunrise"] == "06:10" and sun["data"]["sunset"] == "18:32"
    print("PASS: test_proxies_are_labelled_and_numbers_real")
