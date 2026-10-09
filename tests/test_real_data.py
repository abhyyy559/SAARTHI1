"""Real-data guarantees: chat never answers from fixtures by default, a live
SACHET check counts as a warning check, and the chat names the true source."""
import importlib
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from fastapi.testclient import TestClient

from backend import config
from backend.adapters.registry import AdapterUnavailable
from backend.api import chat, weather
from backend.main import app
from backend.services import alert_service

HYD = {"latitude": 17.385, "longitude": 78.4867, "district": "Hyderabad"}


def _reload_config(monkeypatch, **env):
    """Config as it would load under `env`, then restore the real one."""
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    try:
        return SimpleNamespace(**vars(importlib.reload(config)))
    finally:
        monkeypatch.undo()
        importlib.reload(config)


def test_demo_mode_defaults_off(monkeypatch):
    assert _reload_config(monkeypatch, DEMO_MODE="").DEMO_MODE is False
    assert _reload_config(monkeypatch, DEMO_MODE="true").DEMO_MODE is True


def test_sachet_feeds_on_by_default(monkeypatch):
    cfg = _reload_config(monkeypatch, CAP_FEED_URLS="", CAP_FEED_URL="")
    assert cfg.CAP_FEED_URLS == cfg.DEFAULT_CAP_FEED_URLS
    assert all(u.startswith("https://sachet.ndma.gov.in/") for u in cfg.CAP_FEED_URLS)
    assert _reload_config(monkeypatch, CAP_FEED_URLS="off").CAP_FEED_URLS == []


def test_imd_key_alias(monkeypatch):
    assert _reload_config(monkeypatch, IMD_API_KEY="", IMD_KEY="abc").IMD_API_KEY == "abc"


def _gathered(official: bool):
    return {"relevant": [], "nearby": [], "provenance": "LIVE" if official else "UNAVAILABLE",
            "feeds": ["NDMA-Sachet-CAP"] if official else [], "available": official,
            "official_available": official}


def _imd_down(monkeypatch):
    async def down(self, district):
        raise AdapterUnavailable("no IMD key")
    monkeypatch.setattr(weather.IMDService, "get_district_warning", down)


def test_sachet_checked_with_no_district_alert_is_not_unreachable(monkeypatch):
    _imd_down(monkeypatch)
    monkeypatch.setattr(weather, "gather_alerts", AsyncMock(return_value=_gathered(True)))
    with TestClient(app) as client:
        body = client.get("/api/weather/warnings", params={
            "district": "Hyderabad", "lat": HYD["latitude"], "lon": HYD["longitude"]}).json()
    assert body["status"] == "ok"
    assert body["verdict"]["level"] == "LOW"
    assert "unreachable" not in body["verdict"]["detail"]


def test_imd_and_sachet_both_down_stays_unknown(monkeypatch):
    _imd_down(monkeypatch)
    monkeypatch.setattr(weather, "gather_alerts", AsyncMock(return_value=_gathered(False)))
    with TestClient(app) as client:
        body = client.get("/api/weather/warnings", params={
            "district": "Hyderabad", "lat": HYD["latitude"], "lon": HYD["longitude"]}).json()
    assert body["verdict"]["level"] == "UNKNOWN"


def test_cached_sachet_cannot_support_a_calm():
    # The flag that lets a verdict say "checked" is LIVE-only by construction.
    src = open(alert_service.__file__, encoding="utf-8").read()
    assert '"official_available": cap_prov == LIVE' in src


