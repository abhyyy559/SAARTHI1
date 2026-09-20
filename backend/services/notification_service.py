"""Notification log — the in-app record of everything SAARTHI pushed.

WHY THIS EXISTS
---------------
A push notification is fire-and-forget: once the browser shows it, the server
has no idea the user saw it, missed it, or dismissed it. Round2's alert story
needs the reverse: an alert LIFECYCLE (pre-alert -> active -> ended) the user
can scroll, with read/unread state and a trail they can show a jury.

WHAT IT STORES
--------------
One entry per notification EVENT (never per device): {id, kind, title, body,
severity, district, alert_id, at, channel, push:{targeted,delivered,failed}}.
Read state is per device id (`read_by`), because two devices of one household
must not mark each other's notifications read.

PERSISTENCE
-----------
Goes through `services/db.py`: PostgreSQL when DATABASE_URL is set, JSON files
otherwise. The log is an honest record — only what was actually pushed (or
locally raised) lands here. Nothing is invented for the Center to look busy.
"""
from __future__ import annotations

import uuid
from typing import Any

from ..utils.time import iso_now
from . import db
from .store_bridge import run

KINDS = ("pre-alert", "active", "updated", "extended", "ended", "cancelled",
         "start", "escalate", "clear", "test", "info")
_NS = "notifications"
_MAX = 500


def log(kind: str, title: str, body: str, *, district: str = "", alert_id: str = "",
        severity: str = "", channel: str = "push", push: dict[str, Any] | None = None) -> dict[str, Any]:
    """Record one notification that was actually sent. Returns the entry."""
    entry = {
        "id": f"ntf-{uuid.uuid4().hex[:12]}",
        "kind": str(kind or "info"),
        "title": str(title or ""),
        "body": str(body or ""),
        "severity": str(severity or ""),
        "district": str(district or ""),
        "alert_id": str(alert_id or ""),
        "channel": str(channel or "push"),
        "at": iso_now(),
        "push": push or {},
        "read_by": [],
    }
    run(db.log_append(_NS, entry["id"], entry))
    return entry


def list_all(district: str = "", device: str = "") -> list[dict[str, Any]]:
    """Newest-first log. Each entry carries `read` for THIS device."""
    items = run(db.log_all(_NS))
    if not isinstance(items, list):
        items = []
    if district:
        items = [e for e in items if (e.get("district") or "").lower() == district.lower()]
    items = sorted(items, key=lambda e: str(e.get("at") or ""), reverse=True)
    dev = device or "anonymous"
    return [{**e, "read": dev in set(e.get("read_by") or [])} for e in items[:_MAX]]


def unread_count(district: str = "", device: str = "") -> int:
    dev = device or "anonymous"
    return sum(1 for e in list_all(district, device) if dev not in set(e.get("read_by") or []))


def mark_read(ids: list[str], device: str = "") -> dict[str, Any]:
    """Mark the given notification ids read for THIS device. Idempotent."""
    dev = device or "anonymous"
    wanted = {str(i) for i in ids or []}
    items = run(db.log_all(_NS))
    changed = 0
    for e in items:
        if e.get("id") in wanted:
            readers = set(e.get("read_by") or [])
            if dev not in readers:
                readers.add(dev)
                e["read_by"] = sorted(readers)
                run(db.log_append(_NS, e["id"], e))
                changed += 1
    return {"marked": changed, "device": dev}


def mark_all_read(district: str, device: str = "") -> dict[str, Any]:
    items = run(db.log_all(_NS))
    dev = device or "anonymous"
    changed = 0
    for e in items:
        if district and (e.get("district") or "").lower() != district.lower():
            continue
        readers = set(e.get("read_by") or [])
        if dev not in readers:
            readers.add(dev)
            e["read_by"] = sorted(readers)
            run(db.log_append(_NS, e["id"], e))
            changed += 1
    return {"marked": changed, "device": dev}


def reset_store() -> None:
    run(db.log_clear(_NS))
