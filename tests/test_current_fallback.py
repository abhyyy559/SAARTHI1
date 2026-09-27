"""Current-weather fallback chain tests — single IMD-first mode (2026-09-27).

The one weather chain: IMD -> Open-Meteo -> OpenWeatherMap -> file cache ->
UNAVAILABLE. No mode switch changes this; the fallbacks engage only when the
earlier source fails or returns nothing.

Provenance honesty: Open-Meteo data is never labelled IMD, and vice versa.

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
from backend.models.weather import WeatherObservation  # noqa: E402
from backend.services.cache_service import CacheService  # noqa: E402
from backend.services.imd_service import IMDService  # noqa: E402
from backend.utils.time import now_ist  # noqa: E402

LAT, LON = 17.385, 78.4867


@pytest.fixture(autouse=True)
def _isolate_runtime(monkeypatch, tmp_path):
    cache_file = str(tmp_path / "weathergpt_cache.json")
    monkeypatch.setattr(config, "CACHE_FILE", cache_file)
    monkeypatch.setattr(weather_mod, "cache", CacheService(cache_file))
    monkeypatch.setattr(config, "IMD_ADAPTER", config.IMD_ADAPTER)


def _obs(source: str = "IMD") -> WeatherObservation:
    return WeatherObservation(
        source=source, location="Hyderabad", issued_at=now_ist(),
        observed_at=now_ist(), temperature_c=30.0, humidity_pct=60.0,
    )


def _imd_down(monkeypatch) -> None:
    async def boom(self, *args, **kwargs):
        raise AdapterUnavailable("IMD live unreachable")

    monkeypatch.setattr(IMDService, "get_current_weather", boom)


def _openmeteo_down(monkeypatch) -> None:
    async def boom(lat, lon):
        raise AdapterUnavailable("open-meteo unreachable")

    monkeypatch.setattr(openmeteo_adapter, "get_current", boom)


def _openmeteo_ok(monkeypatch, calls: list) -> None:
    async def cur(lat, lon):
        calls.append("current")
        return _obs("Open-Meteo"), "LIVE"

    monkeypatch.setattr(openmeteo_adapter, "get_current", cur)


def _owm_down(monkeypatch) -> None:
    async def boom(lat, lon):
        raise AdapterUnavailable("OWM not configured")

    monkeypatch.setattr(owm_adapter, "get_current", boom)


async def test_imd_success_prevents_fallback_calls(monkeypatch):
    """IMD answers -> Open-Meteo and OWM are never called."""
    async def imd_cur(self, lat, lon):
        return _obs("IMD")

    monkeypatch.setattr(IMDService, "get_current_weather", imd_cur)
    om_calls: list = []
    _openmeteo_ok(monkeypatch, om_calls)

    async def owm_cur(lat, lon):  # pragma: no cover — must not be called
        raise AssertionError("OWM called despite IMD answering")

    monkeypatch.setattr(owm_adapter, "get_current", owm_cur)
    data, prov = await weather_mod._live_current(LAT, LON)
    assert data["source"] == "IMD" and prov == "LIVE"
    assert om_calls == []


async def test_imd_failure_falls_back_to_openmeteo(monkeypatch):
    """IMD down -> Open-Meteo answers, honestly labelled Open-Meteo."""
    _imd_down(monkeypatch)
    om_calls: list = []
    _openmeteo_ok(monkeypatch, om_calls)
    data, prov = await weather_mod._live_current(LAT, LON)
    assert om_calls == ["current"]
    assert data["source"] == "Open-Meteo" and prov == "LIVE"
    assert data["source"] != "IMD"  # never mislabelled


async def test_imd_and_openmeteo_failure_falls_back_to_owm(monkeypatch):
    """IMD + Open-Meteo down -> OWM answers, labelled OpenWeatherMap."""
    _imd_down(monkeypatch)
    _openmeteo_down(monkeypatch)

    async def owm_cur(lat, lon):
        return _obs("OpenWeatherMap"), "LIVE"

    monkeypatch.setattr(owm_adapter, "get_current", owm_cur)
    data, prov = await weather_mod._live_current(LAT, LON)
    assert data["source"] == "OpenWeatherMap" and prov == "LIVE"


async def test_all_live_down_serves_cache(monkeypatch):
    """All live sources down -> file cache served, CACHED, stale_note set."""
    _imd_down(monkeypatch)
    _openmeteo_down(monkeypatch)
    _owm_down(monkeypatch)
    weather_mod.cache.set(
        weather_mod._key("current", LAT, LON),
        {"source": "Open-Meteo", "temperature_c": 29.0},
        weather_mod.TTLS["current"],
    )
    data, prov = await weather_mod._live_current(LAT, LON)
    assert prov == "CACHED"
    assert data["source"] == "Open-Meteo"
    assert data["stale_note"] == "Showing last retrieved information; may be outdated."


async def test_all_down_no_cache_is_honest_unavailable(monkeypatch):
    """All live sources down, no cache -> AdapterUnavailable, never fabricated."""
    _imd_down(monkeypatch)
    _openmeteo_down(monkeypatch)
    _owm_down(monkeypatch)
    with pytest.raises(AdapterUnavailable):
        await weather_mod._live_current(LAT, LON)
