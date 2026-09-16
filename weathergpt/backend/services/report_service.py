"""Community hazard reports (§34): user observations, ALWAYS labelled COMMUNITY,
never official. JSON-file store for MVP (Postgres path in migrations/001_init.sql)."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from .. import config
from ..models.emergency import CommunityReport
from ..utils.time import now_ist

_STORE = Path(getattr(config, "CACHE_FILE", "weathergpt_cache.json")).parent / "community_reports.json"
VALID_TYPES = {"road_blocked", "flooding", "fallen_tree", "damage", "waterlogging"}


def _load() -> list[dict]:
    try:
        data = json.loads(_STORE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save(items: list[dict]) -> None:
    try:
        _STORE.write_text(json.dumps(items, default=str), encoding="utf-8")
    except Exception:
        pass


def submit(report_type: str, latitude: float, longitude: float, district: str = "",
           text: str = "", reporter_id: str = "anonymous") -> CommunityReport:
    if report_type not in VALID_TYPES:
        raise ValueError(f"unknown report_type: {report_type}")
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
