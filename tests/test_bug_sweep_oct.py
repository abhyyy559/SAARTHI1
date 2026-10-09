"""Regression tests for the October 2026 bug sweep.

Every test here failed before its fix. Grouped by area:

1. District-name lookup picked the wrong district whenever a short name hid
   inside a longer one (Kurnool -> Nagarkurnool, West -> East Godavari, ...).
2. Demo mode: chat and the advisory answered every place from the Hyderabad
   sample, and the generic samples were dated weeks in the past.
3. Route impact: an official RED/ORANGE warning came back "affected: false".
4. Push watcher: one unconfirmed pass erased the memory of a live warning.
5. Stores: cache instances clobbered each other, a dead Postgres was retried
   on every call, and server-loop db calls bypassed the bridge loop.
6. Smaller correctness fixes (status endpoints, climate window, RAG keywords,
   IMD/OWM parsing, STT frames, InTouch ids, a Telugu string).

All network calls are stubbed; stores are isolated by tests/conftest.py.
"""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import backend.api.weather as weather_mod
from backend import config
from backend.adapters import alert_sources, cap_adapter, openmeteo_adapter, owm_adapter
from backend.adapters.registry import AdapterUnavailable
from backend.models.weather import ForecastDay, WeatherForecast, WeatherWarning
from backend.services import alert_service as alert_service_mod
from backend.services import alert_watcher, db, impact_service, push_service, store_bridge
from backend.services.cache_service import CacheService
from backend.services.imd_service import IMDService
from backend.services.location_service import GAZETTEER, LocationService
from backend.utils.time import now_ist


@pytest.fixture
def client():
    from backend.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _isolate_cache(monkeypatch, tmp_path):
    """Weather/CAP caching must never touch the developer's real cache file."""
    cache_file = str(tmp_path / "weathergpt_cache.json")
    monkeypatch.setattr(config, "CACHE_FILE", cache_file)
    monkeypatch.setattr(weather_mod, "cache", CacheService(cache_file))


# ---------------------------------------------------------------------------
# 1. District-name lookup
# ---------------------------------------------------------------------------
def test_every_gazetteer_name_resolves_to_its_own_district():
    svc = LocationService()
    wrong = []
    for entry in GAZETTEER:
        for name in [entry["district"], entry["city"], *(entry.get("aliases") or [])]:
            hit = svc.lookup(name)
            if not hit or hit["district"] != entry["district"]:
                wrong.append((name, entry["district"], hit and hit["district"]))
    assert wrong == [], wrong


@pytest.mark.parametrize("query, expected", [
    ("Kurnool", "Kurnool"),                        # was Nagarkurnool
    ("West Godavari", "West Godavari"),            # was East Godavari
    ("Srikakulam", "Srikakulam"),                  # was Sri Sathya Sai
    ("Palnadu", "Palnadu"),                        # was Chennai ("Tamil Nadu")
    ("Medchal Malkajgiri", "Medchal Malkajgiri"),  # was Gir Somnath, Gujarat
    ("Yadadri Bhuvanagiri", "Yadadri Bhuvanagiri"),
    ("Jangoan", "Jangaon"),                        # was North Goa
    ("Warangal Telangana", "Warangal"),            # state word used to win
    ("Nizamabad, Telangana", "Nizamabad"),
])
def test_a_short_name_inside_a_longer_one_does_not_win(query, expected):
    assert LocationService().lookup(query)["district"] == expected


def test_search_lists_the_exact_name_first():
    # The manual city box applies results[0].
    assert LocationService().search("Kurnool")[0]["district"] == "Kurnool"
    assert LocationService().search("West Godavari")[0]["district"] == "West Godavari"


def test_watcher_places_a_district_by_its_own_coordinates():
    """The push watcher looks districts up by name; a wrong hit sent the alert
    gather to Gujarat's coordinates and state for Medchal Malkajgiri."""
    loc = LocationService().lookup("Medchal Malkajgiri")
    assert loc["state"] == "Telangana"


# ---------------------------------------------------------------------------
# 2. Demo mode answers for the place that was asked about
# ---------------------------------------------------------------------------
VIZAG = {"latitude": 17.6868, "longitude": 83.2185}


