"""Climate analytics — real ERA5 historical series via Open-Meteo archive API.

No invented statistics: every number derives from the fetched daily series.
Demo mode uses a deterministic, clearly-labelled DEMO series (§56/§62).
"""
from __future__ import annotations

from datetime import date, timedelta

import httpx

from ..adapters.registry import DEMO, ERROR, LIVE, AdapterUnavailable, report
from ..utils.time import IST, now_ist

SOURCE = "ERA5 (Open-Meteo archive)"
BASE = "https://archive-api.open-meteo.com/v1/archive"


def _slope(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den


def analyze_series(daily_time: list[str], tmean: list[float | None], rain: list[float | None]) -> dict:
    """Pure aggregation — yearly means/sums, baselines, anomalies, least-squares trends."""
    years: dict[int, dict] = {}
    for i, d in enumerate(daily_time):
        try:
            y = int(str(d)[:4])
        except ValueError:
            continue
        b = years.setdefault(y, {"t": [], "r": []})
        if tmean and i < len(tmean) and tmean[i] is not None:
            b["t"].append(tmean[i])
        if rain and i < len(rain) and rain[i] is not None:
            b["r"].append(rain[i])
    yearly = [
        {"year": y,
         "tmean_c": round(sum(v["t"]) / len(v["t"]), 2) if v["t"] else None,
         "rain_mm": round(sum(v["r"]), 1) if v["r"] else None}
        for y, v in sorted(years.items())
    ]
    valid_t = [(p["year"], p["tmean_c"]) for p in yearly if p["tmean_c"] is not None]
    valid_r = [(p["year"], p["rain_mm"]) for p in yearly if p["rain_mm"] is not None]
    t_trend = round(_slope([a for a, _ in valid_t], [b for _, b in valid_t]), 4) if len(valid_t) > 1 else 0.0
    r_trend = round(_slope([a for a, _ in valid_r], [b for _, b in valid_r]), 2) if len(valid_r) > 1 else 0.0
    base_t = [b for _, b in valid_t[:-5]] or [b for _, b in valid_t]
    base_r = [b for _, b in valid_r[:-5]] or [b for _, b in valid_r]
    t_base = round(sum(base_t) / len(base_t), 2) if base_t else None
    r_base = round(sum(base_r) / len(base_r), 1) if base_r else None
    latest_t = valid_t[-1][1] if valid_t else None
    latest_r = valid_r[-1][1] if valid_r else None
    return {
        "source": SOURCE, "yearly": yearly,
        "temp_trend_c_per_year": t_trend, "rain_trend_mm_per_year": r_trend,
        "baseline_temp_c": t_base, "baseline_rain_mm": r_base,
        "latest_temp_c": latest_t, "latest_rain_mm": latest_r,
        "temp_anomaly_c": round(latest_t - t_base, 2) if latest_t is not None and t_base is not None else None,
        "rain_anomaly_mm": round(latest_r - r_base, 1) if latest_r is not None and r_base is not None else None,
    }


async def trends(latitude: float, longitude: float, years: int = 20) -> tuple[dict, str]:
    end = now_ist().date() - timedelta(days=5)  # ERA5 lags a few days
    start = date(end.year - years, 1, 1)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(BASE, params={
                "latitude": latitude, "longitude": longitude,
                "start_date": start.isoformat(), "end_date": end.isoformat(),
                "daily": "temperature_2m_mean,precipitation_sum", "timezone": "Asia/Kolkata",
            })
            resp.raise_for_status()
            daily = resp.json().get("daily") or {}
    except Exception as exc:
        report("climate", ERROR, f"fetch failed: {type(exc).__name__}")
        raise AdapterUnavailable(f"climate archive unreachable: {exc}") from exc
    out = analyze_series(daily.get("time") or [], daily.get("temperature_2m_mean") or [], daily.get("precipitation_sum") or [])
    out["provenance"] = LIVE
    report("climate", LIVE, f"{len(out['yearly'])} years analysed")
    return out, LIVE


def demo_series() -> tuple[dict, str]:
    """DEMO ONLY — deterministic labelled series, never presented as observed history."""
    import math
    yearly = [
        {"year": y, "tmean_c": round(27.0 + 0.02 * (y - 2005) + 0.3 * math.sin(y), 2),
         "rain_mm": round(850 + 40 * math.sin(y * 1.7), 1)}
        for y in range(2005, 2026)
    ]
    temps = [p["tmean_c"] for p in yearly]
    rains = [p["rain_mm"] for p in yearly]
    out = {
        "source": f"{SOURCE} (DEMO series)", "yearly": yearly,
        "temp_trend_c_per_year": round(_slope(list(range(len(temps))), temps), 4),
        "rain_trend_mm_per_year": round(_slope(list(range(len(rains))), rains), 2),
        "baseline_temp_c": round(sum(temps[:-5]) / len(temps[:-5]), 2),
        "baseline_rain_mm": round(sum(rains[:-5]) / len(rains[:-5]), 1),
        "latest_temp_c": temps[-1], "latest_rain_mm": rains[-1],
        "temp_anomaly_c": round(temps[-1] - sum(temps[:-5]) / len(temps[:-5]), 2),
        "rain_anomaly_mm": round(rains[-1] - sum(rains[:-5]) / len(rains[:-5]), 1),
        "provenance": DEMO,
    }
    report("climate", DEMO, "demo series (demo mode)")
    return out, DEMO
