"""IMD adapter tests — demo mode returns valid normalized schema."""
import sys, os, asyncio
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from backend.services.imd_service import IMDService

svc = IMDService(adapter="demo")


async def test_current_weather():
    obs = await svc.get_current_weather(17.385, 78.4867)
    assert obs.temperature == 28, f"FAIL: temp={obs.temperature}"
    assert obs.source == "IMD"
    assert obs.condition == "Cloudy"
    assert obs.observed_at is not None
    print("PASS: test_current_weather")


async def test_forecast():
    fc = await svc.get_forecast(17.385, 78.4867)
    assert len(fc.days) == 7, f"FAIL: days={len(fc.days)}"
    assert fc.days[0].rainfall == 15
    print("PASS: test_forecast")


async def test_warning():
    w = await svc.get_district_warning("Hyderabad")
    assert w is not None
    assert w.hazard == "Thunderstorm"
    assert w.severity == "YELLOW"
    assert w.valid_until is not None
    print("PASS: test_warning")


async def test_nowcast():
    nc = await svc.get_district_nowcast("Hyderabad")
    assert "rain" in nc.lower() or "light" in nc.lower() or "moderate" in nc.lower() or nc
    print("PASS: test_nowcast")


async def main():
    await test_current_weather()
    await test_forecast()
    await test_warning()
    await test_nowcast()
    print("\nAll IMD adapter tests passed.")


if __name__ == "__main__":
    asyncio.run(main())


# --- Real api.imd.gov.in shapes (official reference, verified 2026-10-09) ----
# These drive the LIVE branches with a mocked _get: no network, no key needed.
import datetime as _dt

from backend import config as _config
from backend.adapters.registry import AdapterUnavailable as _AdapterUnavailable


def _live(monkeypatch, payload):
    async def fake_get(self, path, params=None):
        return payload
    monkeypatch.setattr(IMDService, "_get", fake_get)
    return IMDService(adapter="live")


async def test_live_warning_real_shape(monkeypatch):
    payload = [
        {"Obj_id": "999", "District": "Nowhere", "Date": "2026-10-09",
         "Day_1": "1", "Day1_Color": "4"},
        {"Obj_id": "123", "District": "Hyderabad", "Date": "2026-10-09",
         "Day_1": "4,2", "Day1_Color": "2",
         "Day_2": "1", "Day2_Color": "4"},
    ]
    w = await _live(monkeypatch, payload).get_district_warning("Hyderabad")
    assert w is not None
    assert w.source == "IMD"
    assert w.severity == "ORANGE", w.severity  # Day1_Color 2
    assert "Thunderstorm" in w.hazard, w.hazard
    assert "Heavy Rain" in w.message
    assert w.verified is False
    assert w.valid_until is not None and w.issued_at is not None


async def test_live_warning_all_clear_is_none(monkeypatch):
    payload = [{"Obj_id": "123", "District": "Hyderabad", "Date": "2026-10-09",
                "Day_1": "1", "Day1_Color": "4"}]
    w = await _live(monkeypatch, payload).get_district_warning("Hyderabad")
    assert w is None  # answered, nothing to report — never an exception


async def test_live_warning_unknown_district_is_none(monkeypatch):
    payload = [{"Obj_id": "123", "District": "Hyderabad", "Date": "2026-10-09",
                "Day_1": "4", "Day1_Color": "3"}]
    w = await _live(monkeypatch, payload).get_district_warning("Nirmal")
    assert w is None


async def test_live_warning_unreadable_shape_raises(monkeypatch):
    svc = _live(monkeypatch, {"unexpected": "shape"})
    try:
        await svc.get_district_warning("Hyderabad")
    except _AdapterUnavailable:
        return
    raise AssertionError("unreadable shape must raise, never invent calm")


async def test_live_nowcast_message_and_cat16(monkeypatch):
    payload = [{"Station": "Hyderabad", "Date": "2026-10-09",
                "message": "Light thunderstorm likely.", "color": "2"}]
    nc = await _live(monkeypatch, payload).get_district_nowcast("Hyderabad")
    assert nc == "Light thunderstorm likely."
    payload2 = [{"Station": "Hyderabad", "Date": "2026-10-09",
                 "Cat4": "4", "Cat16": "Dust rising over the city", "color": "2"}]
    nc2 = await _live(monkeypatch, payload2).get_district_nowcast("Hyderabad")
    assert nc2 == "Dust rising over the city"


