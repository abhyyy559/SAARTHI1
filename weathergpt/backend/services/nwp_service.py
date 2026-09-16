"""NWP multi-model service — GFS/ECMWF(/GEM/ICON) comparison via Open-Meteo model selector.

WRF is a documented architecture input (IMD/NCMRWF regional product). No public
keyless WRF feed is wired, so WRF reports UNCONFIGURED — documented, never faked.
Model disagreement is presented as forecast confidence context, NEVER as a warning.
"""
from __future__ import annotations

import httpx

from .. import config
from ..adapters.registry import ERROR, LIVE, UNCONFIGURED, AdapterUnavailable, report

SOURCE = "NWP/multi-model"

# Open-Meteo model keys. WRF has no keyless feed -> None (planned input).
MODELS: dict[str, str | None] = {
    "GFS": "gfs_seamless",
    "ECMWF-IFS": "ecmwf_ifs",
    "GEM": "gem_global",
    "ICON": "icon_seamless",
    "WRF": None,
}

BASE = "https://api.open-meteo.com/v1/forecast"


def model_status() -> list[dict]:
    out = []
    for name, key in MODELS.items():
        if key is None:
            st = "UNCONFIGURED"
            detail = "WRF regional feed needs NCMRWF product access (planned input)"
            report("nwp-wrf", UNCONFIGURED, detail)
        else:
            cur = get_live_status(name)
            st, detail = cur
        out.append({"model": name, "status": st, "detail": detail})
    return out


def get_live_status(name: str) -> tuple[str, str]:
    from ..adapters.registry import get_status
    s = get_status("nwp")
    return (s.status, s.detail)


async def compare_models(latitude: float, longitude: float) -> tuple[dict, str]:
    """Per-model day-1 max-temp + precipitation + agreement label. Raises on failure."""
    live = {name: key for name, key in MODELS.items() if key}
    params = {
        "latitude": latitude, "longitude": longitude,
        "daily": "temperature_2m_max,precipitation_sum",
        "forecast_days": 2, "timezone": "Asia/Kolkata",
        "models": ",".join(live.values()),
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(BASE, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        report("nwp", ERROR, f"fetch failed: {type(exc).__name__}")
        raise AdapterUnavailable(f"NWP models unreachable: {exc}") from exc
    daily = data.get("daily") or {}
    per_model: dict[str, dict] = {}
    for name, key in live.items():
        tmax = (daily.get(f"temperature_2m_max_{key}") or [])
        rain = (daily.get(f"precipitation_sum_{key}") or [])
        per_model[name] = {
            "tmax_day1": tmax[1] if len(tmax) > 1 else (tmax[0] if tmax else None),
            "rain_day1": rain[1] if len(rain) > 1 else (rain[0] if rain else None),
        }
    per_model["WRF"] = {"tmax_day1": None, "rain_day1": None, "status": "UNCONFIGURED"}
    temps = [v["tmax_day1"] for v in per_model.values() if v["tmax_day1"] is not None]
    if len(temps) >= 2:
        spread = max(temps) - min(temps)
        agreement = "HIGH" if spread <= 2.0 else ("MEDIUM" if spread <= 4.0 else "LOW")
    else:
        agreement, spread = "UNKNOWN", None
    out = {
        "source": SOURCE, "models": per_model,
        "agreement": agreement, "spread_c": round(spread, 1) if spread is not None else None,
        "note": "Model spread = forecast confidence context, not an official warning.",
    }
    report("nwp", LIVE, f"compared {len(temps)} models, agreement {agreement}")
    return out, LIVE
