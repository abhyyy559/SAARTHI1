"""Open-Meteo live adapter — free, no key. Primary live backbone for obs + forecast.

Docs pattern: https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=..&daily=..
"""
from __future__ import annotations

from datetime import datetime

import httpx

from ..models.weather import ForecastDay, WeatherForecast, WeatherObservation
from ..utils.time import IST
from .registry import LIVE, OFFLINE, AdapterUnavailable, report

BASE = "https://api.open-meteo.com/v1/forecast"
SOURCE = "Open-Meteo"

WMO_CODE_MAP = {
    0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Overcast",
    45: "Foggy", 48: "Foggy", 51: "Light Drizzle", 53: "Drizzle", 55: "Drizzle",
    56: "Freezing Drizzle", 57: "Freezing Drizzle", 61: "Light Rain", 63: "Rain",
    65: "Heavy Rain", 66: "Freezing Rain", 67: "Freezing Rain", 71: "Light Snow",
    73: "Snow", 75: "Heavy Snow", 77: "Snow Grains", 80: "Light Showers",
    81: "Showers", 82: "Heavy Showers", 85: "Snow Showers", 86: "Snow Showers",
    95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
}


def _condition(code: int | None) -> str:
    return WMO_CODE_MAP.get(int(code) if code is not None else -1, "Unknown")


