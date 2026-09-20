"""Source-mode contract tests (docs/SOURCE-MODES.md).

Three modes — demo / imd / hybrid — with one switch. The behavioural rule that
matters most: in `imd` mode an unreachable IMD is reported as UNAVAILABLE and is
NEVER silently backfilled with Open-Meteo/OWM/cache, because this console's
whole claim is provenance honesty.

All external calls are monkeypatched, so these run offline. The runtime cache is
isolated to tmp_path so the developer's real weathergpt_cache.json is untouched.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import backend.config as config  # noqa: E402
import backend.api.weather as weather_mod  # noqa: E402
import backend.adapters.alert_sources as alert_sources  # noqa: E402
import backend.adapters.cap_adapter as cap_adapter  # noqa: E402
import backend.adapters.openmeteo_adapter as openmeteo_adapter  # noqa: E402
import backend.adapters.owm_adapter as owm_adapter  # noqa: E402
from backend.adapters.registry import AdapterUnavailable  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models.weather import WeatherForecast, WeatherObservation  # noqa: E402
from backend.services.cache_service import CacheService  # noqa: E402
from backend.services.imd_service import IMDService  # noqa: E402
from backend.utils.time import now_ist  # noqa: E402

HYBRID_BODY = {
    "mode": "hybrid",
    "source_mode": "hybrid",
    "demo_mode": False,
    "weather_source": "IMD → Open-Meteo → OpenWeatherMap",
    "warnings_source": "IMD → SACHET/CAP → InTouch → WeatherAPI → GDACS",
    "available": {"demo": True, "imd": True, "hybrid": True},
}


@pytest.fixture(autouse=True)
def _isolate_runtime(monkeypatch, tmp_path):
    """Never read/write the developer's real cache, and always restore the
    global mode after a test that mutates it through POST /api/mode."""
    cache_file = str(tmp_path / "weathergpt_cache.json")
    monkeypatch.setattr(config, "CACHE_FILE", cache_file)
    monkeypatch.setattr(weather_mod, "cache", CacheService(cache_file))
    monkeypatch.setattr(config, "SOURCE_MODE", config.SOURCE_MODE)
    monkeypatch.setattr(config, "DEMO_MODE", config.DEMO_MODE)
    monkeypatch.setattr(config, "IMD_ADAPTER", config.IMD_ADAPTER)


def _set_mode(monkeypatch, mode: str) -> None:
    monkeypatch.setattr(config, "SOURCE_MODE", mode)
    monkeypatch.setattr(config, "DEMO_MODE", mode == "demo")


def _obs(source: str = "IMD", temperature: float = 30.0) -> WeatherObservation:
    return WeatherObservation(source=source, temperature=temperature, humidity=50.0,
                              rainfall=0.0, wind_speed=5.0, condition="Clear",
                              observed_at=now_ist())


def _fc(source: str = "IMD") -> WeatherForecast:
    return WeatherForecast(source=source, location="Hyderabad", issued_at=now_ist(), days=[])


def _imd_down(monkeypatch) -> None:
    async def boom(self, *args, **kwargs):
        raise AdapterUnavailable("IMD live unreachable")

    monkeypatch.setattr(IMDService, "get_current_weather", boom)
    monkeypatch.setattr(IMDService, "get_forecast", boom)


def _imd_ok(monkeypatch) -> None:
    async def cur(self, lat, lon):
        return _obs("IMD")

    async def fc(self, lat, lon):
        return _fc("IMD")

    monkeypatch.setattr(IMDService, "get_current_weather", cur)
    monkeypatch.setattr(IMDService, "get_forecast", fc)


def _openmeteo_ok(monkeypatch, calls: list) -> None:
    async def cur(lat, lon):
        calls.append("current")
        return _obs("Open-Meteo"), "LIVE"

    async def fc(lat, lon):
        calls.append("forecast")
        return _fc("Open-Meteo"), "LIVE"

    monkeypatch.setattr(openmeteo_adapter, "get_current", cur)
    monkeypatch.setattr(openmeteo_adapter, "get_forecast", fc)


def _no_network_fallbacks(monkeypatch) -> None:
    """Make every non-IMD source fail loudly if reached."""
    async def owm(self, *a, **k):
        raise AdapterUnavailable("OWM not configured")

    monkeypatch.setattr(owm_adapter, "get_current", owm)


# --------------------------------------------------------------- GET /api/mode

def test_get_mode_hybrid_matches_contract(monkeypatch):
    _set_mode(monkeypatch, "hybrid")
    r = TestClient(app).get("/api/mode")
    assert r.status_code == 200, r.text
    assert r.json() == HYBRID_BODY


def test_get_mode_demo_and_imd(monkeypatch):
    _set_mode(monkeypatch, "demo")
    demo = TestClient(app).get("/api/mode").json()
    assert demo["mode"] == "demo" and demo["source_mode"] == "demo"
    assert demo["demo_mode"] is True
    assert demo["weather_source"] == "DEMO fixtures"

    _set_mode(monkeypatch, "imd")
    imd = TestClient(app).get("/api/mode").json()
    assert imd["mode"] == "imd" and imd["source_mode"] == "imd"
    assert imd["demo_mode"] is False
    assert imd["weather_source"] == "IMD only"
    assert imd["warnings_source"] == "IMD → SACHET/CAP"


# -------------------------------------------------------------- POST /api/mode

@pytest.mark.parametrize("mode", ["demo", "imd", "hybrid"])
def test_post_mode_accepts_three_modes(monkeypatch, mode):
    _set_mode(monkeypatch, "hybrid")
    r = TestClient(app).post("/api/mode", json={"mode": mode})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["mode"] == mode and body["source_mode"] == mode
    assert body["demo_mode"] is (mode == "demo")
    # The plain boolean and the adapter stay in sync with the mode.
    assert config.DEMO_MODE is (mode == "demo")
    assert config.IMD_ADAPTER == ("demo" if mode == "demo" else "live")


def test_post_mode_legacy_live_alias_is_hybrid(monkeypatch):
    _set_mode(monkeypatch, "demo")
    body = TestClient(app).post("/api/mode", json={"mode": "live"}).json()
    assert body["ok"] is True
    assert body["mode"] == "hybrid" and body["source_mode"] == "hybrid"
    assert body["demo_mode"] is False
    assert config.SOURCE_MODE == "hybrid" and config.DEMO_MODE is False


@pytest.mark.parametrize("payload", [{"mode": "bogus"}, {"mode": "LIVE "}, {}, {"mode": None}])
def test_post_mode_rejects_invalid(monkeypatch, payload):
    _set_mode(monkeypatch, "hybrid")
    r = TestClient(app).post("/api/mode", json=payload)
    assert r.status_code == 200, r.text          # the UI reads `ok`, not the status
    body = r.json()
    assert body["ok"] is False
    assert "error" in body
    assert config.SOURCE_MODE == "hybrid"        # a rejected switch changes nothing


def test_health_reports_source_mode(monkeypatch):
    _set_mode(monkeypatch, "imd")
    body = TestClient(app).get("/api/health").json()
    assert body["source_mode"] == "imd"
    assert body["demo_mode"] is False
    assert "imd_adapter" in body                 # existing keys are not removed


# ------------------------------------------- weather-source selection per mode

async def test_imd_mode_imd_reachable_uses_imd(monkeypatch):
    _set_mode(monkeypatch, "imd")
    _imd_ok(monkeypatch)
    calls: list = []
    _openmeteo_ok(monkeypatch, calls)
    data, prov = await weather_mod._live_current(17.385, 78.4867)
    assert data["source"] == "IMD" and prov == "LIVE"
    assert calls == []                            # official source answered


async def test_hybrid_mode_falls_back_to_openmeteo(monkeypatch):
    _set_mode(monkeypatch, "hybrid")
    _imd_down(monkeypatch)
    calls: list = []
    _openmeteo_ok(monkeypatch, calls)
    data, prov = await weather_mod._live_current(17.385, 78.4867)
    assert data["source"] == "Open-Meteo" and prov == "LIVE"
    assert calls == ["current"]


async def test_hybrid_forecast_falls_back_to_openmeteo(monkeypatch):
    _set_mode(monkeypatch, "hybrid")
    _imd_down(monkeypatch)
    calls: list = []
    _openmeteo_ok(monkeypatch, calls)
    data, prov = await weather_mod._live_forecast(17.385, 78.4867)
    assert data["source"] == "Open-Meteo" and prov == "LIVE"
    assert calls == ["forecast"]


# --------------------------------------------- imd mode: the no-fallback rule

async def test_imd_mode_current_never_backfills(monkeypatch):
    """IMD down in imd mode -> AdapterUnavailable; Open-Meteo must not be called."""
    _set_mode(monkeypatch, "imd")
    _imd_down(monkeypatch)
    calls: list = []
    _openmeteo_ok(monkeypatch, calls)
    _no_network_fallbacks(monkeypatch)
    with pytest.raises(AdapterUnavailable):
        await weather_mod._live_current(17.385, 78.4867)
    assert calls == []


async def test_imd_mode_forecast_never_backfills(monkeypatch):
    _set_mode(monkeypatch, "imd")
    _imd_down(monkeypatch)
    calls: list = []
    _openmeteo_ok(monkeypatch, calls)
    with pytest.raises(AdapterUnavailable):
        await weather_mod._live_forecast(17.385, 78.4867)
    assert calls == []


async def test_imd_mode_does_not_serve_cache(monkeypatch):
    """A cached non-official value is not an IMD answer — it must not be served."""
    _set_mode(monkeypatch, "imd")
    _imd_down(monkeypatch)
    weather_mod.cache.set(weather_mod._key("current", 17.385, 78.4867),
                          {"source": "Open-Meteo", "temperature": 99.0},
                          weather_mod.TTLS["current"])
    with pytest.raises(AdapterUnavailable):
        await weather_mod._live_current(17.385, 78.4867)


def test_imd_mode_endpoint_reports_unavailable_not_backfilled(monkeypatch):
    """Endpoint-level: /api/weather/current in imd mode must say UNAVAILABLE,
    never return an Open-Meteo number as the answer."""
    _set_mode(monkeypatch, "imd")
    _imd_down(monkeypatch)
    calls: list = []
    _openmeteo_ok(monkeypatch, calls)
    _no_network_fallbacks(monkeypatch)
    r = TestClient(app).get("/api/weather/current", params={"lat": 17.385, "lon": 78.4867})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "unavailable"
    assert body["provenance"] == "UNAVAILABLE"
    assert "current" not in body                  # no backfilled observation
    assert calls == []


def test_hybrid_mode_endpoint_uses_openmeteo(monkeypatch):
    """Contrast case: the same IMD outage in hybrid mode does fall back."""
    _set_mode(monkeypatch, "hybrid")
    _imd_down(monkeypatch)
    calls: list = []
    _openmeteo_ok(monkeypatch, calls)
    _no_network_fallbacks(monkeypatch)
    body = TestClient(app).get("/api/weather/current",
                               params={"lat": 17.385, "lon": 78.4867}).json()
    assert body.get("status") != "unavailable"
    assert body["current"]["source"] == "Open-Meteo"
    assert calls == ["current"]


# ------------------------------------- imd mode: warnings stay IMD + SACHET/CAP

def test_imd_mode_skips_commercial_alert_chain(monkeypatch):
    """imd warnings = IMD + SACHET/CAP. InTouch/WeatherAPI/GDACS is skipped."""
    _set_mode(monkeypatch, "imd")

    async def imd_down(self, district):
        raise AdapterUnavailable("IMD live unreachable")

    monkeypatch.setattr(IMDService, "get_district_warning", imd_down)

    async def no_caps():
        return [], "UNAVAILABLE"

    monkeypatch.setattr(cap_adapter, "fetch_alerts", no_caps)

    chain_calls: list = []

    async def chain(*a, **k):
        chain_calls.append("called")
        return [], "UNAVAILABLE"

    monkeypatch.setattr(alert_sources, "get_alerts", chain)

    body = TestClient(app).get("/api/weather/warnings",
                               params={"district": "Hyderabad"}).json()
    assert chain_calls == []                       # official-only mode
    assert body["status"] == "unavailable"
    assert body["verdict"]["level"] == "UNKNOWN"   # unreachable is never a calm


# --------------------------------------------------------------------------
# A missing credential is not an outage.
#
# Without IMD_API_KEY the IMD platform answers 401/400 however healthy the
# network is. The runtime failure handler reported OFFLINE, which told the
# sources panel "IMD is down" — and because runtime reports take precedence, it
# also overwrote the registry's own correct UNCONFIGURED baseline. The two need
# different fixes: one is "wait for IMD", the other is "add a key".
# --------------------------------------------------------------------------
def test_imd_without_a_key_reports_unconfigured_not_offline(monkeypatch):
    import backend.services.imd_service as imd_service
    from backend.adapters import registry

    monkeypatch.setattr(config, "IMD_API_KEY", "")

    class Boom:
        async def get(self, *a, **k):
            raise RuntimeError("400 Bad Request")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(imd_service.httpx, "AsyncClient", lambda **k: Boom())

    import asyncio
    with pytest.raises(AdapterUnavailable):
        asyncio.run(imd_service.IMDService(adapter="live").get_district_warning("Hyderabad"))

    imd = next(s for s in registry.snapshot() if s["name"] == "imd")
    assert imd["status"] == "UNCONFIGURED", imd
    assert "IMD_API_KEY" in imd["detail"], imd
    assert imd["status"] != "OFFLINE", imd


def test_imd_with_a_key_still_reports_a_real_outage(monkeypatch):
    """The honesty must not swallow genuine outages: with a key present, a
    failure IS an outage and must still read OFFLINE."""
    import backend.services.imd_service as imd_service
    from backend.adapters import registry

    monkeypatch.setattr(config, "IMD_API_KEY", "test-key")

    class Boom:
        async def get(self, *a, **k):
            raise RuntimeError("connection reset")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(imd_service.httpx, "AsyncClient", lambda **k: Boom())

    import asyncio
    with pytest.raises(AdapterUnavailable):
        asyncio.run(imd_service.IMDService(adapter="live").get_district_warning("Hyderabad"))

    imd = next(s for s in registry.snapshot() if s["name"] == "imd")
    assert imd["status"] == "OFFLINE", imd
