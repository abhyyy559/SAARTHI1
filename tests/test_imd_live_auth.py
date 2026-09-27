"""IMD live-path tests — dual-header auth, JWT caching, station-ID fail-closed.

The network is faked by monkeypatching make_client. No real IMD calls.
"""
import os
import sys
from datetime import date

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend import config
import backend.services.imd_service as imd_mod
from backend.services.imd_service import IMDService
from backend.adapters.registry import AdapterUnavailable


CURRENT_PAYLOAD = {
    "Temperature": "29.5",
    "Humidity": "70",
    "Wind Speed": "11",
    "Wind Direction": "270",
    "Last 24 hrs Rainfall": "0",
    "Weather": "Partly cloudy",
    "Station": "Hyderabad",
    "Date of Observation": "2026-09-27",
    "Time of Observation": "09:00",
}

# Fixture IDs only — these are not real IMD station IDs.
STATION_MAP = {
    "Hyderabad": {"current": "ST-CUR-1", "forecast": "ST-FC-1",
                  "warning": "DIST-W-1", "nowcast": "DIST-N-1"},
}


class FakeResponse:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload if payload is not None else {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}", request=None, response=None)

    def json(self):
        return dict(self._payload)


class ScriptedClient:
    """Stand-in for httpx.AsyncClient. GETs are served from `get_script` in
    order; when it is empty, CURRENT_PAYLOAD is returned."""
    posts = []
    gets = []
    token_calls = 0
    get_script = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None, **kwargs):
        ScriptedClient.posts.append({"url": url, "json": json})
        ScriptedClient.token_calls += 1
        return FakeResponse(200, {
            "access_token": f"jwt-{ScriptedClient.token_calls}",
            "token_type": "Bearer",
            "expires_in": 3600,
        })

    async def get(self, url, params=None, headers=None):
        ScriptedClient.gets.append({
            "url": url, "params": dict(params or {}),
            "headers": dict(headers or {})})
        if ScriptedClient.get_script:
            return ScriptedClient.get_script.pop(0)
        return FakeResponse(200, CURRENT_PAYLOAD)


@pytest.fixture
def live_imd(monkeypatch):
    monkeypatch.setattr(config, "IMD_API_KEY", "key-123")
    monkeypatch.setattr(config, "IMD_API_EMAIL", "user@example.com")
    monkeypatch.setattr(config, "IMD_API_PASSWORD", "s3cret")
    monkeypatch.setattr(config, "IMD_BASE_URL", "https://api.imd.gov.in/api/v1")
    monkeypatch.setattr(config, "IMD_TOKEN_URL",
                        "https://api.imd.gov.in/api/oauth/token.php")
    monkeypatch.setattr(config, "IMD_STATION_IDS", dict(STATION_MAP))
    monkeypatch.setattr(config, "IMD_DEFAULT_DISTRICT", "Hyderabad")
    monkeypatch.setattr(config, "IMD_TIMEOUT", 10.0)
    monkeypatch.setattr(imd_mod, "make_client",
                        lambda timeout=None: ScriptedClient())
    ScriptedClient.posts = []
    ScriptedClient.gets = []
    ScriptedClient.token_calls = 0
    ScriptedClient.get_script = []
    return IMDService(adapter="live")


async def test_dual_headers_id_param_and_parsing(live_imd):
    obs = await live_imd.get_current_weather(17.38, 78.48, "Hyderabad")

    assert len(ScriptedClient.posts) == 1
    post = ScriptedClient.posts[0]
    assert post["url"] == "https://api.imd.gov.in/api/oauth/token.php"
    assert post["json"] == {"email": "user@example.com", "password": "s3cret"}

    assert len(ScriptedClient.gets) == 1
    get = ScriptedClient.gets[0]
    assert get["url"] == "https://api.imd.gov.in/api/v1/current_wx"
    assert get["params"] == {"id": "ST-CUR-1"}
    assert get["headers"]["X-API-KEY"] == "key-123"
    assert get["headers"]["Authorization"] == "Bearer jwt-1"
    # The old wrong placement (Bearer <API key>) must be gone.
    assert get["headers"]["Authorization"] != "Bearer key-123"

    assert obs.source == "IMD"
    assert obs.temperature == 29.5
    assert obs.humidity == 70.0
    assert obs.rainfall == 0.0
    assert obs.wind_speed == 11.0
    assert obs.condition == "Partly cloudy"
    assert obs.observed_at is not None


async def test_jwt_cached_across_calls(live_imd):
    await live_imd.get_current_weather(17.38, 78.48, "Hyderabad")
    await live_imd.get_current_weather(17.38, 78.48, "Hyderabad")
    assert ScriptedClient.token_calls == 1
    assert len(ScriptedClient.gets) == 2
    assert ScriptedClient.gets[1]["headers"]["Authorization"] == "Bearer jwt-1"


async def test_401_refreshes_jwt_and_retries_once(live_imd):
    ScriptedClient.get_script = [
        FakeResponse(401, {"error": "invalid token"}),
        FakeResponse(200, CURRENT_PAYLOAD),
    ]
    obs = await live_imd.get_current_weather(17.38, 78.48, "Hyderabad")
    assert ScriptedClient.token_calls == 2
    assert len(ScriptedClient.gets) == 2
    assert ScriptedClient.gets[0]["headers"]["Authorization"] == "Bearer jwt-1"
    assert ScriptedClient.gets[1]["headers"]["Authorization"] == "Bearer jwt-2"
    assert obs.temperature == 29.5


