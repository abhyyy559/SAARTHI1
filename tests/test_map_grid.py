"""Weather grid for the Alerts-page map: shape, honesty, and fallbacks."""
import asyncio

from fastapi.testclient import TestClient

from backend.main import app
from backend.services import map_grid_service as mg

client = TestClient(app)


def _reset():
    mg._last_good, mg._last_at, mg._failed_at = None, 0.0, -1e9


def _point(temp, rain, gust):
    return {
        "current": {"time": "2026-10-10T10:45", "temperature_2m": temp, "precipitation": 0,
                    "wind_speed_10m": 10, "wind_gusts_10m": gust, "wind_direction_10m": 90},
        "daily": {"time": ["2026-10-10", "2026-10-11"], "temperature_2m_max": [temp + 2, temp + 1],
                  "precipitation_sum": [rain, 0], "wind_gusts_10m_max": [gust + 5, gust],
                  "wind_speed_10m_max": [12, 11], "wind_direction_10m_dominant": [80, 70]},
    }


def test_grid_covers_india_north_to_south():
    lats, lons = mg.grid_points()
    assert lats[0] > lats[-1], "rows run north to south"
    assert lats[0] >= 37 and lats[-1] <= 7 and lons[0] <= 68 and lons[-1] >= 97
    assert len(lats) * len(lons) <= 400, "stay inside Open-Meteo's free tier at one fetch an hour"


def test_frames_carry_now_and_each_day():
    frames = mg.build_frames([_point(31, 70, 40), _point(42, None, 90)])
    assert [f["id"] for f in frames] == ["now", "2026-10-10", "2026-10-11"]
    now = frames[0]
    assert now["temp"] == [31, 42] and now["gust"] == [40, 90]
    assert now["rain"] == [70, None], "rain is the day's total; a missing number stays missing"
    assert frames[1]["temp"] == [33, 44]


def test_live_grid_is_used_and_kept(monkeypatch):
    _reset()
    calls = []

    async def fake():
        calls.append(1)
        return mg._envelope(mg.build_frames([_point(30, 0, 20)]), source="Open-Meteo", sample=False, fetched_at="x")

    monkeypatch.setattr(mg, "_fetch_live", fake)
    a = client.get("/api/map/grid").json()
    b = client.get("/api/map/grid").json()
    assert a["sample"] is False and a["source"] == "Open-Meteo"
    assert a == b and len(calls) == 1, "fetched at most once an hour"
    _reset()


def test_offline_first_start_gets_a_marked_sample(monkeypatch):
    _reset()

    async def down():
        raise OSError("no network")

    monkeypatch.setattr(mg, "_fetch_live", down)
    g = client.get("/api/map/grid").json()
    assert g["sample"] is True and g["source"] == "Sample"
    assert len(g["frames"][0]["temp"]) == g["rows"] * g["cols"]
    _reset()


def test_outage_keeps_the_last_live_grid_marked_stale(monkeypatch):
    _reset()
    mg._last_good = mg._envelope(mg.build_frames([_point(30, 0, 20)]), source="Open-Meteo", sample=False, fetched_at="x")
    mg._last_at = -1e9  # expired

    async def down():
        raise OSError("no network")

    monkeypatch.setattr(mg, "_fetch_live", down)
    g = asyncio.run(mg.get_grid())
    assert g["sample"] is False and g.get("stale") is True
    _reset()