def test_chat_names_the_source_that_supplied_the_numbers(monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", False)
    monkeypatch.setattr(chat, "_fetch_current_safe", AsyncMock(return_value=(
        {"source": "Open-Meteo", "temperature": 31.0, "observed_at": "2026-10-09T12:00:00+05:30"}, "LIVE")))
    monkeypatch.setattr(chat, "_fetch_forecast_safe", AsyncMock(return_value=(None, "UNAVAILABLE")))
    monkeypatch.setattr(chat, "_fetch_warning_safe", AsyncMock(return_value=(
        None, {"verified": False, "severity": "GREEN", "hazard": None, "source": "IMD",
               "warning_service": "unavailable"}, False)))
    monkeypatch.setattr(chat, "gather_alerts", AsyncMock(return_value=_gathered(True)))
    import asyncio
    loc = {"district": "Hyderabad", "state": "Telangana", "latitude": 17.385, "longitude": 78.4867}
    _, _, _, _, notes = asyncio.run(chat._retrieve_live(loc, 17.385, 78.4867))
    assert notes["source_name"] == "Open-Meteo"
    assert notes["warning_service_available"] is True


def test_sea_permission_question_never_opens_with_yes_or_no():
    te = "ఈ రోజు సముద్రంలోకి వెళ్ళవచ్చా?"
    assert chat._drop_permission_yesno(te, "**అవును, రేపు 0.6 మిమీ వర్షం.**") == "**రేపు 0.6 మిమీ వర్షం.**"
    assert chat._drop_permission_yesno("Can I go to sea today?", "Yes — no warning.") == "no warning."
    assert chat._drop_permission_yesno("Is it safe to go fishing?", "No warning is active.") == "No warning is active."
    # A rain question keeps its yes/no: that one IS a weather fact.
    assert chat._drop_permission_yesno("Will it rain at sea?", "Yes, 4 mm.") == "Yes, 4 mm."


def test_nearby_count_ignores_expired_alerts():
    from datetime import datetime, timedelta, timezone
    from backend.services.verdict_service import build_verdict
    iso = lambda h: (datetime.now(timezone.utc) + timedelta(hours=h)).isoformat()
    nearby = [{"severity": "ORANGE", "expires": iso(-5)}, {"severity": "ORANGE", "expires": iso(-1)},
              {"severity": "YELLOW", "expires": iso(3)}, {"severity": "YELLOW"}]
    v = build_verdict(nearby_alerts=nearby, warning_service_available=True)
    assert v["nearby_count"] == 2, v
    assert "2 official alert(s) elsewhere" in v["detail"], v


def test_answer_in_wrong_script_is_detected():
    from backend.services.llm_service import in_language
    assert in_language("Visakhapatnam లో ప్రస్తుతం 33°C, వర్షం లేదు.", "te")
    assert in_language("Hyderabad में अभी 33°C है, बारिश नहीं।", "hi")
    assert not in_language("No active official warning; risk level LOW.", "te")
    assert not in_language("No active official warning; risk level LOW.", "hi")
    assert in_language("Anything at all", "en")
    assert in_language("NDMA 33°C", "te"), "too few letters to judge: never replace"


def test_english_answer_to_telugu_question_is_replaced(monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", False)
    monkeypatch.setattr(chat, "_fetch_current_safe", AsyncMock(return_value=(
        {"source": "Open-Meteo", "temperature": 33.4, "condition": "Mostly Clear",
         "observed_at": "2026-10-09T12:00:00+05:30"}, "LIVE")))
    monkeypatch.setattr(chat, "_fetch_forecast_safe", AsyncMock(return_value=(None, "UNAVAILABLE")))
    monkeypatch.setattr(chat, "_fetch_warning_safe", AsyncMock(return_value=(
        None, {"verified": False, "severity": "GREEN", "hazard": None, "source": "IMD",
               "warning_service": "unavailable"}, False)))
    monkeypatch.setattr(chat, "gather_alerts", AsyncMock(return_value=_gathered(True)))
    monkeypatch.setattr(chat.LLMService, "generate", AsyncMock(return_value=(
        "No active official warning; risk level LOW. Visakhapatnam district is coastal.", False)))
    with TestClient(app) as client:
        body = client.post("/api/v1/chat", json={
            "message": "ఈ రోజు సముద్రంలోకి వెళ్ళవచ్చా?", "language": "te", "user_type": "fisherman",
            "latitude": 17.6868, "longitude": 83.2185}).json()
    from backend.services.llm_service import in_language
    assert in_language(body["answer"], "te"), body["answer"]


def test_stray_cjk_tokens_are_removed():
    assert chat._FOREIGN_SCRIPT.sub("", "రేపు **Light Drizzle**予, వర్షం 0.6 mm") == "రేపు **Light Drizzle**, వర్షం 0.6 mm"
    assert chat._FOREIGN_SCRIPT.sub("", "बारिश 4 mm, 33°C") == "बारिश 4 mm, 33°C"


def test_rejected_imd_key_is_skipped_until_cooldown(monkeypatch):
    """A key IMD has not whitelisted yet must cost one round trip, not one per request."""
    import asyncio
    import httpx
    from backend.adapters import registry
    from backend.services import imd_service
    # Keep this test's IMD OFFLINE report out of the shared source registry.
    monkeypatch.setattr(registry, "_STATUSES",
                        {n: registry.SourceStatus(name=n) for n in registry._KNOWN_SOURCES})
    monkeypatch.setattr(config, "IMD_API_KEY", "k")
    calls = []

    class Fake:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, params=None, headers=None):
            calls.append(url)
            return httpx.Response(400, json={"status": False, "message": "Unauthorised Access"},
                                  request=httpx.Request("GET", url))

    monkeypatch.setattr(imd_service.httpx, "AsyncClient", Fake)
    svc = imd_service.IMDService(adapter="live")
    for _ in range(5):
        try:
            asyncio.run(svc.get_district_warning("Hyderabad"))
        except AdapterUnavailable:
            pass
    assert len(calls) == 1, calls
    imd_service.reset_breaker()
    try:
        asyncio.run(svc.get_district_warning("Hyderabad"))
    except AdapterUnavailable:
        pass
    assert len(calls) == 2, "after the cooldown IMD is tried again"


def test_stats_are_measured_not_invented(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from backend.adapters import cap_adapter
    from backend.api import sources
    iso = lambda h: (datetime.now(timezone.utc) + timedelta(hours=h)).isoformat()
    monkeypatch.setattr(sources, "_alert_count", {"at": 0.0, "value": None})
    monkeypatch.setattr(cap_adapter, "fetch_alerts", AsyncMock(return_value=(
        [{"expires": iso(2)}, {"expires": iso(-3)}, {"expires": iso(5)}], "LIVE")))
    with TestClient(app) as client:
        body = client.get("/api/stats").json()
    assert body["official_alerts_in_force"] == 2, "expired alerts are not counted"
    assert body["districts_covered"] >= 50
    assert body["languages"] == ["en", "hi", "te"]
    assert {s["name"]: s["live"] for s in body["sources"]}["NDMA SACHET"] is True

    monkeypatch.setattr(sources, "_alert_count", {"at": 0.0, "value": None})
    monkeypatch.setattr(cap_adapter, "fetch_alerts", AsyncMock(side_effect=AdapterUnavailable("down")))
    with TestClient(app) as client:
        body = client.get("/api/stats").json()
    assert body["official_alerts_in_force"] is None, "unknown is null, never zero"
    assert {s["name"]: s["live"] for s in body["sources"]}["NDMA SACHET"] is False


def test_stats_list_keyless_open_meteo_before_first_use(monkeypatch):
    """Fresh process: Open-Meteo is configured (keyless) before any weather call."""
    from backend.adapters import cap_adapter, registry
    from backend.api import sources
    monkeypatch.setattr(registry, "_STATUSES",
                        {n: registry.SourceStatus(name=n) for n in registry._KNOWN_SOURCES})
    monkeypatch.setattr(sources, "_alert_count", {"at": 0.0, "value": None})
    monkeypatch.setattr(cap_adapter, "fetch_alerts", AsyncMock(return_value=([], "LIVE")))
    with TestClient(app) as client:
        body = client.get("/api/stats").json()
    assert {s["name"]: s["live"] for s in body["sources"]}["Open-Meteo"] is True


def test_sachet_read_is_shared_and_callers_get_copies(monkeypatch):
    import asyncio
    from backend.adapters import cap_adapter
    calls = []

    async def fake(urls):
        calls.append(urls)
        return [{"identifier": "a1", "severity": "ORANGE"}], "LIVE"

    monkeypatch.setattr(config, "CAP_FEED_URLS", ["https://sachet.example/rss.xml"])
    monkeypatch.setattr(cap_adapter, "_fetch_alerts_uncached", fake)
    first, _ = asyncio.run(cap_adapter.fetch_alerts())
    first[0]["relevance"] = {"district": "Hyderabad"}  # a caller annotating its copy
    second, prov = asyncio.run(cap_adapter.fetch_alerts())
    assert len(calls) == 1 and prov == "LIVE"
    assert "relevance" not in second[0], "one district's annotations must not leak to the next"


def test_quantified_rain_statement_gets_no_second_rain_lead():
    fc = {"days": [{"rainfall": 0}, {"rainfall": 0.6}]}
    te = "రేపు వర్షం పడుతుంది, 0.6 మిమీ.\n\nఅధికారిక హెచ్చరికలు లేవు."
    assert chat._ensure_rain_lead("రేపు వర్షం పడుతుందా?", fc, te, "te") == te
    en = "Light drizzle tomorrow: rain about 0.6 mm."
    assert chat._ensure_rain_lead("Will it rain tomorrow?", fc, en, "en") == en


def test_marine_endpoint_reports_unavailable_never_calm(monkeypatch):
    from backend.adapters import marine_adapter
    monkeypatch.setattr(marine_adapter, "sea_state", AsyncMock(side_effect=AdapterUnavailable("down")))
    with TestClient(app) as client:
        body = client.get("/api/weather/marine", params={"lat": 19.81, "lon": 85.83}).json()
    assert body["status"] == "unavailable" and body["provenance"] == "UNAVAILABLE"
    monkeypatch.setattr(marine_adapter, "sea_state", AsyncMock(return_value={
        "source": "Open-Meteo Marine", "note": marine_adapter.NOTE, "current_wave_height_m": 0.9,
        "days": [{"date": "2026-10-09", "wave_height_max_m": 1.1, "swell_max_m": 0.8, "wind_max_kmh": 12, "gust_max_kmh": 25}]}))
    with TestClient(app) as client:
        body = client.get("/api/weather/marine", params={"lat": 19.81, "lon": 85.83}).json()
    assert body["marine"]["days"][0]["wave_height_max_m"] == 1.1
    assert "Not an INCOIS or IMD" in body["marine"]["note"]


def test_map_alerts_are_placed_on_named_districts(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from backend.adapters import cap_adapter
    from backend.api import map as map_api
    iso = lambda h: (datetime.now(timezone.utc) + timedelta(hours=h)).isoformat()
    monkeypatch.setattr(config, "CAP_FEED_URLS", ["https://sachet.example/rss_india.xml"])

    async def fake(urls=None):
        if urls and "rss_odisha" in urls[0]:
            return [{"identifier": "o1", "severity": "ORANGE", "hazard": "Lightning", "expires": iso(3),
                     "areaDesc": "Puri, Ganjam districts"},
                    {"identifier": "o2", "severity": "RED", "hazard": "Flood", "expires": iso(-2),
                     "areaDesc": "Cuttack"},
                    {"identifier": "o3", "severity": "YELLOW", "hazard": "Rain", "expires": iso(5),
                     "areaDesc": "coastal belt"}], "LIVE"
        return [], "LIVE"

    monkeypatch.setattr(cap_adapter, "fetch_alerts", fake)
    with TestClient(app) as client:
        body = client.get("/api/map/alerts").json()
    assert body["status"] == "ok" and body["alerts"] == 2, body  # the expired one is dropped
    named = {(p["district"], p["severity"]) for p in body["points"] if not p["approx"]}
    assert ("Puri", "ORANGE") in named and ("Ganjam", "ORANGE") in named
    approx = [p for p in body["points"] if p["approx"]]
    assert len(approx) == 1 and approx[0]["state"] == "Odisha", "unnamed area sits at the state centre, flagged"


def test_map_alerts_off_when_sachet_is_off():
    with TestClient(app) as client:
        body = client.get("/api/map/alerts").json()
    assert body["status"] == "unavailable"