def test_demo_chat_uses_the_districts_own_sample(client, monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", True)
    monkeypatch.setattr(config, "LLM_API_KEY", "")
    r = client.post("/api/chat", json={"message": "Will it rain tomorrow?", **VIZAG})
    assert r.status_code == 200, r.text
    body = r.json()
    cur = body["weather"]["current"]
    # The Visakhapatnam preset, exactly what /api/v1/weather/current serves.
    home = client.get("/api/v1/weather/current", params={"lat": 17.6868, "lon": 83.2185}).json()
    assert cur["temperature"] == home["current"]["temperature"] == 29.0
    assert cur["condition"] == "Heavy rain"
    tomorrow = body["weather"]["forecast_days"][1]
    assert tomorrow["rainfall"] == 110.0, tomorrow
    # In words, not millimetres: 110 mm is IMD "heavy".
    assert "heavy rain" in body["answer"], body["answer"]


def test_demo_advisory_cards_cite_the_districts_own_forecast(client, monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", True)
    r = client.get("/api/advisory/cards", params={"lat": 17.6868, "lon": 83.2185, "persona": "farmer"})
    assert r.status_code == 200, r.text
    basis = " ".join(b for c in r.json()["cards"] for b in c["basis"])
    assert "110mm" in basis, basis


def test_demo_advisory_weather_basis_uses_the_districts_sample(client, monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", True)
    r = client.get("/api/v1/advisories", params={"lat": 17.6868, "lon": 83.2185, "user_type": "general"})
    assert r.status_code == 200, r.text
    assert r.json()["weather_basis"].get("rain_mm") == 58.0, r.json()["weather_basis"]


def test_demo_generic_forecast_is_dated_from_today():
    fc = asyncio.run(IMDService(adapter="demo").get_forecast(17.385, 78.4867, district="Warangal"))
    today = now_ist().date()
    assert [d.date for d in fc.days[:3]] == [
        (today + timedelta(days=i)).isoformat() for i in range(3)]
    assert fc.location == "Warangal"


def test_demo_generic_cap_sample_is_in_force_now():
    alerts, prov = cap_adapter.demo_fixture("Hyderabad")
    assert prov == "DEMO" and alerts
    now = datetime.now(timezone.utc)
    for a in alerts:
        assert datetime.fromisoformat(a["sent"]) <= now <= datetime.fromisoformat(a["expires"]), a


# ---------------------------------------------------------------------------
# 3. Route impact with an official warning
# ---------------------------------------------------------------------------
def _route_stubs(monkeypatch, *, rain, severity):
    async def forecast(lat, lon):
        days = [ForecastDay(date="d0", rainfall=rain), ForecastDay(date="d1", rainfall=rain)]
        return WeatherForecast(source="Open-Meteo", issued_at=now_ist(), days=days), "LIVE"

    async def warning(self, district):
        if district != "Warangal":
            return None
        return WeatherWarning(source="IMD", hazard="Thunderstorm", severity=severity,
                              district=district, issued_at=now_ist() - timedelta(minutes=5),
                              valid_until=now_ist() + timedelta(hours=4))

    monkeypatch.setattr(openmeteo_adapter, "get_forecast", forecast)
    monkeypatch.setattr(IMDService, "get_district_warning", warning)


def test_route_with_an_official_red_warning_is_affected(monkeypatch):
    _route_stubs(monkeypatch, rain=0.0, severity="RED")
    data, _ = asyncio.run(impact_service.analyze_route(17.385, 78.4867, 18.0, 79.58))
    a = data["assessment"]
    assert a["risk_level"] == "CRITICAL", a
    assert a["affected"] is True, a
    assert "No weather blockers" not in a["advisory"], a


def test_route_green_warning_never_replaces_unknown(monkeypatch):
    _route_stubs(monkeypatch, rain=None, severity="GREEN")
    data, _ = asyncio.run(impact_service.analyze_route(17.385, 78.4867, 18.0, 79.58))
    assert data["assessment"]["risk_level"] == "UNKNOWN", data["assessment"]


# ---------------------------------------------------------------------------
# 4. Push watcher keeps what the user was told across an unconfirmed pass
# ---------------------------------------------------------------------------
DISTRICT = "SweepDistrict"


def _cap(severity="ORANGE", expires_in_h=6.0):
    return {"id": "cap-sweep", "severity": severity, "hazard": "Thunderstorm",
            "headline": "Thunderstorm warning", "source": "NDMA-Sachet-CAP",
            "sent": "2026-10-01T10:00:00+05:30",
            "expires": (datetime.now(timezone.utc) + timedelta(hours=expires_in_h)).isoformat()}


@pytest.fixture
def feeds(monkeypatch):
    state = {"alerts": [], "available": True}
    pushed = []

    async def fake_gather(lat=None, lon=None, district="", state_name="", **kw):
        return {"relevant": list(state["alerts"]), "nearby": [], "available": state["available"],
                "official_checked": state["available"]}

    monkeypatch.setattr(alert_service_mod, "gather_alerts", fake_gather)
    monkeypatch.setattr(push_service, "broadcast", lambda payload, district="": pushed.append(payload) or
                        {"targeted": 1, "delivered": 1, "failed": 0, "pruned": 0, "results": []})
    alert_watcher._save_state({})
    yield state, pushed
    alert_watcher._save_state({})


def _check():
    return asyncio.run(alert_watcher.check_district(DISTRICT))["notified"]


def test_a_feed_blip_does_not_reannounce_the_same_warning(feeds):
    state, pushed = feeds
    assert _check() is None                      # calm baseline
    state["alerts"] = [_cap()]
    assert _check() == "start"
    state["alerts"], state["available"] = [], False
    assert _check() is None                      # outage: silent
    state["alerts"], state["available"] = [_cap()], True
    assert _check() is None                      # same warning: not news
    assert [p["title"] for p in pushed] == ["Weather alert"]


def test_the_all_clear_still_comes_after_a_stale_gap(feeds):
    state, pushed = feeds
    assert _check() is None
    state["alerts"] = [_cap()]
    assert _check() == "start"
    state["alerts"] = [_cap(expires_in_h=-1)]   # lapsed bulletin in the backlog
    assert _check() is None                      # stale: unconfirmed, silent
    state["alerts"] = []                         # feed answers: nothing in force
    assert _check() == "clear"
    assert [p["title"] for p in pushed] == ["Weather alert", "Safe now"]


# ---------------------------------------------------------------------------
# 5. Stores
# ---------------------------------------------------------------------------
def test_cache_instances_sharing_a_file_keep_each_others_keys(tmp_path):
    path = str(tmp_path / "shared.json")
    weather_cache = CacheService(path)          # long-lived, like api/weather.py
    weather_cache.set("current:x", {"t": 1}, timedelta(minutes=30))
    CacheService(path).set("cap_alerts", [{"id": "a"}], timedelta(minutes=30))  # cap_adapter
    weather_cache.set("forecast:x", {"t": 2}, timedelta(hours=3))
    fresh = CacheService(path)
    assert fresh.get("cap_alerts") == [{"id": "a"}]
    assert fresh.get("current:x") == {"t": 1}
    assert fresh.get("forecast:x") == {"t": 2}


def test_unusable_postgres_falls_back_once_not_on_every_call(monkeypatch, tmp_path):
    attempts = []

    class FailingAsyncpg:
        @staticmethod
        async def create_pool(url, **kw):
            attempts.append(url)
            raise OSError("connection refused")

    import sys
    monkeypatch.setitem(sys.modules, "asyncpg", FailingAsyncpg)
    monkeypatch.setattr(db, "database_url", lambda: "postgresql://u:p@db.invalid/x")
    monkeypatch.setattr(db, "_json_path", lambda name: tmp_path / name)
    db._BACKEND, db._POOL = None, None
    try:
        store_bridge.run(db.kv_set("k", 1))
        assert store_bridge.run(db.kv_get("k")) == 1
        store_bridge.run(db.kv_get("k"))
        assert len(attempts) == 1, attempts
        assert db.backend_name() == "json"
    finally:
        db._BACKEND, db._POOL = None, None


def test_mode_persistence_runs_on_the_bridge_loop(monkeypatch):
    from backend.services import mode_persistence
    loops = []

    async def record(*args, **kwargs):
        loops.append(asyncio.get_running_loop())
        return None

    monkeypatch.setattr(db, "kv_set", record)
    monkeypatch.setattr(db, "kv_get", record)
    asyncio.run(mode_persistence.persist_async("demo"))
    asyncio.run(mode_persistence.restore_async())
    assert loops and all(lp is store_bridge._get_loop() for lp in loops), loops


# ---------------------------------------------------------------------------
# 6. Smaller correctness fixes
# ---------------------------------------------------------------------------
def test_needs_keys_counts_the_plural_cap_feed_setting(client, monkeypatch):
    monkeypatch.setattr(config, "CAP_FEED_URLS", ["https://example.invalid/rss.xml"])
    monkeypatch.setattr(config, "CAP_FEED_URL", "")
    assert client.get("/api/sources").json()["needs_keys"]["CAP_FEED_URL"] is False
    assert client.get("/api/v1/system/status").json()["needs_keys"]["CAP_FEED_URL"] is False


def test_system_status_is_not_live_on_local_math_alone(client, monkeypatch):
    import backend.api.v1 as v1_mod
    monkeypatch.setattr(config, "DEMO_MODE", False)
    monkeypatch.setattr(v1_mod, "snapshot", lambda: [
        {"name": "gis-location", "status": "LIVE", "detail": "", "updated_at": ""},
        {"name": "gis-hazard", "status": "LIVE", "detail": "", "updated_at": ""},
        {"name": "open-meteo", "status": "OFFLINE", "detail": "", "updated_at": ""},
        {"name": "cap", "status": "ERROR", "detail": "", "updated_at": ""},
    ])
    assert client.get("/api/v1/system/status").json()["state"] == "LIMITED"


@pytest.mark.parametrize("today, expected", [
    (date(2026, 10, 10), (date(2006, 1, 1), date(2025, 12, 31))),
    (date(2027, 1, 3), (date(2006, 1, 1), date(2025, 12, 31))),   # ERA5 lag: 2026 not complete yet
    (date(2027, 1, 6), (date(2007, 1, 1), date(2026, 12, 31))),
])
def test_climate_trends_use_complete_years_only(today, expected):
    from backend.services.climate_service import _complete_years
    assert _complete_years(today, 20) == expected


def test_rag_matches_hindi_transliterations():
    from backend.services import rag_service
    assert rag_service.retrieve("bijli chamak rahi hai", "en")[0]["hazard"] == "thunderstorm"
    assert rag_service.retrieve("baadh aa gayi", "en")[0]["hazard"] == "flood"


def test_telugu_student_line_says_bad_weather():
    from backend.services.advisory_service import _NO_WARN
    assert "పెరుగుదల" not in _NO_WARN["student"]["te"]
    assert "చెడు వాతావరణంలో" in _NO_WARN["student"]["te"]


def _live_imd(monkeypatch, payload):
    monkeypatch.setattr(config, "IMD_API_KEY", "key")
    monkeypatch.setattr(config, "IMD_JWT", "jwt")

    async def fake_get(self, path, params=None):
        return payload

    monkeypatch.setattr(IMDService, "_get", fake_get)


def test_imd_unreadable_observation_time_is_unavailable_not_a_500(monkeypatch):
    _live_imd(monkeypatch, [{"Station": "Hyderabad", "Date of Observation": "10-10-2026",
                             "Time of Observation (UTC)": "0300", "Temperature": "29.5",
                             "Latitude": "17.4", "Longitude": "78.5"}])
    with pytest.raises(AdapterUnavailable):
        asyncio.run(IMDService(adapter="live").get_current_weather(17.385, 78.4867))


def test_imd_missing_reading_stays_missing(monkeypatch):
    _live_imd(monkeypatch, [{"Station": "Hyderabad", "Date of Observation": "2026-10-10",
                             "Time of Observation (UTC)": "0300", "Temperature": "29.5",
                             "Latitude": "17.4", "Longitude": "78.5"}])
    obs = asyncio.run(IMDService(adapter="live").get_current_weather(17.385, 78.4867))
    assert obs.temperature == 29.5
    # Not reported by the station: unknown, never an invented 0.
    assert obs.humidity is None and obs.wind_speed is None and obs.rainfall is None


def test_owm_current_reports_observation_time_wind_and_rain(monkeypatch):
    monkeypatch.setattr(config, "OWM_API_KEY", "test-key")

    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"dt": 1790000000, "main": {"temp": 27.0, "humidity": 80},
                    "wind": {"speed": 5.0}, "rain": {"1h": 1.2},
                    "weather": [{"description": "light rain"}]}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **k):
            return FakeResp()

    monkeypatch.setattr(owm_adapter.httpx, "AsyncClient", FakeClient)
    out, prov = asyncio.run(owm_adapter.get_current(17.385, 78.4867))
    assert prov == "LIVE"
    assert out["wind_speed"] == 18.0          # 5 m/s in km/h
    assert out["rainfall"] == 1.2
    assert datetime.fromisoformat(out["observed_at"]) == datetime.fromtimestamp(1790000000, tz=timezone.utc)


def test_stt_websocket_masks_control_frames():
    from backend.adapters.stt_provider import _RawWebSocket
    for opcode, payload in ((0xA, b"ping-data"), (0x8, b""), (0x1, b'{"type":"flush"}')):
        frame = _RawWebSocket._frame(opcode, payload)
        assert frame[0] == 0x80 | opcode
        assert frame[1] & 0x80, "client frames must carry the mask bit"
        n = frame[1] & 0x7F
        mask, body = frame[2:6], frame[6:]
        assert n == len(payload)
        assert bytes(b ^ mask[i % 4] for i, b in enumerate(body)) == payload


def test_intouch_alerts_without_ids_are_not_deduplicated_away(monkeypatch):
    import json

    class FakeResp:
        text = json.dumps({"result": {"content": [{"type": "text", "text": json.dumps({"alerts": [
            {"event": "Heavy Rain", "severity": "ORANGE", "headline": "Heavy rain over Hyderabad"},
            {"event": "Thunderstorm", "severity": "YELLOW", "headline": "Thunderstorm over Hyderabad"},
        ]})}]}})

        def raise_for_status(self):
            pass

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return FakeResp()

    monkeypatch.setattr(alert_sources.httpx, "AsyncClient", FakeClient)
    alerts = asyncio.run(alert_sources._from_weatherintouch(17.385, 78.4867, "Hyderabad"))
    ids = [a["identifier"] for a in alerts]
    assert len(ids) == 2 and len(set(ids)) == 2, ids
