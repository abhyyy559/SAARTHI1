"""Demo alert store — CRUD + schedule + lifecycle state machine (Round2).

Demo-mode only. Persistence now goes through `services/db.py`: PostgreSQL when
DATABASE_URL is set (survives deploys/restarts/multi-worker), JSON files
otherwise. The API is unchanged — callers keep the sync functions below; the
bridge in `store_bridge.py` moves data to whichever backend is configured.

Each alert: title, hazard, severity (RED/ORANGE/YELLOW), district, area,
instruction, pre_alert_at, starts_at, ends_at, state, history[].
Full-lifecycle detail (alerts redesign): issuer, reason, effects are set at
creation (or patched later); started_at is stamped when the alert is
activated; completed_at is stamped when it reaches a terminal state
(ENDED/CANCELLED). `alert["lifecycle_detail"]` is attached on every read via
`alert_service.lifecycle_detail` — it only ever reflects fields the store
actually has.
State moves only via `alert_service.set_lifecycle` — never invented here.
"""
from __future__ import annotations

import uuid
from typing import Any

from .. import config
from ..utils.time import iso_now
from . import alert_service
from . import db
from .store_bridge import run

SEVERITIES = ("RED", "ORANGE", "YELLOW")
_NS = "demo_alerts"


def _load() -> dict[str, Any]:
    alerts = run(db.doc_all(_NS))
    if not isinstance(alerts, dict):
        return {"alerts": {}}
    return {"alerts": alerts}


def _save(data: dict[str, Any]) -> None:
    """Persist the given alert map. Deletions are explicit (delete()); this
    helper only upserts what it is given, matching the old JSON semantics."""
    alerts = data.get("alerts") or {}
    for aid, alert in alerts.items():
        run(db.doc_put(_NS, aid, alert))


def delete(alert_id: str) -> None:
    """Remove one alert (not exposed via API; used by tests)."""
    run(db.doc_delete(_NS, alert_id))


def reset_store() -> None:
    """Empty the store. Tests + the Admin panel's reset button use this."""
    run(db.doc_clear(_NS))


def _new_id() -> str:
    return f"demo-{uuid.uuid4().hex[:12]}"


def create(fields: dict[str, Any]) -> dict[str, Any]:
    """Create one UPCOMING alert. Raises ValueError on missing/invalid fields."""
    fields = dict(fields or {})
    title = str(fields.get("title") or "").strip()
    district = str(fields.get("district") or "").strip()
    if not title:
        raise ValueError("title is required")
    if not district:
        raise ValueError("district is required")
    severity = str(fields.get("severity") or "ORANGE").upper()
    if severity not in SEVERITIES:
        raise ValueError(f"severity must be one of {', '.join(SEVERITIES)}")
    now = iso_now()
    alert = {
        "id": _new_id(),
        "title": title,
        "hazard": str(fields.get("hazard") or "").strip(),
        "severity": severity,
        "district": district,
        "area": str(fields.get("area") or "").strip(),
        "instruction": str(fields.get("instruction") or "").strip(),
        "source": "demo",
        "pre_alert_at": fields.get("pre_alert_at"),
        "starts_at": fields.get("starts_at"),
        "ends_at": fields.get("ends_at"),
        # Full-lifecycle detail (alerts redesign): who issued it, why, effects.
        # Never invented: empty means the admin did not provide it.
        "issuer": str(fields.get("issuer") or "").strip(),
        "reason": str(fields.get("reason") or "").strip(),
        "effects": str(fields.get("effects") or "").strip(),
        "started_at": None,
        "completed_at": None,
        "state": "UPCOMING",
        "history": [{"at": now, "action": "create", "state": "UPCOMING"}],
        "created_at": now,
        "updated_at": now,
    }
    alert["lifecycle_detail"] = alert_service.lifecycle_detail(alert)
    run(db.doc_put(_NS, alert["id"], alert))
    return alert


def get(alert_id: str) -> dict[str, Any] | None:
    alert = run(db.doc_get(_NS, alert_id))
    if alert is not None:
        alert["lifecycle_detail"] = alert_service.lifecycle_detail(alert)
    return alert


def list_all(district: str = "") -> list[dict[str, Any]]:
    alerts = run(db.doc_all(_NS))
    if not isinstance(alerts, dict):
        return []
    items = list(alerts.values())
    if district:
        items = [a for a in items if str(a.get("district") or "").lower() == district.lower()]
    for a in items:
        if isinstance(a, dict):
            a["lifecycle_detail"] = alert_service.lifecycle_detail(a)
    return sorted(items, key=lambda a: str(a.get("created_at") or ""))


def apply_action(alert_id: str, action: str, patch: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str | None]:
    """Apply a lifecycle verb; returns (alert, error). Appends history on success.

    `patch` merges editable fields first (title/hazard/severity/district/area/
    instruction/pre_alert_at/starts_at/ends_at) so `update` can edit content
    while moving state.
    """
    alert = run(db.doc_get(_NS, alert_id))
    if alert is None:
        return None, "not-found"
    patch = dict(patch or {})
    for key in ("title", "hazard", "district", "area", "instruction",
                "pre_alert_at", "starts_at", "ends_at",
                # Full-lifecycle detail (alerts redesign): editable like the
                # other content fields.
                "issuer", "reason", "effects"):
        if key in patch and patch[key] is not None:
            alert[key] = patch[key]
    if "severity" in patch and patch["severity"] is not None:
        sev = str(patch["severity"]).upper()
        if sev not in SEVERITIES:
            return alert, f"bad-severity: {patch['severity']!r}"
        alert["severity"] = sev
    new_state, error = alert_service.set_lifecycle(alert, action)
    if error:
        alert["lifecycle_detail"] = alert_service.lifecycle_detail(alert)
        return alert, error
    now = iso_now()
    alert["updated_at"] = now
    # Full-lifecycle timestamps (alerts redesign): stamp when it actually
    # started, and when it reached a terminal state. Never backfilled or
    # guessed — an existing stamp is kept.
    if new_state == "ACTIVE" and not alert.get("started_at"):
        alert["started_at"] = now
    if new_state in alert_service.TERMINAL_STATES and not alert.get("completed_at"):
        alert["completed_at"] = now
    alert.setdefault("history", []).append(
        {"at": now, "action": alert_service.normalise_action(action), "state": new_state}
    )
    alert["lifecycle_detail"] = alert_service.lifecycle_detail(alert)
    run(db.doc_put(_NS, alert_id, alert))
    return alert, None


def transition(alert_id: str, action: str,
               patch: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str | None]:
    """Apply any lifecycle verb (pre-alert|activate|update|extend|cancel|end)."""
    return apply_action(alert_id, action, patch)


def update(alert_id: str, patch: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str | None]:
    """Edit content while moving ACTIVE/UPDATED/EXTENDED -> UPDATED."""
    return apply_action(alert_id, "update", patch)


def extend(alert_id: str, patch: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str | None]:
    """Push the validity window out (-> EXTENDED). Pass {ends_at} in patch."""
    return apply_action(alert_id, "extend", patch)


def cancel(alert_id: str) -> tuple[dict[str, Any] | None, str | None]:
    """Withdraw an UPCOMING/PRE-ALERT alert (-> CANCELLED, terminal)."""
    return apply_action(alert_id, "cancel")


def end(alert_id: str) -> tuple[dict[str, Any] | None, str | None]:
    """Close an active alert (-> ENDED, terminal)."""
    return apply_action(alert_id, "end")
