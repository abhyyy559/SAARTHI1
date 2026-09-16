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