async def test_unknown_district_fails_closed(live_imd):
    # No manual override for Atlantis; the mapping fetch returns the
    # scripted current-weather payload (not a mapping table), so no district
    # ID resolves and the call fails closed without a data request.
    with pytest.raises(AdapterUnavailable):
        await live_imd.get_current_weather(17.38, 78.48, "Atlantis")
    data_gets = [g for g in ScriptedClient.gets if "current_wx" in g["url"]]
    assert data_gets == []


async def test_no_key_fails_before_network(live_imd, monkeypatch):
    monkeypatch.setattr(config, "IMD_API_KEY", "")
    with pytest.raises(AdapterUnavailable):
        await live_imd.get_current_weather(17.38, 78.48, "Hyderabad")
    assert ScriptedClient.posts == []
    assert ScriptedClient.gets == []


async def test_green_day1_is_all_clear(live_imd):
    ScriptedClient.get_script = [FakeResponse(200, {
        "District": "Hyderabad", "Day_1": "", "Day1_Color": "1",
        "Date": date.today().isoformat()})]
    assert await live_imd.get_district_warning("Hyderabad") is None
    assert ScriptedClient.gets[0]["params"] == {"id": "DIST-W-1"}


async def test_yellow_warning_parsed(live_imd):
    ScriptedClient.get_script = [FakeResponse(200, {
        "District": "Hyderabad", "Day_1": "4", "Day1_Color": "2",
        "Date": date.today().isoformat()})]
    w = await live_imd.get_district_warning("Hyderabad")
    assert w is not None
    assert w.severity == "YELLOW"
    assert w.hazard == "Thunderstorm & Lightning"
    assert w.district == "Hyderabad"
    assert w.active is True


async def test_unknown_warning_code_surfaced_honestly(live_imd):
    ScriptedClient.get_script = [FakeResponse(200, {
        "District": "Hyderabad", "Day_1": "42", "Day1_Color": "3",
        "Date": date.today().isoformat()})]
    w = await live_imd.get_district_warning("Hyderabad")
    assert w.severity == "ORANGE"
    assert w.hazard == "IMD warning code 42"


async def test_forecast_day_fields(live_imd):
    ScriptedClient.get_script = [FakeResponse(200, {
        "Station_Name": "Hyderabad",
        "Todays_Forecast_Max_Temp": "32", "Todays_Forecast_Min_temp": "24",
        "Todays_Forecast": "Partly cloudy", "Past_24_hrs_Rainfall": "2",
        "Day_2_Max_Temp": "33", "Day_2_Min_Temp": "25",
        "Day_2_Forecast": "Sunny",
        "Day_7_Max_Temp": "31", "Day_7_Min_Temp": "23",
        "Day_7_Forecast": "Rain",
    })]
    fc = await live_imd.get_forecast(17.38, 78.48, "Hyderabad")
    assert len(fc.days) == 7
    assert fc.days[0].max_temperature == 32.0
    assert fc.days[0].min_temperature == 24.0
    assert fc.days[0].condition == "Partly cloudy"
    assert fc.days[0].rainfall == 2.0
    assert fc.days[0].date == date.today().isoformat()
    assert fc.days[1].max_temperature == 33.0
    assert fc.days[1].condition == "Sunny"
    assert fc.days[6].condition == "Rain"
    assert fc.days[6].rainfall is None
    assert fc.location == "Hyderabad"
    assert ScriptedClient.gets[0]["params"] == {"id": "ST-FC-1"}


async def test_nowcast_message(live_imd):
    ScriptedClient.get_script = [FakeResponse(200, {
        "message": "Light rain likely", "color": "2"})]
    text = await live_imd.get_district_nowcast("Hyderabad")
    assert text == "Light rain likely"
    assert ScriptedClient.gets[0]["params"] == {"id": "DIST-N-1"}


async def test_garbled_fields_are_none_not_zero(live_imd):
    """A garbled IMD field must surface as unavailable (None), never as a
    measured 0.0 — the old _num() fallback would have rendered '0°C' as if
    IMD had actually observed it."""
    ScriptedClient.get_script = [FakeResponse(200, {
        "Temperature": "N/A", "Humidity": "", "Wind Speed": None,
        "Last 24 hrs Rainfall": "trace",
        "Weather": "Clear",
        "Date of Observation": "2026-09-27", "Time of Observation": "09:00",
    })]
    obs = await live_imd.get_current_weather(17.38, 78.48, "Hyderabad")
    assert obs.temperature is None
    assert obs.humidity is None
    assert obs.wind_speed is None
    assert obs.rainfall is None
    assert obs.condition == "Clear"
    assert obs.observed_at is not None


async def test_imd_uses_proxy_safe_client_factory(live_imd, monkeypatch):
    """IMD must build HTTP clients via the registry's proxy-safe make_client
    (the factory every other adapter uses). A raw httpx.AsyncClient dies at
    construction on hosts with malformed proxy env vars — which would take
    IMD down the moment credentials are installed. Re-patching with a spy
    proves the module calls make_client(timeout=...) rather than building a
    raw httpx.AsyncClient itself."""
    seen = {}

    def spy(timeout=None):
        seen["timeout"] = timeout
        return ScriptedClient()

    monkeypatch.setattr(imd_mod, "make_client", spy)
    await live_imd.get_current_weather(17.38, 78.48, "Hyderabad")
    assert seen["timeout"] == config.IMD_TIMEOUT
