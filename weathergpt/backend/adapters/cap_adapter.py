"""NDMA-Sachet CAP adapter — parses Common Alerting Protocol feeds into normalized alerts.

Feed URL via CAP_FEED_URL env. Parser is pure (testable offline). Live fetch raises
on failure; fixture helper is DEMO-only. Never invents alerts: empty feed -> [].
"""
from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from .. import config
from ..utils.time import IST
from .registry import DEMO, ERROR, LIVE, UNCONFIGURED, AdapterUnavailable, report

SOURCE = "NDMA-Sachet-CAP"
_FIXTURE = Path(__file__).resolve().parent.parent.parent / "demo" / "fixtures" / "cap_alert.json"


def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def parse_cap(payload: str) -> list[dict[str, Any]]:
    """Parse CAP XML (alert/info levels) or JSON with 'alerts'. Pure function.

    Extracts the §9 field set where present: identifier, sender, sent, status,
    msgType, scope, language, category, event, urgency, severity, certainty,
    effective, onset, expires, headline, description, instruction, areaDesc,
    polygon, circle. Never invents fields that are not present.
    """
    text = (payload or "").strip()
    if not text:
        return []
    if text.startswith("{"):
        try:
            data = json.loads(text)
            return [_normalize(a) for a in (data.get("alerts") or []) if isinstance(a, dict)]
        except Exception:
            return []
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []
    alerts: list[dict[str, Any]] = []
    for elem in root.iter():
        if _strip_ns(elem.tag) != "alert":
            continue
        alert_level = { _strip_ns(c.tag): (_extract_text(c)) for c in elem if _is_leaf(c) }
        infos = [e for e in elem.iter() if _strip_ns(e.tag) == "info"]
        if not infos:
            alerts.append(_normalize(alert_level))
            continue
        for info in infos:
            merged = dict(alert_level)
            merged.update({ _strip_ns(c.tag): (_extract_text(c)) for c in info if _is_leaf(c) })
            # <area> blocks nest areaDesc/polygon/circle/geocode one level deeper
            for area in info.iter():
                if _strip_ns(area.tag) == "area" and area is not info:
                    merged.update({ _strip_ns(c.tag): (_extract_text(c)) for c in area if _is_leaf(c) })
            alerts.append(_normalize(merged))
    # Fallback: <info> without <alert> wrapper (minimal feeds)
    if not alerts:
        for elem in root.iter():
            if _strip_ns(elem.tag) != "info":
                continue
            info = { _strip_ns(c.tag): (_extract_text(c)) for c in elem if _is_leaf(c) }
            for area in elem.iter():
                if _strip_ns(area.tag) == "area" and area is not elem:
                    info.update({ _strip_ns(c.tag): (_extract_text(c)) for c in area if _is_leaf(c) })
            alerts.append(_normalize(info))
    return alerts


def _is_leaf(elem: ET.Element) -> bool:
    return len(list(elem)) == 0


def _extract_text(elem: ET.Element) -> str:
    if _strip_ns(elem.tag) == "polygon" and elem.text:
        return " ".join(elem.text.split())
    return (elem.text or "").strip()


def _normalize(info: dict[str, Any]) -> dict[str, Any]:
    severity = str(info.get("severity") or "Unknown")
    # CAP uses Minor/Moderate/Severe/Extreme — map to IMD-style scale for display only,
    # original preserved in 'cap_severity'.
    mapping = {"Minor": "GREEN", "Moderate": "YELLOW", "Severe": "ORANGE", "Extreme": "RED"}
    area = info.get("areaDesc") or info.get("area") or ""
    geocode = info.get("geocode") or ""
    return {
        "source": SOURCE,
        "identifier": info.get("identifier") or "",
        "sender": info.get("sender") or "",
        "sent": info.get("sent") or "",
        "status": info.get("status") or "",
        "msgType": info.get("msgType") or "",
        "scope": info.get("scope") or "",
        "language": info.get("language") or "",
        "category": info.get("category") or "",
        "hazard": info.get("event") or info.get("headline") or "Unknown",
        "urgency": info.get("urgency") or "",
        "severity": mapping.get(severity, "UNKNOWN"),
        "cap_severity": severity,
        "certainty": info.get("certainty") or "",
        "effective": info.get("effective") or "",
        "onset": info.get("onset") or "",
        "expires": info.get("expires") or "",
        "headline": info.get("headline") or "",
        "message": info.get("description") or info.get("headline") or "",
        "description": info.get("description") or "",
        "instruction": info.get("instruction") or "",
        "area": area,
        "areaDesc": area,
        "geocode": geocode,
        "polygon": info.get("polygon") or "",
        "circle": info.get("circle") or "",
        "issued_at": info.get("sent") or info.get("issued_at"),
    }


async def fetch_alerts() -> tuple[list[dict[str, Any]], str]:
    url = config.CAP_FEED_URL
    if not url:
        report("cap", UNCONFIGURED, "CAP_FEED_URL not set")
        raise AdapterUnavailable("CAP feed unconfigured (needs CAP_FEED_URL)")
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            alerts = parse_cap(resp.text)
    except AdapterUnavailable:
        raise
    except Exception as exc:
        report("cap", ERROR, f"fetch failed: {type(exc).__name__}")
        raise AdapterUnavailable(f"CAP feed unreachable: {exc}") from exc
    report("cap", LIVE, f"{len(alerts)} active alerts")
    return alerts, LIVE


def demo_fixture() -> tuple[list[dict[str, Any]], str]:
    """DEMO ONLY — simulated CAP-style alert, labelled."""
    try:
        raw = json.loads(_FIXTURE.read_text(encoding="utf-8"))
        alerts = [_normalize(a) for a in (raw.get("alerts") or [])]
    except Exception:
        alerts = []
    report("cap", DEMO, "fixture (demo mode)")
    return alerts, DEMO
