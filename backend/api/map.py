"""Map layers: where official alerts are in force across India, and tomorrow's
rain / heat on a grid. Feeds the heatmaps on the Map screen.

Alerts come only from NDMA SACHET (every state's feed). An alert is placed on
the districts its own text names; when it names none we can place, it sits at
its state's centre and says so (`approx: true`). The grid is Open-Meteo model
data, labelled as forecast, never as a warning.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
from fastapi import APIRouter

from .. import config
from ..adapters import cap_adapter
from ..services import district_service
from ..services.location_service import GAZETTEER
from ..services.verdict_service import _is_expired
from ..utils.time import iso_now

router = APIRouter(prefix="/api/map")

_ALERTS_TTL_S = 15 * 60
_GRID_TTL_S = 60 * 60
_alerts_cache: dict[str, Any] = {"at": 0.0, "value": None}
_grid_cache: dict[str, Any] = {"at": 0.0, "value": None}
_WEIGHT = {"RED": 1.0, "ORANGE": 0.75, "YELLOW": 0.5, "GREEN": 0.25}


def _state_centres() -> dict[str, tuple[float, float]]:
    acc: dict[str, list[tuple[float, float]]] = {}
    for e in GAZETTEER:
        acc.setdefault(e["state"], []).append((e["latitude"], e["longitude"]))
    return {s: (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) for s, pts in acc.items()}


def _place(alert: dict, state: str, centres: dict) -> tuple[list[dict], bool]:
    """Coordinates for the districts an alert names, inside its own state."""
    text = " ".join(str(alert.get(k) or "") for k in ("areaDesc", "area", "headline", "description"))
    spots = []
    for name in sorted(district_service.find_in_text(text)):
        row = next((e for e in GAZETTEER if e["district"] == name and e["state"] == state), None)
        if row:
            spots.append({"district": name, "lat": row["latitude"], "lon": row["longitude"]})
    if spots:
        return spots, False
    if state in centres:
        lat, lon = centres[state]
        return [{"district": "", "lat": lat, "lon": lon}], True
    return [], True


async def _collect_alerts() -> dict:
    if not config.CAP_FEED_URLS:  # SACHET switched off (tests, offline installs)
        return {"points": [], "alerts": 0, "feeds_reached": 0,
                "feeds_total": len(config.SACHET_STATE_SLUGS), "source": "NDMA SACHET"}
    centres = _state_centres()
    sem = asyncio.Semaphore(6)  # be gentle with SACHET: a few feeds at a time

    async def one(state: str, slug: str):
        async with sem:
            try:
                alerts, _ = await cap_adapter.fetch_alerts([config.SACHET_RSS.format(slug)])
                return state, alerts, True
            except Exception:  # noqa: BLE001 - one dead feed never blanks the map
                return state, [], False

    results = await asyncio.gather(*(one(s, slug) for s, slug in config.SACHET_STATE_SLUGS.items()))
    points, seen, reached = [], set(), 0
    for state, alerts, ok in results:
        reached += ok
        for a in alerts:
            if _is_expired(a):
                continue
            ident = a.get("identifier") or a.get("headline")
            if ident in seen:
                continue
            seen.add(ident)
            sev = str(a.get("severity") or "").upper()
            spots, approx = _place(a, state, centres)
            for s in spots:
                points.append({
                    **s, "state": state, "severity": sev or None,
                    "weight": _WEIGHT.get(sev, 0.4), "approx": approx,
                    "hazard": a.get("hazard") or a.get("event"),
                    "headline": (a.get("headline") or "")[:220],
                    "expires": a.get("expires"), "sender": a.get("sender"),
                })
    return {"points": points, "alerts": len(seen), "feeds_reached": reached,
            "feeds_total": len(config.SACHET_STATE_SLUGS), "source": "NDMA SACHET"}


@router.get("/alerts")
async def map_alerts() -> dict:
    now = time.monotonic()
    if _alerts_cache["value"] is None or now - _alerts_cache["at"] > _ALERTS_TTL_S:
        value = await _collect_alerts()
        if value["feeds_reached"]:
            _alerts_cache.update(at=now, value=value)
        else:
            return {**value, "status": "unavailable", "provenance": "UNAVAILABLE", "generated_at": iso_now()}
    return {**_alerts_cache["value"], "status": "ok", "provenance": "LIVE", "generated_at": iso_now()}


def _grid_points(step: float = 1.5, near_km: float = 120.0) -> list[tuple[float, float]]:
    """A coarse grid over India: points within `near_km` of a known district."""
    from ..services.gis_service import haversine_km
    pts = []
    lat = 8.0
    while lat <= 35.5:
        lon = 68.5
        while lon <= 97.0:
            if any(abs(e["latitude"] - lat) < 1.5 and abs(e["longitude"] - lon) < 1.5
                   and haversine_km(lat, lon, e["latitude"], e["longitude"]) <= near_km for e in GAZETTEER):
                pts.append((round(lat, 2), round(lon, 2)))
            lon += step
        lat += step
    return pts


@router.get("/grid")
async def map_grid() -> dict:
    now = time.monotonic()
    if _grid_cache["value"] is not None and now - _grid_cache["at"] < _GRID_TTL_S:
        return {**_grid_cache["value"], "status": "ok", "provenance": "CACHED", "generated_at": iso_now()}
    pts = _grid_points()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get("https://api.open-meteo.com/v1/forecast", params={
                "latitude": ",".join(str(p[0]) for p in pts),
                "longitude": ",".join(str(p[1]) for p in pts),
                "daily": "precipitation_sum,temperature_2m_max",
                "forecast_days": 2, "timezone": "Asia/Kolkata",
            })
            r.raise_for_status()
            rows = r.json()
    except Exception as exc:  # noqa: BLE001
        return {"status": "unavailable", "detail": type(exc).__name__, "provenance": "UNAVAILABLE",
                "generated_at": iso_now()}
    rows = rows if isinstance(rows, list) else [rows]
    out, date = [], None
    for (lat, lon), row in zip(pts, rows):
        d = (row or {}).get("daily") or {}
        rain, tmax, days = d.get("precipitation_sum") or [], d.get("temperature_2m_max") or [], d.get("time") or []
        if len(days) > 1:
            date = days[1]
            out.append({"lat": lat, "lon": lon, "rain_mm": rain[1] if len(rain) > 1 else None,
                        "tmax_c": tmax[1] if len(tmax) > 1 else None})
    value = {"points": out, "date": date, "source": "Open-Meteo",
             "note": "Model forecast for tomorrow. Not an official warning."}
    _grid_cache.update(at=now, value=value)
    return {**value, "status": "ok", "provenance": "LIVE", "generated_at": iso_now()}
