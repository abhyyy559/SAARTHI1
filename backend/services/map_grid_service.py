"""Weather grid for the Alerts-page map: temperature, rain and wind every 2°.

One request to the map returns a coarse grid over India and its seas (Open-Meteo,
free, no key), for "now" and the next three days. The phone blends the grid
into a smooth field and adds the official alerts on top.

Open-Meteo counts every grid point as a call, so the grid is fetched at most
once an hour (19 x 19 points, about 9,000 calls a day at worst, inside the free
tier) and the last good grid is kept for when the source is down.

If there has never been a live grid (no internet, first start), a sample field
is returned and marked `sample: true`; the phone labels it "Sample weather".
Numbers are never passed off as live when they are not.
"""
from __future__ import annotations

import asyncio
import math
import time
from datetime import date, datetime, timedelta

import httpx

from ..utils.time import IST

BASE = "https://api.open-meteo.com/v1/forecast"
LAT0, LAT1 = 4.0, 40.0
LON0, LON1 = 64.0, 100.0
STEP = 2.0
DAYS = 4
CHUNK = 100
TTL_SECONDS = 3600

CURRENT = "temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m"
DAILY = "temperature_2m_max,precipitation_sum,wind_gusts_10m_max,wind_speed_10m_max,wind_direction_10m_dominant"

RETRY_SECONDS = 300

_last_good: dict | None = None
_last_at = 0.0
_failed_at = -1e9
_lock = asyncio.Lock()


def grid_points() -> tuple[list[float], list[float]]:
    """Row-major points: rows run north to south, columns west to east."""
    rows = int(round((LAT1 - LAT0) / STEP)) + 1
    cols = int(round((LON1 - LON0) / STEP)) + 1
    lats = [LAT1 - r * STEP for r in range(rows)]
    lons = [LON0 + c * STEP for c in range(cols)]
    return lats, lons


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _r(v: float | None, nd: int = 1) -> float | None:
    return None if v is None else round(v, nd)


def _day(daily: dict, key: str, i: int):
    vals = daily.get(key) or []
    return vals[i] if i < len(vals) else None


def build_frames(points: list[dict]) -> list[dict]:
    """Open-Meteo per-point answers → frames of row-major arrays."""
    n = len(points)
    first_daily = (points[0].get("daily") or {}) if n else {}
    days = list(first_daily.get("time") or [])[:DAYS]
    now = {"id": "now", "time": None, "temp": [], "rain": [], "gust": [], "wind": [], "dir": []}
    daily = [{"id": d, "time": d, "temp": [], "rain": [], "gust": [], "wind": [], "dir": []} for d in days]
    for p in points:
        cur = p.get("current") or {}
        dly = p.get("daily") or {}
        now["time"] = now["time"] or cur.get("time")
        today_rain = (dly.get("precipitation_sum") or [None])[0]
        now["temp"].append(_r(_num(cur.get("temperature_2m"))))
        # Rain danger is judged on the day's total (IMD's 24-hour limits).
        now["rain"].append(_r(_num(today_rain)))
        now["gust"].append(_r(_num(cur.get("wind_gusts_10m")), 0))
        now["wind"].append(_r(_num(cur.get("wind_speed_10m")), 0))
        now["dir"].append(_r(_num(cur.get("wind_direction_10m")), 0))
        for i, f in enumerate(daily):
            f["temp"].append(_r(_num(_day(dly, "temperature_2m_max", i))))
            f["rain"].append(_r(_num(_day(dly, "precipitation_sum", i))))
            f["gust"].append(_r(_num(_day(dly, "wind_gusts_10m_max", i)), 0))
            f["wind"].append(_r(_num(_day(dly, "wind_speed_10m_max", i)), 0))
            f["dir"].append(_r(_num(_day(dly, "wind_direction_10m_dominant", i)), 0))
    return [now] + daily


def _envelope(frames: list[dict], *, source: str, sample: bool, fetched_at: str) -> dict:
    lats, lons = grid_points()
    return {
        "lat0": lats[0], "lon0": lons[0], "step": STEP, "rows": len(lats), "cols": len(lons),
        "frames": frames, "source": source, "sample": sample, "fetched_at": fetched_at,
    }


async def _fetch_live() -> dict:
    lats, lons = grid_points()
    pts = [(la, lo) for la in lats for lo in lons]
    out: list[dict] = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        for i in range(0, len(pts), CHUNK):
            part = pts[i:i + CHUNK]
            resp = await client.get(BASE, params={
                "latitude": ",".join(f"{a:g}" for a, _ in part),
                "longitude": ",".join(f"{b:g}" for _, b in part),
                "current": CURRENT, "daily": DAILY, "forecast_days": DAYS, "timezone": "Asia/Kolkata",
            })
            resp.raise_for_status()
            data = resp.json()
            data = data if isinstance(data, list) else [data]
            if len(data) != len(part):
                raise ValueError(f"open-meteo returned {len(data)} of {len(part)} points")
            out.extend(data)
    return _envelope(build_frames(out), source="Open-Meteo", sample=False,
                     fetched_at=datetime.now(IST).isoformat(timespec="minutes"))


def sample_grid(today: date | None = None) -> dict:
    """A plausible October field, used only when no live grid was ever fetched.

    Warm plains, cooler hills in the north, a rain band over the Bay of
    Bengal moving towards the Andhra coast. Marked sample; never shown as live.
    """
    today = today or datetime.now(IST).date()
    lats, lons = grid_points()
    frames = []
    for i, fid in enumerate(["now"] + [(today + timedelta(days=d)).isoformat() for d in range(DAYS)]):
        shift = max(0, i - 1) * 1.2
        f = {"id": fid, "time": None if fid == "now" else fid, "temp": [], "rain": [], "gust": [], "wind": [], "dir": []}
        for la in lats:
            for lo in lons:
                hills = max(0.0, la - 30.5) * 2.6 * (1 if 73 < lo < 96 else 0.4)
                temp = 33.5 - 0.22 * abs(la - 22) - hills + (1.5 if 69 < lo < 76 and 23 < la < 29 else 0)
                d2 = ((la - (15.5 + shift * 0.6)) / 3.0) ** 2 + ((lo - (86.5 - shift)) / 3.5) ** 2
                storm = math.exp(-d2)
                rain = 140 * storm + 6 * math.exp(-((la - 10) / 3) ** 2 - ((lo - 76) / 2) ** 2)
                gust = 22 + 70 * storm
                ang = math.degrees(math.atan2(lo - (86.5 - shift), la - (15.5 + shift * 0.6)))
                f["temp"].append(round(temp - 3 * storm, 1))
                f["rain"].append(round(rain, 1))
                f["gust"].append(round(gust))
                f["wind"].append(round(gust * 0.6))
                f["dir"].append(round((ang + 90) % 360))
        frames.append(f)
    return _envelope(frames, source="Sample", sample=True, fetched_at="")


async def get_grid() -> dict:
    """The live grid (at most an hour old), else the last good one, else a sample."""
    global _last_good, _last_at, _failed_at
    async with _lock:
        now = time.monotonic()
        if _last_good is not None and now - _last_at < TTL_SECONDS:
            return _last_good
        # After a failure, wait before asking again: offline, every map open
        # would otherwise sit through the full timeout.
        if now - _failed_at >= RETRY_SECONDS:
            try:
                grid = await _fetch_live()
                _last_good, _last_at = grid, time.monotonic()
                return grid
            except Exception:  # network down, quota, bad reply: keep what we had
                _failed_at = time.monotonic()
        if _last_good is not None:
            return {**_last_good, "stale": True}
        return sample_grid()
