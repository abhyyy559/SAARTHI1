"""Forecast fallback chain tests (per docs/SOURCE-MODES.md).

Closes the known gap: `_live_forecast` previously had no OpenWeatherMap leg,
while `_live_current` did. The contract after the fix:

  hybrid forecast chain: IMD -> Open-Meteo -> OpenWeatherMap -> cache -> UNAVAILABLE
  imd mode:              IMD only; OWM is never called and cache is never served.

All network calls are monkeypatched; the runtime cache is isolated to tmp_path.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

import backend.config as config  # noqa: E402
import backend.api.weather as weather_mod  # noqa: E402
import backend.adapters.openmeteo_adapter as openmeteo_adapter  # noqa: E402
import backend.adapters.owm_adapter as owm_adapter  # noqa: E402
from backend.adapters.registry import AdapterUnavailable  # noqa: E402
from backend.models.weather import WeatherForecast  # noqa: E402
from backend.services.cache_service import CacheService  # noqa: E402
from backend.services.imd_service import IMDService  # noqa: E402
from backend.utils.time import now_ist  # noqa: E402

LAT, LON = 17.385, 78.4867


@pytest.fixture(autouse=True)
def _isolate_runtime(monkeypatch, tmp_path):
    cache_file = str(tmp_path / "weathergpt_cache.json")
    monkeypatch.setattr(config, "CACHE_FILE", cache_file)
    monkeypatch.setattr(weather_mod, "cache", CacheService(cache_file))
    monkeypatch.setattr(config, "SOURCE_MODE", config.SOURCE_MODE)
    monkeypatch.setattr(config, "DEMO_MODE", config.DEMO_MODE)
    monkeypatch.setattr(config, "IMD_ADAPTER", config.IMD_ADAPTER)


def _set_mode(monkeypatch, mode: str) -> None:
    monkeypatch.setattr(config, "SOURCE_MODE", mode)
    monkeypatch.setattr(config, "DEMO_MODE", mode == "demo")


def _fc(source: str = "IMD") -> WeatherForecast:
    return WeatherForecast(source=source, location="Hyderabad", issued_at=now_ist(), days=[])


def _imd_down(monkeypatch) -> None:
    async def boom(self, *args, **kwargs):
        raise AdapterUnavailable("IMD live unreachable")

    monkeypatch.setattr(IMDService, "get_forecast", boom)


def _openmeteo_down(monkeypatch) -> None:
    async def boom(lat, lon):
        raise AdapterUnavailable("open-meteo unreachable")

    monkeypatch.setattr(openmeteo_adapter, "get_forecast", boom)


def _owm_ok(monkeypatch, calls: list) -> None:
    async def fc(lat, lon):
        calls.append("forecast")
        return _fc("OpenWeatherMap"), "LIVE"

    monkeypatch.setattr(owm_adapter, "get_forecast", fc)


def _owm_down(monkeypatch) -> None:
    async def boom(lat, lon):
        raise AdapterUnavailable("OWM not configured")

    monkeypatch.setattr(owm_adapter, "get_forecast", boom)


# ----------------------------------------------------------------------------
# hybrid chain: IMD -> Open-Meteo -> OpenWeatherMap -> cache -> UNAVAILABLE
# ----------------------------------------------------------------------------

async def test_hybrid_forecast_falls_back_to_owm(monkeypatch):
    """IMD down AND Open-Meteo down -> OpenWeatherMap forecast leg answers."""
    _set_mode(monkeypatch, "hybrid")
    _imd_down(monkeypatch)
    _openmeteo_down(monkeypatch)
    calls: list = []
    _owm_ok(monkeypatch, calls)
    data, prov = await weather_mod._live_forecast(LAT, LON)
    assert data["source"] == "OpenWeatherMap" and prov == "LIVE"
    assert calls == ["forecast"]
    # The OWM answer is cached like every other leg's answer.
    cached = weather_mod.cache.get(weather_mod._key("forecast", LAT, LON))
    assert cached and cached["source"] == "OpenWeatherMap"


async def test_hybrid_forecast_falls_back_to_cache_after_owm(monkeypatch):
    """All three sources down -> cached forecast served with stale_note, CACHED."""
    _set_mode(monkeypatch, "hybrid")
    _imd_down(monkeypatch)
    _openmeteo_down(monkeypatch)
    _owm_down(monkeypatch)
    weather_mod.cache.set(
        weather_mod._key("forecast", LAT, LON),
        {"source": "Open-Meteo", "days": []},
        weather_mod.TTLS["forecast"],
    )
    data, prov = await weather_mod._live_forecast(LAT, LON)
    assert prov == "CACHED"
    assert data["source"] == "Open-Meteo"  # provenance names the CACHED source
    assert data["stale_note"] == "Showing last retrieved information; may be outdated."


async def test_hybrid_forecast_honest_unavailable(monkeypatch):
    """All sources down, no cache -> AdapterUnavailable, never fabricated."""
    _set_mode(monkeypatch, "hybrid")
    _imd_down(monkeypatch)
    _openmeteo_down(monkeypatch)
    _owm_down(monkeypatch)
    with pytest.raises(AdapterUnavailable):
        await weather_mod._live_forecast(LAT, LON)


async def test_hybrid_forecast_first_source_wins(monkeypatch):
    """IMD reachable -> OWM must not be called (priority preserved)."""
    _set_mode(monkeypatch, "hybrid")

    async def imd_fc(self, lat, lon):
        return _fc("IMD")

    monkeypatch.setattr(IMDService, "get_forecast", imd_fc)
    calls: list = []
    _owm_ok(monkeypatch, calls)
    data, prov = await weather_mod._live_forecast(LAT, LON)
    assert data["source"] == "IMD" and prov == "LIVE"
    assert calls == []


# ----------------------------------------------------------------------------
# imd mode: no OWM, no cache
# ----------------------------------------------------------------------------

async def test_imd_mode_forecast_never_calls_owm(monkeypatch):
    """IMD down in imd mode -> raises before Open-Meteo, OWM, or cache."""
    _set_mode(monkeypatch, "imd")
    _imd_down(monkeypatch)
    calls: list = []
    _owm_ok(monkeypatch, calls)
    weather_mod.cache.set(
        weather_mod._key("forecast", LAT, LON),
        {"source": "Open-Meteo", "days": []},
        weather_mod.TTLS["forecast"],
    )
    with pytest.raises(AdapterUnavailable):
        await weather_mod._live_forecast(LAT, LON)
    assert calls == []  # OWM untouched, cache untouched


# ----------------------------------------------------------------------------
# owm_adapter.get_forecast: pure HTTP-shape tests (fake httpx client)
# ----------------------------------------------------------------------------

def _fake_forecast_response(entries):
    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"city": {"timezone": 19800}, "list": entries}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **k):
            return FakeResp()

    return FakeClient


def _entry(dt, temp, desc, rain=None):
    e = {"dt": dt,
         "main": {"temp": temp},
         "weather": [{"description": desc}]}
    if rain is not None:
        e["rain"] = {"3h": rain}
    return e


def test_owm_forecast_aggregates_daily(monkeypatch):
    """3-hourly entries become one ForecastDay per local calendar date."""
    monkeypatch.setattr(config, "OWM_API_KEY", "test-key")
    # 19800s = +5:30. ts=1690000000 -> UTC 2023-07-22 04:26:40 -> IST 09:56:40 (same date)
    monkeypatch.setattr(owm_adapter.httpx, "AsyncClient", _fake_forecast_response([
        _entry(1690000000, 30.0, "clear sky"),
        _entry(1690010800, 33.0, "few clouds", rain=1.5),   # same local date
        _entry(1690086400, 28.0, "light rain", rain=2.0),    # next local date
    ]))
    import asyncio
    fc, prov = asyncio.run(owm_adapter.get_forecast(17.385, 78.4867))
    assert prov == "LIVE"
    assert fc.source == "OpenWeatherMap"
    assert len(fc.days) == 2
    d0, d1 = fc.days
    assert d0.min_temperature == 30.0 and d0.max_temperature == 33.0
    assert d0.rainfall == 1.5
    assert d0.condition == "Few Clouds"  # warmest entry of the day
    assert d1.rainfall == 2.0 and d1.condition == "Light Rain"


def test_owm_forecast_unconfigured_raises(monkeypatch):
    monkeypatch.setattr(config, "OWM_API_KEY", "")
    import asyncio
    with pytest.raises(AdapterUnavailable):
        asyncio.run(owm_adapter.get_forecast(17.385, 78.4867))


def test_owm_forecast_fetch_failure_raises(monkeypatch):
    monkeypatch.setattr(config, "OWM_API_KEY", "test-key")

    class BoomClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **k):
            raise RuntimeError("connection reset")

    monkeypatch.setattr(owm_adapter.httpx, "AsyncClient", BoomClient)
    import asyncio
    with pytest.raises(AdapterUnavailable):
        asyncio.run(owm_adapter.get_forecast(17.385, 78.4867))