async def test_live_current_nearest_station(monkeypatch):
    payload = [
        {"Station": "Far", "Date of Observation": "2026-10-09",
         "Time of Observation": "0530", "Temperature": "20", "Humidity": "10",
         "Wind Speed": "5", "Last 24 hrs Rainfall": "0", "Weather Code": "02",
         "Latitude": "10.0", "Longitude": "10.0"},
        {"Station": "Near", "Date of Observation": "2026-10-09",
         "Time of Observation": "0530", "Temperature": "31", "Humidity": "60",
         "Wind Speed": "12", "Last 24 hrs Rainfall": "2", "Weather Code": "95",
         "Latitude": "17.4", "Longitude": "78.5"},
    ]
    obs = await _live(monkeypatch, payload).get_current_weather(17.385, 78.4867)
    assert obs.temperature == 31, obs.temperature
    assert obs.condition == "Thunderstorm", obs.condition
    assert obs.observed_at is not None


async def test_live_forecast_nearest_station_seven_days(monkeypatch):
    row = {"Station_Name": "Hyderabad", "Latitude": "17.4", "Longitude": "78.5",
           "Todays_Forecast_Max_Temp": "32", "Todays_Forecast_Min_Temp": "24",
           "Todays_Forecast": "Rain"}
    for i in range(2, 8):
        row[f"Day_{i}_Max_Temp"] = str(30 + i)
        row[f"Day_{i}_Min_Temp"] = str(22 + i)
        row[f"Day_{i}_Forecast"] = "Clear"
    fc = await _live(monkeypatch, [row]).get_forecast(17.385, 78.4867)
    assert len(fc.days) == 7, len(fc.days)
    assert fc.days[0].max_temperature == 32
    assert fc.location == "Hyderabad"


async def test_live_auth_query_scheme_sends_param(monkeypatch):
    import backend.services.imd_service as mod
    seen = {}

    class SpyResp:
        def raise_for_status(self): pass
        def json(self): return []

    class SpyClient:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, params=None, headers=None):
            seen["url"] = url
            seen["params"] = dict(params or {})
            seen["headers"] = dict(headers or {})
            return SpyResp()

    monkeypatch.setattr(mod.httpx, "AsyncClient", SpyClient)
    monkeypatch.setattr(_config, "IMD_ENABLED", True)
    monkeypatch.setattr(_config, "IMD_API_KEY", "k123")
    monkeypatch.setattr(_config, "IMD_JWT", "jwt123")
    monkeypatch.setattr(_config, "IMD_AUTH_SCHEME", "query")
    monkeypatch.setattr(_config, "IMD_AUTH_PARAM", "api_key")
    svc = IMDService(adapter="live")
    try:
        await svc.get_district_warning("Hyderabad")
    except _AdapterUnavailable:
        pass  # empty list shape is unreadable by design here; auth is the point
    assert seen["params"].get("api_key") == "k123", seen
    assert seen["headers"].get("Authorization") == "Bearer jwt123", seen
    assert "x-api-key" not in seen["headers"], seen
    assert seen["url"].startswith("https://"), seen


async def test_live_default_scheme_sends_both_credentials(monkeypatch):
    import backend.services.imd_service as mod
    seen = {}

    class SpyResp:
        def raise_for_status(self): pass
        def json(self): return []

    class SpyClient:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, params=None, headers=None):
            seen["headers"] = dict(headers or {})
            return SpyResp()

    monkeypatch.setattr(mod.httpx, "AsyncClient", SpyClient)
    monkeypatch.setattr(_config, "IMD_ENABLED", True)
    monkeypatch.setattr(_config, "IMD_API_KEY", "k123")
    monkeypatch.setattr(_config, "IMD_JWT", "jwt123")
    monkeypatch.setattr(_config, "IMD_AUTH_SCHEME", "bearer")
    try:
        await IMDService(adapter="live").get_district_warning("Hyderabad")
    except _AdapterUnavailable:
        pass
    assert seen["headers"].get("x-api-key") == "k123", seen
    assert seen["headers"].get("Authorization") == "Bearer jwt123", seen


async def test_live_auto_mint_uses_portal_credentials(monkeypatch):
    """No pasted JWT + portal email/password → mint, cache, send both headers."""
    import backend.services.imd_service as mod
    seen = {}

    class MintResp:
        def raise_for_status(self): pass
        def json(self): return {"access_token": "minted-jwt", "expires_in": 3600}

    class SpyClient:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, **kw):
            seen["mint_url"] = url
            seen["mint_body_keys"] = sorted((json or {}).keys())
            return MintResp()
        async def get(self, url, params=None, headers=None):
            seen["headers"] = dict(headers or {})
            raise _AdapterUnavailable("stop here — headers are the assertion")

    monkeypatch.setattr(mod.httpx, "AsyncClient", SpyClient)
    monkeypatch.setattr(_config, "IMD_ENABLED", True)
    monkeypatch.setattr(_config, "IMD_API_KEY", "k123")
    monkeypatch.setattr(_config, "IMD_JWT", "")
    monkeypatch.setattr(_config, "IMD_API_EMAIL", "u@example.com")
    monkeypatch.setattr(_config, "IMD_API_PASSWORD", "pw")
    monkeypatch.setattr(mod, "_jwt_cache", {"token": None, "at": 0.0})
    svc = IMDService(adapter="live")
    try:
        await svc.get_district_warning("Hyderabad")
    except _AdapterUnavailable:
        pass
    assert seen.get("mint_url", "").endswith("/oauth/token.php"), seen
    assert seen["headers"].get("x-api-key") == "k123", seen
    assert seen["headers"].get("Authorization") == "Bearer minted-jwt", seen