async def _fetch(params: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(BASE, params=params)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:  # network down, DNS, 5xx — never invent numbers
        report("open-meteo", OFFLINE, f"fetch failed: {type(exc).__name__}")
        raise AdapterUnavailable(f"open-meteo unreachable: {exc}") from exc


async def get_current(latitude: float, longitude: float) -> tuple[WeatherObservation, str]:
    data = await _fetch({
        "latitude": latitude, "longitude": longitude,
        "current": "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
        "timezone": "Asia/Kolkata",
    })
    cur = data.get("current") or {}
    try:
        observed = datetime.fromisoformat(cur.get("time")) if cur.get("time") else datetime.now(IST)
    except ValueError:
        observed = datetime.now(IST)
    if observed.tzinfo is None:
        observed = observed.replace(tzinfo=IST)
    obs = WeatherObservation(
        source=SOURCE,
        temperature=cur.get("temperature_2m"),
        humidity=cur.get("relative_humidity_2m"),
        rainfall=cur.get("precipitation"),
        wind_speed=cur.get("wind_speed_10m"),
        condition=_condition(cur.get("weather_code")),
        observed_at=observed,
    )
    report("open-meteo", LIVE, f"current {obs.temperature}C {obs.condition} @ {observed.isoformat()}")
    return obs, LIVE


async def get_forecast(latitude: float, longitude: float) -> tuple[WeatherForecast, str]:
    data = await _fetch({
        "latitude": latitude, "longitude": longitude,
        "daily": "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum",
        "timezone": "Asia/Kolkata", "forecast_days": 7,
    })
    daily = data.get("daily") or {}
    dates = daily.get("time") or []
    days: list[ForecastDay] = []
    for i, d in enumerate(dates):
        def _at(key: str):
            vals = daily.get(key) or []
            return vals[i] if i < len(vals) else None
        days.append(ForecastDay(
            date=d, condition=_condition(_at("weathercode")),
            min_temperature=_at("temperature_2m_min"),
            max_temperature=_at("temperature_2m_max"),
            rainfall=_at("precipitation_sum"),
        ))
    fc = WeatherForecast(source=SOURCE, location=None, issued_at=datetime.now(IST), days=days)
    report("open-meteo", LIVE, f"forecast {len(days)} days")
    return fc, LIVE


async def get_nowcast(latitude: float, longitude: float) -> tuple[dict, str]:
    """Real short-term input: observed current + next-3h precipitation probability."""
    data = await _fetch({
        "latitude": latitude, "longitude": longitude,
        "current": "temperature_2m,precipitation,weather_code",
        "hourly": "precipitation_probability",
        "forecast_days": 1, "timezone": "Asia/Kolkata",
    })
    cur = data.get("current") or {}
    probs = (data.get("hourly") or {}).get("precipitation_probability") or []
    now = {
        "source": SOURCE,
        "condition": _condition(cur.get("weather_code")),
        "precipitation_mm": cur.get("precipitation"),
        "next_3h_precip_probability_max": max([p for p in probs[:3] if p is not None], default=None),
        "statement": "Observed conditions plus next-3-hour precipitation probability (not a warning).",
    }
    report("open-meteo", LIVE, "nowcast inputs fetched")
    return now, LIVE


# Aviation briefing inputs. Pressure-level variables are only available on
# specific models, so this pins models=gfs_seamless — the same GFS the NWP
# comparison path uses. Wind speeds come in knots (aviation standard). Raises
# AdapterUnavailable via _fetch on any failure: a dead feed is a state to
# report, never numbers to invent.
AVIATION_LEVELS = (1000, 850, 700, 500)


async def get_aviation_inputs(latitude: float, longitude: float) -> tuple[dict, str]:
    """GFS pressure-level winds + temperature/humidity aloft, cloud layers,
    visibility, and sunrise/sunset — the raw material for an aviation briefing.

    Cloud cover and visibility are OBSERVED/FORECAST PROXIES: Open-Meteo gives
    no measured ceiling or RVR. Turbulence and icing are derived proxies at
    best (see aviation_service). The payload carries those caveats in
    `proxy_notes` so any consumer can render them honestly."""
    levels = ",".join(
        f"wind_speed_{p}hPa,wind_direction_{p}hPa,temperature_{p}hPa,"
        f"relative_humidity_{p}hPa"
        for p in AVIATION_LEVELS
    )
    data = await _fetch({
        "latitude": latitude, "longitude": longitude,
        "hourly": f"{levels},visibility,cloud_cover_low,cloud_cover_mid,cloud_cover_high",
        "daily": "sunrise,sunset",
        "models": "gfs_seamless",
        "wind_speed_unit": "kn",
        "forecast_days": 2,
        "timezone": "Asia/Kolkata",
    })
    report("open-meteo", LIVE, "aviation inputs (GFS pressure levels) fetched")
    hourly = data.get("hourly") or {}
    daily = data.get("daily") or {}

    def _col(key: str, idx: int):
        vals = hourly.get(key) or []
        return vals[idx] if 0 <= idx < len(vals) else None

    def _level(p: int, idx: int) -> dict:
        return {
            "level_hpa": p,
            "wind_speed_kt": _col(f"wind_speed_{p}hPa", idx),
            "wind_direction_deg": _col(f"wind_direction_{p}hPa", idx),
            "temperature_c": _col(f"temperature_{p}hPa", idx),
            "relative_humidity_pct": _col(f"relative_humidity_{p}hPa", idx),
        }

    return {
        "source": SOURCE,
        "model": "GFS (gfs_seamless)",
        "times_utc8_ist": (hourly.get("time") or [])[:13],
        "levels_now": [_level(p, 0) for p in AVIATION_LEVELS],
        "levels_plus6h": [_level(p, 6) for p in AVIATION_LEVELS],
        "visibility_m": _col("visibility", 0),
        "cloud_cover_low_pct": _col("cloud_cover_low", 0),
        "cloud_cover_mid_pct": _col("cloud_cover_mid", 0),
        "cloud_cover_high_pct": _col("cloud_cover_high", 0),
        "sunrise": (daily.get("sunrise") or [None])[0],
        "sunset": (daily.get("sunset") or [None])[0],
        "proxy_notes": [
            "Cloud-cover percentages are a proxy for ceiling, not a measured ceiling.",
            "Visibility is a forecast value, not a measured RVR.",
            "GFS model output is not an IMD aviation bulletin.",
        ],
    }, LIVE
