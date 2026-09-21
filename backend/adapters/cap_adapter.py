"""NDMA-Sachet CAP adapter — parses Common Alerting Protocol feeds into normalized alerts.

Feed URL via CAP_FEED_URL env. Parser is pure (testable offline). Live fetch raises
on failure; fixture helper is DEMO-only. Never invents alerts: empty feed -> [].
"""
from __future__ import annotations

import asyncio
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from .. import config
from ..utils.time import IST
from .registry import CACHED, DEMO, ERROR, LIVE, UNCONFIGURED, AdapterUnavailable, report

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


# TGiCCC bulletins compress Telangana district names into acronyms (HYD, BDDK,
# ADL...). People cannot act on 'HYD' — expand every known one; unknown
# acronyms stay as-is (honest, never guessed).
#
# All 33 districts are listed. A missing entry is not neutral: the acronym stays
# literal, matches no district name, and the alert silently reaches nobody in the
# district it was issued for. Note KMR is Karimnagar, not Kamareddy — Kamareddy
# is KMD.
_TG_DISTRICT_ACRONYMS = {
    "ADL": "Adilabad", "BDDK": "Bhadradri Kothagudem", "HNM": "Hanumakonda",
    "HYD": "Hyderabad", "JGTL": "Jagtial", "JNG": "Jangaon",
    "JSKB": "Jayashankar Bhupalpally", "JGD": "Jogulamba Gadwal",
    "KMD": "Kamareddy", "KMR": "Karimnagar", "KHM": "Khammam",
    "KMBA": "Komaram Bheem Asifabad", "MBB": "Mahabubabad", "MBN": "Mahabubnagar",
    "MNCL": "Mancherial", "MDCM": "Medchal Malkajgiri", "MDK": "Medak",
    "MLG": "Mulugu", "NLG": "Nalgonda", "NRPT": "Narayanpet",
    "NKN": "Nagarkurnool", "NRM": "Nirmal", "NZD": "Nizamabad",
    "PDP": "Peddapalli", "RJNS": "Rajanna Sircilla", "RR": "Rangareddy",
    "SGD": "Sangareddy", "SDP": "Siddipet", "SRY": "Suryapet",
    "VKD": "Vikarabad", "WNP": "Wanaparthy", "WGL": "Warangal",
    "YBD": "Yadadri Bhuvanagiri",
}
_ACRONYM_RE = re.compile(
    r"\b(" + "|".join(sorted(_TG_DISTRICT_ACRONYMS, key=len, reverse=True)) + r")\b"
)


def _expand_acronyms(text: str) -> str:
    if not text:
        return text
    return _ACRONYM_RE.sub(lambda m: _TG_DISTRICT_ACRONYMS[m.group(1)], text)


def _normalize(info: dict[str, Any]) -> dict[str, Any]:
    severity = str(info.get("severity") or "Unknown")
    # CAP uses Minor/Moderate/Severe/Extreme; IMD-style feeds already emit
    # GREEN/YELLOW/ORANGE/RED. Accept both — original preserved in 'cap_severity'.
    mapping = {
        "Minor": "GREEN", "Moderate": "YELLOW", "Severe": "ORANGE", "Extreme": "RED",
        "GREEN": "GREEN", "YELLOW": "YELLOW", "ORANGE": "ORANGE", "RED": "RED",
    }
    area = _expand_acronyms(str(info.get("areaDesc") or info.get("area") or ""))
    geocode = info.get("geocode") or ""
    headline = _expand_acronyms(str(info.get("headline") or ""))
    message = _expand_acronyms(str(info.get("description") or info.get("headline") or ""))
    description = _expand_acronyms(str(info.get("description") or ""))
    return {
        "source": SOURCE,
        # NDMA-Sachet CAP is an official warning source. Demo fixtures reuse
        # this shape, but demo_fixture stamps them demo=True afterwards so the
        # UI badges them DEMO — never presented as live official warnings.
        "official": True,
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
        "headline": headline,
        "message": message,
        "description": description,
        "instruction": info.get("instruction") or "",
        "area": area,
        "areaDesc": area,
        "geocode": geocode,
        "polygon": info.get("polygon") or "",
        "circle": info.get("circle") or "",
        "issued_at": info.get("sent") or info.get("issued_at"),
    }


