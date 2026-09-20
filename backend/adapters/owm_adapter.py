"""OpenWeatherMap cross-check adapter — the 'second opinion' for the disagree panel.

Needs OWM_API_KEY. Unconfigured -> UNCONFIGURED (panel honestly hidden).
Only current-weather is used; IMD/Open-Meteo remain the authority.
"""
from __future__ import annotations

import httpx

from .. import config
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
