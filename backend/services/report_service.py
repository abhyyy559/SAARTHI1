"""Community hazard reports (§34): user observations, ALWAYS labelled COMMUNITY,
never official. JSON-file store for MVP (Postgres path in migrations/001_init.sql).

Abuse controls (jury-grade honesty, not truth verification — we cannot verify
truth, so we bound harm): closed report-type vocabulary, required text,
per-reporter rate limit. Reports are NEVER auto-promoted to warnings.
"""
from __future__ import annotations

import json
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any

from .. import config
from ..models.emergency import CommunityReport
from ..utils.time import now_ist

def _store_path() -> Path:
    """Resolved per call, deliberately not at import.

    `config.CACHE_FILE` is what tests redirect into a tmp dir. Binding the path at
    import time froze it to the developer's real store, so a test that redirected
    CACHE_FILE still wrote its abuse-control fixtures into the live file — every
    pytest run left junk community reports in it, and the Alerts page filled up
    with them.
    """
    return Path(getattr(config, "CACHE_FILE", "weathergpt_cache.json")).parent / "community_reports.json"


VALID_TYPES = {"road_blocked", "flooding", "fallen_tree", "damage", "waterlogging"}

# 5 reports/hour per reporter. In-memory by design for the prototype:
# a restart resets it, which is fail-open for genuine emergencies and
# still stops rapid-fire spam scripts. Production would persist this.
_RATE: dict[str, list] = {}
RATE_LIMIT = 5
RATE_WINDOW = timedelta(hours=1)


def _load() -> list[dict]:
    try:
        data = json.loads(_store_path().read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save(items: list[dict]) -> None:
    try:
        _store_path().write_text(json.dumps(items, default=str), encoding="utf-8")
    except Exception:
        pass


def submit(report_type: str, latitude: float, longitude: float, district: str = "",
           text: str = "", reporter_id: str = "anonymous") -> CommunityReport:
    if report_type not in VALID_TYPES:
        raise ValueError(f"unknown report_type: {report_type}")
    if not (text or "").strip():
        raise ValueError("report text is required — empty reports are noise")
    now = now_ist()
    hits = [t for t in _RATE.get(reporter_id, []) if now - t < RATE_WINDOW]
    if len(hits) >= RATE_LIMIT:
        raise ValueError(f"rate limit: max {RATE_LIMIT} reports/hour per reporter")
    hits.append(now)
    _RATE[reporter_id] = hits
    rep = CommunityReport(
        report_id=f"rep-{uuid.uuid4().hex[:10]}", report_type=report_type,
        latitude=latitude, longitude=longitude, district=district,
        text=text[:500], reporter_id=reporter_id, created_at=now_ist(),
        status="COMMUNITY", provenance="USER-REPORT",
    )
    items = _load()
    items.append(rep.model_dump(mode="json"))
    _save(items)
    return rep


def list_reports(district: str = "", limit: int = 50) -> list[dict[str, Any]]:
    items = _load()
    if district:
        items = [r for r in items if r.get("district", "").lower() == district.lower()]
    return items[-limit:]