def _rss_item_links(payload: str, limit: int = 10) -> list[str]:
    """SACHET serves RSS <item> entries linking to per-alert CAP XML files.

    Returns the linked alert URLs (FetchXMLFile identifiers). Pure function.
    """
    import re
    links: list[str] = []
    for m in re.finditer(r"<item\b.*?</item>", payload or "", re.S | re.I):
        lm = re.search(r"<link\b[^>]*>(.*?)</link>", m.group(0), re.S | re.I)
        if lm:
            url = lm.group(1).strip()
            if url and url not in links:
                links.append(url)
        if len(links) >= limit:
            break
    return links


async def _fetch_linked(client: "httpx.AsyncClient", link: str) -> list[dict[str, Any]]:
    """One linked alert document. A failure is an empty list, never an exception:
    one bad item must not kill the feed."""
    try:
        r = await client.get(link)
        r.raise_for_status()
        return parse_cap(r.text)
    except Exception:
        return []


# A feed that answers HTTP 200 with a login page / WAF block / proxy error body
# is *failing*, not a quiet sky. The payload must be well-formed AND carry
# CAP/RSS structure — otherwise it counts as a failed feed (never LIVE).
_CAP_SHAPE_RE = re.compile(r"<\s*(alert|info|rss|feed|channel|item)\b|\"alerts\"\s*:", re.I)


def _feed_has_cap_shape(payload: str) -> bool:
    """True if the payload is at least plausibly a CAP/RSS/JSON feed document."""
    text = (payload or "").strip()
    if not text:
        return False  # an empty 200 body is a misbehaving server, not a
                      # valid empty CAP document — failing it keeps the feed
                      # from being reported LIVE with "0 active alerts"
    if text.startswith("{"):
        try:
            data = json.loads(text)
        except Exception:
            return False
        return isinstance(data, dict) and isinstance(data.get("alerts"), list)
    try:
        ET.fromstring(text)
    except ET.ParseError:
        return False
    return bool(_CAP_SHAPE_RE.search(text))


async def _fetch_feed(client: "httpx.AsyncClient", url: str) -> list[dict[str, Any]]:
    """One feed: inline CAP first, then linked FetchXMLFile documents."""
    resp = await client.get(url)
    resp.raise_for_status()
    if not _feed_has_cap_shape(resp.text):
        # fetch_alerts counts this as a failed feed: garbage must never be
        # reported LIVE ("0 active alerts").
        raise ValueError(f"feed {url} answered with an unparseable payload (not CAP XML/JSON/RSS)")
    alerts = parse_cap(resp.text)
    if not alerts:
        links = _rss_item_links(resp.text)
        if links:
            # The linked documents are independent of each other. Fetched serially
            # they cost the SUM of their round-trips — roughly ten TLS handshakes
            # before the first warning can be rendered, which is the difference
            # between a fisherman reading a warning and putting the phone down.
            # gather preserves order, so the resulting alert list is identical to
            # the serial version; only the wall-clock time changes.
            for part in await asyncio.gather(*(_fetch_linked(client, link) for link in links)):
                alerts.extend(part)
    return alerts


