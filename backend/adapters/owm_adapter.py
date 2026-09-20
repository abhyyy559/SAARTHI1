"""OpenWeatherMap cross-check adapter — the 'second opinion' for the disagree panel.

Needs OWM_API_KEY. Unconfigured -> UNCONFIGURED (panel honestly hidden).
Current-weather feeds the disagree panel; the 5-day/3-hour forecast feeds the
forecast fallback chain (IMD -> Open-Meteo -> OpenWeatherMap -> cache).
IMD/Open-Meteo remain the authority.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from collections import defaultdict

import httpx

from .. import config
from ..models.weather import ForecastDay, WeatherForecast
from ..utils.time import IST
from .registry import ERROR, LIVE, UNCONFIGURED, AdapterUnavailable, report

SOURCE = "OpenWeatherMap"


async def get_current(latitude: float, longitude: float) -> tuple[dict, str]:
    key = config.OWM_API_KEY
    if not key:
        report("owm", UNCONFIGURED, "OWM_API_KEY not set")
        raise AdapterUnavailable("OpenWeatherMap unconfigured (needs API key)")
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={"lat": latitude, "lon": longitude, "appid": key, "units": "metric"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        report("owm", ERROR, f"fetch failed: {type(exc).__name__}")
        raise AdapterUnavailable(f"OpenWeatherMap unreachable: {exc}") from exc
    main = data.get("main") or {}
    cond = (data.get("weather") or [{}])[0].get("description", "")
    out = {
        "source": SOURCE,
        "temperature": main.get("temp"),
        "humidity": main.get("humidity"),
        "condition": cond.title() if cond else None,
    }
    report("owm", LIVE, f"cross-check {out['temperature']}C {out['condition']}")
    return out, LIVE


async def get_forecast(latitude: float, longitude: float) -> tuple[WeatherForecast, str]:
    """Daily forecast from OWM's free 5-day/3-hour endpoint.

    Aggregates the 3-hour entries into calendar days in the station's local
    time: min/max temperature, summed 3h rainfall, and the description from
    the day's warmest entry (deterministic, never invented). Returns
    (WeatherForecast, "LIVE"); unconfigured or unreachable raises
    AdapterUnavailable so the chain can keep moving.
    """
    key = config.OWM_API_KEY
    if not key:
        report("owm", UNCONFIGURED, "OWM_API_KEY not set")
        raise AdapterUnavailable("OpenWeatherMap unconfigured (needs API key)")
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                "https://api.openweathermap.org/data/2.5/forecast",
                params={"lat": latitude, "lon": longitude, "appid": key, "units": "metric"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        report("owm", ERROR, f"forecast fetch failed: {type(exc).__name__}")
        raise AdapterUnavailable(f"OpenWeatherMap forecast unreachable: {exc}") from exc
    tz_offset = int((data.get("city") or {}).get("timezone") or 0)

    per_day: dict[str, list[dict]] = defaultdict(list)
    for entry in data.get("list") or []:
        ts = entry.get("dt")
        if ts is None:
            continue
        local = datetime.fromtimestamp(ts, tz=timezone.utc)
        local = local.replace(tzinfo=None)  # naive arithmetic below
        local = local + timedelta(seconds=tz_offset)
        per_day[local.date().isoformat()].append(entry)

    days: list[ForecastDay] = []
    for date in sorted(per_day):
        entries = per_day[date]
        temps = [e.get("main", {}).get("temp") for e in entries]
        temps = [t for t in temps if isinstance(t, (int, float))]
        rainfall = sum(
            (e.get("rain") or {}).get("3h") or 0.0 for e in entries
            if isinstance((e.get("rain") or {}).get("3h"), (int, float))
        )
        peak = max(entries, key=lambda e: e.get("main", {}).get("temp") or float("-inf"))
        cond = ((peak.get("weather") or [{}])[0] or {}).get("description", "")
        days.append(ForecastDay(
            date=date,
            condition=cond.title() if cond else None,
            min_temperature=min(temps) if temps else None,
            max_temperature=max(temps) if temps else None,
            rainfall=rainfall,
        ))
    fc = WeatherForecast(source=SOURCE, location=None, issued_at=datetime.now(IST), days=days)
    report("owm", LIVE, f"forecast {len(days)} days")
    return fc, LIVE
