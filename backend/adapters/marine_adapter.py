"""Sea state for fishermen: wave height (Open-Meteo Marine) and wind gusts
(Open-Meteo forecast). Model values, labelled as such: this is context, not an
INCOIS or IMD sea-state warning, and it never raises a warning level.

The marine API snaps a coastal coordinate to the nearest sea cell, so a
district centre a few km inland still gets its own stretch of sea.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from .registry import AdapterUnavailable
from ..utils.http import TLS

MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
SOURCE = "Open-Meteo Marine"
NOTE = "Model values. Not an INCOIS or IMD sea-state warning."

_TTL_S = 1800.0
_cache: dict[tuple[float, float], tuple[float, dict]] = {}


def _r(v: Any, nd: int = 1) -> float | None:
    try:
        return round(float(v), nd)
    except (TypeError, ValueError):
        return None


async def sea_state(lat: float, lon: float, days: int = 3) -> dict:
    key = (round(lat, 2), round(lon, 2))
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < _TTL_S:
        return hit[1]
    common = {"latitude": lat, "longitude": lon, "timezone": "Asia/Kolkata", "forecast_days": days}
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=TLS) as client:
            marine, wind = await asyncio.gather(
                client.get(MARINE_URL, params={**common, "current": "wave_height",
                                               "daily": "wave_height_max,swell_wave_height_max"}),
                client.get(FORECAST_URL, params={**common, "daily": "wind_speed_10m_max,wind_gusts_10m_max"}),
            )
        marine.raise_for_status()
        wind.raise_for_status()
        m, w = marine.json(), wind.json()
    except Exception as exc:  # noqa: BLE001 - any failure is "unavailable", never a calm sea
        raise AdapterUnavailable(f"sea state unavailable: {type(exc).__name__}") from exc
    md, wd = m.get("daily") or {}, w.get("daily") or {}
    dates = md.get("time") or []
    if not dates or all(v is None for v in md.get("wave_height_max") or []):
        raise AdapterUnavailable("no sea cell near this place")
    out = {
        "source": SOURCE,
        "note": NOTE,
        "current_wave_height_m": _r((m.get("current") or {}).get("wave_height")),
        "days": [
            {
                "date": d,
                "wave_height_max_m": _r((md.get("wave_height_max") or [None] * len(dates))[i]),
                "swell_max_m": _r((md.get("swell_wave_height_max") or [None] * len(dates))[i]),
                "wind_max_kmh": _r((wd.get("wind_speed_10m_max") or [None] * len(dates))[i], 0),
                "gust_max_kmh": _r((wd.get("wind_gusts_10m_max") or [None] * len(dates))[i], 0),
            }
            for i, d in enumerate(dates)
        ],
    }
    _cache[key] = (time.monotonic(), out)
    return out
