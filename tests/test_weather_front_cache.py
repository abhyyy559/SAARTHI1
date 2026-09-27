"""The OWM forecast fallback must populate the short front cache, exactly like
the IMD and Open-Meteo paths do — otherwise repeat views re-hit OWM inside
the 15-minute window. No network: adapters are stubbed.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import backend.api.weather as weather_api
from backend.adapters import openmeteo_adapter, owm_adapter
from backend.adapters.registry import AdapterUnavailable
from backend.models.weather import WeatherForecast
from backend.services.cache_service import CacheService


def _fake_forecast():
    return WeatherForecast(
        source="OpenWeatherMap",
        location="Hyderabad",
        issued_at="2026-09-27T09:00:00+05:30",
        days=[],
    )


async def _boom(latitude, longitude):
    raise AdapterUnavailable("open-meteo down")


def test_owm_forecast_fallback_is_front_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(weather_api, "cache",
                        CacheService(path=str(tmp_path / "cache.json")))
    monkeypatch.setattr(weather_api, "_imd_keyed", lambda: False)
    monkeypatch.setattr(openmeteo_adapter, "get_forecast", _boom)
    calls = {"n": 0}

    async def _owm(latitude, longitude):
        calls["n"] += 1
        return _fake_forecast(), "LIVE"

    monkeypatch.setattr(owm_adapter, "get_forecast", _owm)

    data1, prov1 = asyncio.run(weather_api._live_forecast(17.38, 78.48))
    assert prov1 == "LIVE"
    assert data1["source"] == "OpenWeatherMap"
    assert calls["n"] == 1

    # Second call inside the window must be served from the front cache —
    # no second OWM round trip — and carry the honest cache age.
    data2, prov2 = asyncio.run(weather_api._live_forecast(17.38, 78.48))
    assert calls["n"] == 1, "OWM was hit again inside the front-cache window"
    assert prov2 == "LIVE"
    assert data2["source"] == "OpenWeatherMap"
    assert data2["cache_age_s"] >= 0