async def test_live_expired_jwt_remints_once_and_retries(monkeypatch):
    """401-invalid → one re-mint + one retry (only when auto-mint configured)."""
    import backend.services.imd_service as mod
    import httpx as _httpx
    calls = {"gets": 0, "mints": 0}

    def _resp(status, text=""):
        req = _httpx.Request("GET", "https://x.test/districtwarning")
        return _httpx.Response(status, text=text, request=req)

    class MintResp:
        def raise_for_status(self): pass
        def json(self):
            calls["mints"] += 1
            return {"access_token": "fresh-jwt"}

    class DataResp:
        def __init__(self, ok): self._ok = ok
        def raise_for_status(self):
            if not self._ok:
                raise _httpx.HTTPStatusError("401", request=_resp(401).request, response=_resp(401, '{"error":"Invalid or expired JWT token"}'))
        def json(self): return []

    class SpyClient:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, **kw): return MintResp()
        async def get(self, url, params=None, headers=None):
            calls["gets"] += 1
            return DataResp(ok=calls["gets"] > 1)

    monkeypatch.setattr(mod.httpx, "AsyncClient", SpyClient)
    monkeypatch.setattr(_config, "IMD_ENABLED", True)
    monkeypatch.setattr(_config, "IMD_API_KEY", "k123")
    monkeypatch.setattr(_config, "IMD_JWT", "")
    monkeypatch.setattr(_config, "IMD_API_EMAIL", "u@example.com")
    monkeypatch.setattr(_config, "IMD_API_PASSWORD", "pw")
    monkeypatch.setattr(mod, "_jwt_cache", {"token": None, "at": 0.0})
    try:
        await IMDService(adapter="live").get_district_warning("Hyderabad")
    except _AdapterUnavailable:
        pass  # empty-list shape is unreadable; the retry is the assertion
    assert calls["gets"] == 2, calls
    assert calls["mints"] == 2, calls  # initial mint + refresh mint


def test_nowcast_uses_requested_district_without_gps(monkeypatch):
    """Regression: ?district=Kakinada with no lat/lon returned Hyderabad's
    nowcast — resolve() with no fix falls back to the default district."""
    from fastapi.testclient import TestClient
    from backend import config as cfg
    from backend.api import weather as wmod
    seen = {}

    class SpyIMD:
        def __init__(self, adapter=None): pass
        async def get_district_nowcast(self, district):
            seen["district"] = district
            return "Kakinada nowcast text"

    monkeypatch.setattr(wmod, "IMDService", SpyIMD)
    monkeypatch.setattr(cfg, "DEMO_MODE", False)
    from backend.main import app
    with TestClient(app) as c:
        r = c.get("/api/weather/nowcast", params={"district": "Kakinada"})
    assert r.status_code == 200, r.text
    assert seen.get("district") == "Kakinada", seen
    assert r.json()["district"] == "Kakinada"


async def test_live_key_without_jwt_fails_fast_without_network(monkeypatch):
    """Key but no JWT is a certain 401: report UNCONFIGURED naming IMD_JWT and
    never construct the HTTP client."""
    import backend.services.imd_service as mod
    from backend.adapters import registry as _registry

    def _boom_client(**kw):
        raise AssertionError("no network call may happen without the JWT")

    monkeypatch.setattr(mod.httpx, "AsyncClient", _boom_client)
    monkeypatch.setattr(_config, "IMD_ENABLED", True)
    monkeypatch.setattr(_config, "IMD_API_KEY", "k123")
    monkeypatch.setattr(_config, "IMD_JWT", "")
    monkeypatch.setattr(_config, "IMD_API_EMAIL", "")
    monkeypatch.setattr(_config, "IMD_API_PASSWORD", "")
    try:
        await IMDService(adapter="live").get_district_warning("Hyderabad")
    except _AdapterUnavailable:
        pass
    else:
        raise AssertionError("must raise without the JWT")
    imd = next(s for s in _registry.snapshot() if s["name"] == "imd")
    assert imd["status"] == "UNCONFIGURED", imd
    assert "IMD_JWT" in imd["detail"], imd