async def fetch_alerts() -> tuple[list[dict[str, Any]], str]:
    urls = list(getattr(config, "CAP_FEED_URLS", None) or ([config.CAP_FEED_URL] if config.CAP_FEED_URL else []))
    if not urls:
        report("cap", UNCONFIGURED, "CAP_FEED_URL not set")
        raise AdapterUnavailable("CAP feed unconfigured (needs CAP_FEED_URL)")
    from datetime import timedelta
    try:
        alerts: list[dict[str, Any]] = []
        seen: set[str] = set()
        failed = 0
        async with httpx.AsyncClient(timeout=12.0) as client:
            for url in urls:
                try:
                    for a in await _fetch_feed(client, url):
                        ident = a.get("identifier") or a.get("headline") or url
                        if ident not in seen:
                            seen.add(ident)
                            alerts.append(a)
                except Exception:
                    failed += 1
                    continue  # one bad feed never kills the others
    except AdapterUnavailable:
        raise
    except Exception as exc:
        report("cap", ERROR, f"fetch failed: {type(exc).__name__}")
        raise AdapterUnavailable(f"CAP feed unreachable: {exc}") from exc
    if alerts:
        try:
            from ..services.cache_service import CacheService
            CacheService().set("cap_alerts", alerts, timedelta(minutes=30))
        except Exception:
            pass
        report("cap", LIVE, f"{len(alerts)} active alerts")
        return alerts, LIVE
    if failed >= len(urls):
        # All feeds failed (flaky upstream, not an empty sky): serve the last
        # good fetch labelled CACHED instead of pretending nothing exists.
        try:
            from ..services.cache_service import CacheService
            cached = CacheService().get("cap_alerts") or []
            if cached:
                for a in cached:
                    a["stale_note"] = "Showing last retrieved information; may be outdated."
                report("cap", CACHED, f"{len(cached)} cached alerts (feeds failing)")
                return cached, CACHED
        except Exception:
            pass
        report("cap", ERROR, "all CAP feeds failing, no cache — check CAP_FEED_URL / network")
        raise AdapterUnavailable("CAP feeds unreachable and no cached alerts")
    report("cap", LIVE, "0 active alerts")
    return [], LIVE


def demo_fixture(district: str | None = None) -> tuple[list[dict[str, Any]], str]:
    """DEMO ONLY — simulated CAP-style alert, labelled.

    When `district` is given, the Hyderabad sample text is retargeted to it so
    prototype testing works anywhere. Provenance stays DEMO throughout.
    """
    # Location-switcher presets (services/district_demo.py): a preset district
    # gets its OWN sample alert set — Visakhapatnam's cyclone, Mumbai's
    # thunderstorm, Chennai's honest calm (empty list is a real answer, not a
    # missing one). None here means "not a preset": the generic fixture path
    # below handles Hyderabad / Medchal Malkajgiri / unknown names.
    try:
        from ..services import district_demo
        preset_alerts = district_demo.demo_cap_alerts(district)
    except Exception:
        preset_alerts = None
    if preset_alerts is not None:
        alerts = [_normalize(a) for a in preset_alerts]
        # The raw preset marker ("demo": True) is dropped by _normalize —
        # re-stamp it here so the honesty marker survives.
        for a in alerts:
            a["demo"] = True
        report("cap", DEMO, f"preset fixture (demo mode): {district}")
        return alerts, DEMO
    try:
        raw = json.loads(_FIXTURE.read_text(encoding="utf-8"))
        alerts = [_normalize(a) for a in (raw.get("alerts") or [])]
    except Exception:
        alerts = []
    if district and district.lower() != "hyderabad":
        # Keep the state suffix truthful (fixture says Telangana): resolve it
        # from the local gazetteer, omit it if unknown. Lazy import avoids any
        # adapter<->service import cycle.
        try:
            from ..services.location_service import LocationService
            state = (LocationService().resolve(None, None, district).get("state") or "")
        except Exception:
            state = ""
        area = f"{district} district" + (f", {state}" if state else "")
        for a in alerts:
            if isinstance(a.get("areaDesc"), str) and "Hyderabad" in a["areaDesc"]:
                a["areaDesc"] = area
            if isinstance(a.get("area"), str) and "Hyderabad" in a["area"]:
                a["area"] = area
            # `message` is derived from `description` in _normalize, so it has to
            # be retargeted too — leaving it alone showed a Warangal alert whose
            # body still read "... over Hyderabad district", and put Hyderabad in
            # the alert's named_districts for a district it does not mention.
            for key in ("headline", "description", "message"):
                if isinstance(a.get(key), str) and "Hyderabad" in a[key]:
                    a[key] = a[key].replace("Hyderabad", district)
    report("cap", DEMO, "fixture (demo mode)")
    # DEMO ONLY: everything this function returns is simulated content, even
    # the official-looking fixture alerts. Stamp every one demo=True so no
    # surface can present a simulated alert as a live official warning — the
    # Alerts page badges these DEMO (the original fixture source stays in
    # fixture_source for debugging).
    for a in alerts:
        a["fixture_source"] = a.get("source") or ""
        a["demo"] = True
    return alerts, DEMO
