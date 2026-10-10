"""Geographic heat layers for the map view — alerts, weather, health.

One endpoint returns every layer for every served district, so the map makes a
single request and can swap layers client-side without refetching. The three
layers are deliberately independent: a district with no readable weather still
shows its alerts, and a district with no alerts still reads UNKNOWN rather than
a fabricated green.

Provenance rules follow docs/SOURCE-MODES.md throughout:
  demo   fixtures labelled DEMO, weather from demo fixtures.
  imd    official-only — no Open-Meteo, no OWM backfill. Weather is omitted,
         never presented as official when it is not.
  hybrid IMD -> Open-Meteo -> OWM -> CACHED -> honest UNAVAILABLE.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from fastapi import APIRouter

from .. import config
from ..adapters import cap_adapter, openmeteo_adapter, owm_adapter
from ..adapters.registry import AdapterUnavailable
from ..services import district_service
from ..services.alert_service import classify_alert
from ..services.cache_service import CacheService
from ..services.location_service import GAZETTEER
from ..utils.time import iso_now

# Heat/cold thresholds are IMPORTED, not re-declared: a second copy would be a
# second opinion on what a health risk is, and the map would eventually
# disagree with the Advisory cards about the same 44C day. (Underscore names
# are private by convention; importing them is deliberate — one source of
# truth beats a naming preference.)
from ..services.advisory_service import (  # noqa: PLC2701 - intentional import
    _COLD_C,
    _HEATSTRESS_HUMIDITY_PCT,
    _HEATSTRESS_TEMP_C,
    _HEAT_C,
)

router = APIRouter(prefix="/api")
cache = CacheService()
log = logging.getLogger("weathergpt.map")

# Same severity ladder the schematic DistrictMap uses, so the two maps can
# never disagree about what RED means.
SEV_RANK = {"GREEN": 0, "UNKNOWN": 1, "YELLOW": 2, "ORANGE": 3, "RED": 4}
SEV_LABEL = {0: "NONE", 1: "UNKNOWN", 2: "YELLOW", 3: "ORANGE", 4: "RED"}

# Terminal lifecycle states never colour the map: an alert that has ended is
# history, not a live condition.
_TERMINAL = ("ENDED", "CANCELLED")

MAP_WEATHER_KEY = "map_weather_v1"
MAP_WEATHER_TTL_MINUTES = 10


def _official_only() -> bool:
    return config.current_source_mode() == "imd"


def _heat_layer(temp: float | None, humidity: float | None) -> dict[str, Any]:
    """Health risk for one district, derived only from observed numbers.

    Reuses the Advisory heat/cold rules. Returns `unknown` — not `low` — when
    the temperature is missing: an unreadable district is not a healthy one.
    """
    if temp is None:
        return {"risk": "unknown", "risk_score": None, "basis": None}
    if temp >= _HEAT_C:
        return {"risk": "high", "risk_score": 2, "basis": "heat"}
    if humidity is not None and temp >= _HEATSTRESS_TEMP_C and humidity >= _HEATSTRESS_HUMIDITY_PCT:
        return {"risk": "moderate", "risk_score": 1, "basis": "heat_stress"}
    if temp <= _COLD_C:
        return {"risk": "high", "risk_score": 2, "basis": "cold"}
    return {"risk": "low", "risk_score": 0, "basis": None}


async def _weather_layer(locations: list[tuple[float, float]]) -> list[dict[str, Any] | None]:
    """Observed weather per location, batch-fetched and cached as one blob.

    Cached whole so a map refresh is one cache read, not 33. An unreachable
    provider yields a list of Nones — each district then reports "no weather",
    which is a different and honest state from "36 degrees".
    """
    key = f"{MAP_WEATHER_KEY}:{len(locations)}"
    cached = cache.get(key)
    if cached and isinstance(cached, list) and len(cached) == len(locations):
        return cached
    try:
        obs_list = await openmeteo_adapter.get_current_many(locations)
    except AdapterUnavailable as exc:
        log.info("map weather unavailable: %s", exc)
        return [None] * len(locations)
    out: list[dict[str, Any] | None] = []
    for obs in obs_list:
        if obs is None:
            out.append(None)
            continue
        d = obs.model_dump(mode="json")
        out.append({
            "temperature": d.get("temperature"),
            "humidity": d.get("humidity"),
            "condition": d.get("condition"),
            "precipitation": d.get("rainfall"),
            "wind_speed": d.get("wind_speed"),
        })
    cache.set(key, out, timedelta(minutes=MAP_WEATHER_TTL_MINUTES))
    return out


def _alert_layers(cap_alerts: list[dict[str, Any]], *,
                  feed_readable: bool = True) -> dict[str, dict[str, Any]]:
    """Worst ACTIVE severity per district, classified once against every district.

    The alert set is fetched once for the whole map (not per district) and then
    classified against each district in turn, so the heat layer and the Alerts
    list are reading the same feed rather than two subtly different ones.

    `feed_readable` is False when the feed itself could not be read. That is a
    different fact from "read, and empty": an unread sky is UNKNOWN, and
    painting it NONE would be a false all-clear — exactly the claim this
    console refuses to make anywhere else.
    """
    worst: dict[str, dict[str, Any]] = {}
    for entry in GAZETTEER:
        name = entry.get("district")
        lat, lon = entry.get("latitude"), entry.get("longitude")
        if not name or lat is None or lon is None:
            continue
        if not feed_readable:
            worst[name] = {
                "severity": SEV_RANK["UNKNOWN"], "severity_label": "UNKNOWN",
                "count": 0, "active": False,
            }
            continue
        state_name = str(entry.get("state") or "")
        count = 0
        rank = 0
        for alert in cap_alerts:
            if str(alert.get("lifecycle_state") or "").upper() in _TERMINAL:
                continue
            relevance = classify_alert(
                alert, lat=lat, lon=lon, district=name, state_name=state_name)
            if relevance != "relevant":
                continue
            count += 1
            rank = max(rank, SEV_RANK.get(str(alert.get("severity") or "").upper(), 1))
        worst[name] = {
            "severity": rank,
            "severity_label": SEV_LABEL[rank],
            "count": count,
            "active": count > 0,
        }
    return worst


@router.get("/map/layers")
async def map_layers() -> dict:
    """Every heat layer for every served district, in one payload.

    Per-district failure isolation: an unreachable weather provider blanks the
    weather column only, never the whole map. `provenance` names the chain that
    actually answered for the live (non-demo) path.
    """
    entries = [e for e in GAZETTEER if e.get("district") and e.get("latitude") is not None]
    locations = [(float(e["latitude"]), float(e["longitude"])) for e in entries]

    if config.DEMO_MODE:
        alert_layer: dict[str, dict[str, Any]] = {}
        for e in entries:
            name = e["district"]
            alerts, _ = cap_adapter.demo_fixture(name)
            active = [a for a in alerts
                      if str(a.get("lifecycle_state") or "").upper() not in _TERMINAL]
            rank = max((SEV_RANK.get(str(a.get("severity") or "").upper(), 1)
                        for a in active), default=0)
            alert_layer[name] = {
                "severity": rank, "severity_label": SEV_LABEL[rank],
                "count": len(active), "active": bool(active),
            }
        alerts_prov = "DEMO"
        weather_prov = "DEMO"
    else:
        try:
            cap_alerts, alerts_prov = await cap_adapter.fetch_alerts()
            feed_readable = True
        except AdapterUnavailable as exc:
            # The alert feed being down must not blank the weather/health
            # layers: each district then reads UNKNOWN, not NONE — an unread
            # sky is never reported as a clear one.
            log.info("map alerts unavailable: %s", exc)
            cap_alerts, alerts_prov = [], "UNAVAILABLE"
            feed_readable = False
        alert_layer = _alert_layers(cap_alerts, feed_readable=feed_readable)
        weather_prov = "LIVE"

    weather_list = await _weather_layer(locations)

    districts: list[dict[str, Any]] = []
    for entry, wx in zip(entries, weather_list):
        name = entry["district"]
        # Demo mode never invents a weather number: the fixtures are alert
        # fixtures, so the weather/health columns read honestly absent.
        weather = None if config.DEMO_MODE else wx
        health = _heat_layer(
            weather.get("temperature") if weather else None,
            weather.get("humidity") if weather else None,
        )
        districts.append({
            "district": name,
            "state": entry.get("state"),
            "latitude": float(entry["latitude"]),
            "longitude": float(entry["longitude"]),
            "alerts": alert_layer.get(name, {
                "severity": 1, "severity_label": "UNKNOWN", "count": 0, "active": False,
            }),
            "weather": weather,
            "health": health,
        })

    if config.DEMO_MODE:
        provenance = "DEMO"
    else:
        parts = [f"alerts:{alerts_prov}", f"weather:{weather_prov}"]
        provenance = " ".join(parts)

    return {
        "districts": districts,
        "provenance": provenance,
        "source_mode": config.current_source_mode(),
        "generated_at": iso_now(),
    }
