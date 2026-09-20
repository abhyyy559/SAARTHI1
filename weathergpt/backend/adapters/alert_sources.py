"""Multi-source live alert chain — no single Indian weather feed is reliable
enough alone. Priority: Weather InTouch (official IMD CAP via MCP, no key) →
WeatherAPI.com (free key) → GDACS (major disasters, no key) → SACHET RSS
(existing CAP adapter). First source with alerts wins; every failure is
logged and the chain moves on. Empty chain -> ([], UNAVAILABLE).

Normalizes every provider into the CAP-ish dict shape the rest of the
pipeline already speaks (relevance, card rendering, provenance badges).
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import httpx

from .. import config
from ..utils.time import IST
from .registry import ERROR, LIVE, report

UNAVAILABLE = "UNAVAILABLE"  # matches the literal used across the warnings API

SOURCE_BY_NAME = {
    "weatherintouch": "WeatherInTouch-IMD-CAP",
    "weatherapi": "WeatherAPI.com",
    "gdacs": "GDACS",
    "sachet": "NDMA-Sachet-CAP",
}

_TIMEOUT = httpx.Timeout(12.0, connect=6.0)


def _iso(value: Any) -> str:
    """Best-effort ISO string passthrough; '' when unusable."""
    return str(value or "")


def _mk_alert(*, source: str, identifier: str, hazard: str, severity: str,
              headline: str, message: str, instruction: str, area: str,
              effective: str, expires: str, sent: str = "", circle: str = "") -> dict[str, Any]:
    return {
        "source": source,
        "identifier": identifier,
        "sender": source,
        "sent": sent or effective,
        "status": "Actual",
        "msgType": "Alert",
        "scope": "Public",
        "language": "en-IN",
        "category": "Met",
        "hazard": hazard,
        "urgency": "Expected",
        "severity": severity,
        "cap_severity": severity,
        "certainty": "Likely",
        "effective": effective,
        "onset": effective,
        "expires": expires,
        "headline": headline,
        "message": message,
        "description": message,
        "instruction": instruction,
        "area": area,
        "areaDesc": area,
        "geocode": "",
        "polygon": "",
        "circle": circle,
        "issued_at": sent or effective,
    }


# ------------------------------------------------------------------ InTouch
async def _from_weatherintouch(lat: float, lon: float, district: str) -> list[dict[str, Any]]:
    """Official IMD CAP alerts via Weather InTouch's public MCP endpoint.
    JSON-RPC over HTTP with SSE Accept header; result text is JSON."""
    body = {
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "get_severe_alerts",
                   "arguments": {"place": district or "Hyderabad"}},
    }
    headers = {"Accept": "application/json, text/event-stream"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post("https://api.weatherintouch.com/api/mcp",
                              json=body, headers=headers)
        r.raise_for_status()
        raw = r.text
    # SSE frame (event:/data:) or bare JSON — handle both.
    if raw.lstrip().startswith("event:") or "\ndata:" in raw:
        for line in raw.splitlines():
            if line.startswith("data:"):
                raw = line[5:].strip()
                break
    payload = json.loads(raw)
    content = (payload.get("result") or {}).get("content") or []
    text = next((c.get("text") for c in content if c.get("type") == "text"), None)
    data = json.loads(text) if text else {}
    alerts = []
    for a in data.get("alerts") or []:
        sev = str(a.get("severity") or "").upper()
        sev = sev if sev in ("RED", "ORANGE", "YELLOW", "GREEN") else "YELLOW"
        alerts.append(_mk_alert(
            source=SOURCE_BY_NAME["weatherintouch"],
            identifier=str(a.get("id") or a.get("identifier") or f"wit-{district}"),
            hazard=str(a.get("event") or a.get("hazard") or "Weather alert"),
            severity=sev,
            headline=str(a.get("headline") or a.get("description") or ""),
            message=str(a.get("description") or a.get("headline") or ""),
            instruction=str(a.get("instruction") or ""),
            area=str(a.get("area") or a.get("areaDesc") or district),
            effective=_iso(a.get("effective") or a.get("onset")),
            expires=_iso(a.get("expires") or a.get("valid_until")),
        ))
    return alerts


# --------------------------------------------------------------- WeatherAPI
async def _from_weatherapi(lat: float, lon: float, district: str) -> list[dict[str, Any]]:
    key = config.WEATHERAPI_KEY
    if not key:
        raise RuntimeError("WEATHERAPI_KEY not configured")
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get("https://api.weatherapi.com/v1/alerts.json",
                             params={"key": key, "q": f"{lat},{lon}"})
        r.raise_for_status()
        data = r.json()
    alerts = []
    for a in (data.get("alerts") or {}).get("alert") or []:
        sev = str(a.get("severity") or "").strip().capitalize()
        sev = {"Moderate": "YELLOW", "Severe": "ORANGE", "Extreme": "RED",
               "Minor": "GREEN"}.get(sev, "YELLOW")
        alerts.append(_mk_alert(
            source=SOURCE_BY_NAME["weatherapi"],
            identifier=str(a.get("alertId") or a.get("headline") or "wapi"),
            hazard=str(a.get("event") or a.get("headline") or "Weather alert"),
            severity=sev,
            headline=str(a.get("headline") or ""),
            message=str(a.get("desc") or a.get("headline") or ""),
            instruction=str(a.get("instruction") or ""),
            area=str(a.get("areas") or district),
            effective=_iso(a.get("effective")),
            expires=_iso(a.get("expires")),
        ))
    return alerts


# -------------------------------------------------------------------- GDACS
_GDACS_SEV = {"Red": "RED", "Orange": "ORANGE", "Green": "YELLOW"}

async def _from_gdacs(lat: float, lon: float, district: str) -> list[dict[str, Any]]:
    """Major disasters only (Orange/Red). GDACS gives real event coordinates —
    carried as CAP circle geometry so the pipeline's relevance filter can
    decide honestly whether the user is in range. The radius is a broad
    footprint estimate used ONLY for relevance, never shown as precision."""
    from ..services.gis_service import haversine_km

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH",
                             params={"country": "India", "alertlevel": "Orange;Red"})
        r.raise_for_status()
        data = r.json()
    alerts = []
    for f in data.get("features") or []:
        p = f.get("properties") or {}
        coords = ((f.get("geometry") or {}).get("coordinates") or [None, None])
        glon, glat = (coords + [None, None])[:2]
        if glat is None or glon is None:
            continue
        try:
            dist_km = haversine_km(lat, lon, float(glat), float(glon))
        except (TypeError, ValueError):
            continue
        if dist_km > 350:
            continue  # major disaster nowhere near the user — not their alert
        sev = _GDACS_SEV.get(str(p.get("alertlevel") or ""), "ORANGE")
        name = str(p.get("eventname") or p.get("description") or "Disaster event")
        etype = str(p.get("eventtype") or "").strip().upper()
        radius_km = 100 if etype in ("FL", "TC") else 40
        alerts.append(_mk_alert(
            source=SOURCE_BY_NAME["gdacs"],
            identifier=f"gdacs-{p.get('eventid')}-{p.get('episodeid')}",
            hazard=f"{etype} {name}".strip()[:80],
            severity=sev,
            headline=str(p.get("htmldescription") or p.get("description") or name),
            message=str(p.get("description") or name),
            instruction="Follow official evacuation and safety guidance.",
            area=f"{p.get('country') or 'India'} · about {int(dist_km)} km away",
            effective=_iso(p.get("fromdate")),
            expires=_iso(p.get("todate")),
            circle=f"{glat},{glon} {radius_km}",
        ))
    return alerts


# ------------------------------------------------------------------- chain
async def get_alerts(lat: float, lon: float, district: str) -> tuple[list[dict[str, Any]], str]:
    """Run the priority chain. Returns (alerts, provenance). First live source
    with alerts wins; UNAVAILABLE only when every source fails or is empty."""
    chain = [
        ("weatherintouch", _from_weatherintouch),
        ("weatherapi", _from_weatherapi),
        ("gdacs", _from_gdacs),
    ]
    for name, fn in chain:
        try:
            alerts = await fn(lat, lon, district)
            if alerts:
                report(SOURCE_BY_NAME[name], LIVE, f"{len(alerts)} alert(s)")
                return alerts, LIVE
            report(SOURCE_BY_NAME[name], LIVE, "reachable, no active alerts")
        except Exception as exc:  # noqa: BLE001 - chain must never raise
            report(SOURCE_BY_NAME[name], ERROR, f"{type(exc).__name__}")
    # Chain found nothing: caller falls back to SACHET/fixtures upstream.
    return [], UNAVAILABLE
