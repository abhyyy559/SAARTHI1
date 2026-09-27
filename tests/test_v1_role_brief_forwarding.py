"""Regression: v1 GET /weather/current forwards role+lang to the role brief.

v1_current must pass role/lang through to weather.current_wx — the Home
WeatherCard calls this route, and dropping them silently served the
"general" brief to every role.

The live chain is mocked (_live_current/_live_forecast), so this runs
offline; imd mode skips the OWM cross-check, so no network path remains.
"""
import pytest
from fastapi.testclient import TestClient

import backend.api.weather as weather_mod
import backend.config as config
from backend.main import app

FARMER_MODERATE_RAIN_HEADLINE = "Rain in the next few days — plan field work around it"


@pytest.fixture(autouse=True)
def _offline_live(monkeypatch):
    """Deterministic offline chain: moderate rain (22 mm) in the forecast window."""
    async def fake_current(lat, lon):
        return ({"source": "IMD", "temperature": 30.0, "humidity": 50.0,
                 "rainfall": 0.0, "wind_speed": 5.0}, "LIVE")

    async def fake_forecast(lat, lon):
        return ({"source": "IMD", "days": [{"rainfall": 5.0}, {"rainfall": 22.0}]},
                "LIVE")

    monkeypatch.setattr(weather_mod, "_live_current", fake_current)
    monkeypatch.setattr(weather_mod, "_live_forecast", fake_forecast)
    # imd mode skips the OWM cross-check, so no other network path remains.
    monkeypatch.setattr(config, "SOURCE_MODE", "imd")


def test_v1_current_forwards_role_and_lang_to_brief():
    r = TestClient(app).get("/api/v1/weather/current",
                            params={"lat": 17.385, "lon": 78.4867,
                                    "role": "farmer", "lang": "en"})
    assert r.status_code == 200, r.text
    body = r.json()
    brief = body["role_brief"]
    assert brief["role"] == "farmer", brief
    # 22 mm in the window is moderate rain (>= 20, < 50): the farmer headline.
    assert brief["headline"] == FARMER_MODERATE_RAIN_HEADLINE, brief
    assert brief["fired"] == ["moderate_rain"], brief
    assert brief["calm"] is False, brief


def test_v1_current_general_role_gets_its_own_brief():
    """Contrast: the same data with role=general must NOT carry the farmer
    headline — proving role actually reaches the brief, not just the route."""
    r = TestClient(app).get("/api/v1/weather/current",
                            params={"lat": 17.385, "lon": 78.4867,
                                    "role": "general", "lang": "en"})
    assert r.status_code == 200, r.text
    brief = r.json()["role_brief"]
    assert brief["role"] == "general", brief
    assert brief["headline"] == "Rainy days ahead", brief
    assert brief["headline"] != FARMER_MODERATE_RAIN_HEADLINE, brief
