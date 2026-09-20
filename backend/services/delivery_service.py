"""Delivery ledger + coverage — how well did an alert actually reach people?

WHY THIS EXISTS
---------------
Issuing an alert answers "did we warn?". It does not answer "did the warning
REACH the affected area?" — the last-mile question an authority actually needs.
This module keeps one record per (alert, device) and turns it into the coverage
numbers the Authority dashboard shows: delivered / opened / acknowledged /
pending / offline / unreachable / P2P-relayed, plus a per-zone breakdown.

TERMINOLOGY (kept strict on purpose — the dashboard must not over-claim)
------------------------------------------------------------------------
DELIVERED    the push service accepted the notification for this device.
OPENED       the device told us the alert was opened.
ACKNOWLEDGED the user explicitly confirmed receipt on the device.
P2P_RELAYED  the alert reached the device through a device-to-device relay.
PENDING      queued, not yet confirmed.
OFFLINE      device was reachable but reported itself offline; delivery queued.
UNREACHABLE  the push service could not reach the device at all.

"Honest by construction": DELIVERED entries are written only from the push
service's real per-endpoint results. SIMULATED entries (the seeded audience
that makes the dashboard legible on a single laptop) are written by
`seed_audience` with `simulated=True` and are reported separately in every
coverage payload — a jury can always tell real devices from simulated ones.

PERSISTENCE
-----------
Through `services/db.py`: PostgreSQL when DATABASE_URL is set, JSON otherwise.
Each alert is a document keyed by alert_id in namespace "delivery".
"""
from __future__ import annotations

import random
from typing import Any

from ..utils.time import iso_now
from . import db
from .store_bridge import run

# Statuses a device record can hold.
STATUSES = ("PENDING", "DELIVERED", "OPENED", "ACKNOWLEDGED", "P2P_RELAYED",
            "OFFLINE", "UNREACHABLE")
# DELIVERED-like states that count as "reached".
REACHED = frozenset({"DELIVERED", "OPENED", "ACKNOWLEDGED", "P2P_RELAYED"})

ZONES = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE"]
_NS = "delivery"


def _empty() -> dict[str, Any]:
    return {"devices": {}, "simulated": {}}


def _load(alert_id: str) -> dict[str, Any]:
    doc = run(db.doc_get(_NS, alert_id))
    if not isinstance(doc, dict):
        return _empty()
    doc.setdefault("devices", {})
    doc.setdefault("simulated", {})
    return doc


def _save(alert_id: str, doc: dict[str, Any]) -> None:
    run(db.doc_put(_NS, alert_id, doc))


def record_issue(alert_id: str, results: list[dict[str, Any]], *, simulated: bool = False) -> int:
    """Write one DELIVERED/UNREACHABLE record per push result.

    `results` is push_service's per-device outcome list. Never raises: a ledger
    failure must not take down the push that already happened.
    """
    if not alert_id:
        return 0
    doc = _load(str(alert_id))
    written = 0
    for r in results or []:
        device = str(r.get("device") or "").strip()
        if not device:
            continue
        ok = bool(r.get("delivered"))
        # A later lifecycle push (pre-alert -> active -> ended) is a NEW delivery
        # of the same alert, not a reset of what the device already did with it.
        # Rebuilding the record with opened_at/acked_at = None silently discarded
        # the user's acknowledgement and dropped the dashboard's engagement count
        # back to zero — DELIVERED must never erase OPENED/ACKNOWLEDGED.
        existing = doc["devices"].get(device) or {}
        doc["devices"][device] = {
            "status": "DELIVERED" if ok else "UNREACHABLE",
            "reason": r.get("reason") or "",
            "channel": "push",
            "at": iso_now(),
            "opened_at": existing.get("opened_at"),
            "acked_at": existing.get("acked_at"),
            "simulated": bool(simulated),
            "zone": existing.get("zone"),
        }
        written += 1
    _save(str(alert_id), doc)
    return written


def record_pending(alert_id: str, devices: list[str]) -> int:
    """Mark devices PENDING when a broadcast failed before any per-device
    result existed (queued, not yet confirmed).

    This is the only path that writes a REAL (non-simulated) PENDING row: the
    caller retries the broadcast later (the watcher loop leaves the alert
    unmarked on broadcast failure), and the retry overwrites PENDING via
    record_issue. A device that already has any reach/engagement record keeps
    it — PENDING must never regress DELIVERED or P2P_RELAYED. Never raises.
    """
    if not alert_id:
        return 0
    doc = _load(str(alert_id))
    written = 0
    for device in devices or []:
        device = str(device or "").strip()
        if not device:
            continue
        existing = doc["devices"].get(device)
        if existing is not None:
            continue
        doc["devices"][device] = {
            "status": "PENDING", "reason": "broadcast failed; queued for retry",
            "channel": "push", "at": iso_now(),
            "opened_at": None, "acked_at": None,
            "simulated": False, "zone": None,
        }
        written += 1
    if written:
        _save(str(alert_id), doc)
    return written


def record_event(alert_id: str, device: str, event: str) -> dict[str, Any] | None:
    """OPENED / ACKNOWLEDGED from a device. Creates a self-reported record if
    the push ledger has none (the device may have been notified via P2P).

    Engagement never overwrites the reach CHANNEL: a P2P-relayed device that
    was opened is still counted as P2P-reached — otherwise a working relay
    would vanish from the coverage numbers the moment the user looked at the
    alert. Engagement is tracked by opened_at/acked_at and bucketed separately.
    """
    if not alert_id or not device:
        return None
    event = str(event or "").strip().lower()
    if event not in ("opened", "acknowledged"):
        return None
    doc = _load(str(alert_id))
    dev = doc["devices"].get(device)
    if dev is None:
        # Self-reported without a push record: assume P2P reach (device-to-device
        # is the only path that would deliver without our push ledger knowing).
        dev = doc["devices"][device] = {
            "status": "P2P_RELAYED", "reason": "self-reported", "channel": "p2p",
            "at": iso_now(), "opened_at": None, "acked_at": None,
            "simulated": False, "zone": None,
        }
    now = iso_now()
    if event == "opened" and not dev.get("opened_at"):
        dev["opened_at"] = now
    elif event == "acknowledged":
        dev["acked_at"] = now
        if not dev.get("opened_at"):
            dev["opened_at"] = now
    dev["last_event"] = event
    dev["last_event_at"] = now
    _save(str(alert_id), doc)
    return dev


def record_relay(alert_id: str, to_device: str, from_device: str = "relay") -> dict[str, Any] | None:
    """One P2P relay hop delivered the alert to `to_device`.

    Returns the row it wrote (or None when identifiers are missing) so a caller
    reporting the relay back to a device can show the resulting ledger state
    without reaching into the private `_load`.
    """
    if not alert_id or not to_device:
        return None
    doc = _load(str(alert_id))
    # Same rule as record_issue: reaching a device again does not un-open or
    # un-acknowledge what the user already confirmed.
    existing = doc["devices"].get(str(to_device)) or {}
    record = {
        "status": "P2P_RELAYED", "reason": f"relayed from {from_device}",
        "channel": "p2p", "at": iso_now(),
        "opened_at": existing.get("opened_at"), "acked_at": existing.get("acked_at"),
        "simulated": False, "zone": existing.get("zone"),
    }
    doc["devices"][str(to_device)] = record
    _save(str(alert_id), doc)
    return record


def seed_audience(alert_id: str, *, total: int = 500, seed: int = 7) -> dict[str, Any]:
    """Create a labelled SIMULATED audience for one alert.

    A laptop demo has one real device; an authority dashboard needs realistic
    volumes. This seeds `total` synthetic device records with a plausible
    delivery distribution, all marked `simulated: True` — and every coverage
    payload reports real and simulated numbers SEPARATELY, so the label can
    never get lost between the ledger and the screen.
    """
    total = max(0, min(int(total), 20000))
    rng = random.Random(f"{alert_id}:{seed}")
    doc = _load(str(alert_id))
    sim = doc["simulated"]
    sim.clear()
    now = iso_now()
    for i in range(total):
        roll = rng.random()
        if roll < 0.045:
            status = "UNREACHABLE"
        elif roll < 0.105:
            status = "OFFLINE"
        elif roll < 0.165:
            status = "P2P_RELAYED"
        elif roll < 0.215:
            status = "PENDING"
        else:
            status = "DELIVERED"
        # Channel stays the channel; engagement lives in opened_at/acked_at
        # exactly like real device records — bucketing treats simulated and
        # real audiences identically.
        opened = status in ("DELIVERED", "P2P_RELAYED") and rng.random() < 0.85
        acked = opened and rng.random() < 0.62
        sim[f"sim-{i:05d}"] = {
            "status": status,
            "reason": "" if status in REACHED else status.lower(),
            "channel": "p2p" if status == "P2P_RELAYED" else "push",
            "at": now, "opened_at": now if opened else None,
            "acked_at": now if acked else None,
            "simulated": True,
            "zone": ZONES[i % len(ZONES)],
        }
    doc["seeded"] = {"total": total, "seed": seed, "at": now}
    _save(str(alert_id), doc)
    return {"alert_id": str(alert_id), "seeded": total}


def clear_seeded(alert_id: str) -> dict[str, Any]:
    doc = _load(str(alert_id))
    doc["simulated"] = {}
    doc.pop("seeded", None)
    _save(str(alert_id), doc)
    return {"alert_id": str(alert_id), "seeded": 0}


def _bucket(devices: dict[str, dict]) -> dict[str, int]:
    """Buckets by REACH CHANNEL (DELIVERED vs P2P_RELAYED); engagement is not a
    channel and must never hide one. A P2P-relayed device that was opened is
    still P2P-reached — otherwise a working relay would vanish from coverage
    the moment the user looked at the alert. Each device lands in exactly one
    bucket — no double counting."""
    counts = {s: 0 for s in STATUSES}
    for d in devices.values():
        status = d.get("status")
        if status in ("UNREACHABLE", "OFFLINE", "PENDING", "DELIVERED", "P2P_RELAYED"):
            counts[status] += 1
        else:
            counts["PENDING"] += 1
    return counts


def coverage(alert_id: str) -> dict[str, Any] | None:
    """The dashboard payload for one alert: real + simulated, kept apart."""
    doc = run(db.doc_get(_NS, str(alert_id)))
    if not isinstance(doc, dict):
        return None
    doc.setdefault("devices", {})
    doc.setdefault("simulated", {})
    real = _bucket(doc["devices"])
    sim = _bucket(doc["simulated"])

    def merge(bucket: dict[str, int]) -> dict[str, int]:
        out = dict(bucket)
        out["reached"] = sum(bucket.get(s, 0) for s in REACHED)
        return out

    def zones_for(bucket: dict[str, dict]) -> list[dict[str, Any]]:
        per = {z: {"total": 0, "reached": 0} for z in ZONES}
        for d in bucket.values():
            z = d.get("zone")
            if z not in per:
                continue
            per[z]["total"] += 1
            if d.get("status") in REACHED:
                per[z]["reached"] += 1
        return [
            {"zone": z, "total": per[z]["total"], "reached": per[z]["reached"],
             "pct": round(100 * per[z]["reached"] / per[z]["total"]) if per[z]["total"] else 0}
            for z in ZONES
        ]

    real_devs = doc["devices"]
    sim_devs = doc["simulated"]
    # Engagement is a separate lens over the SAME devices — never a bucket that
    # hides the reach channel.
    def engagement(bucket: dict[str, dict]) -> dict[str, int]:
        return {
            "opened": sum(1 for d in bucket.values() if d.get("opened_at")),
            "acknowledged": sum(1 for d in bucket.values() if d.get("acked_at")),
        }

    eng_real = engagement(real_devs)
    eng_sim = engagement(sim_devs)
    # Real devices have no home zone (a push endpoint is not a place); simulated
    # ones carry zones so the grid can show uneven last-mile reach.
    return {
        "alert_id": str(alert_id),
        "real": {**merge(real), "engagement": eng_real,
                 "zones": zones_for({k: {**v, "zone": "C"} for k, v in real_devs.items()})},
        "simulated": {**merge(sim), "engagement": eng_sim, "zones": zones_for(sim_devs),
                      "label": "SIMULATED AUDIENCE"},
        "seeded": doc.get("seeded"),
        "generated_at": iso_now(),
    }


def coverage_summary() -> list[dict[str, Any]]:
    """One row per tracked alert, for the dashboard's alert picker."""
    docs = run(db.doc_all(_NS))
    if not isinstance(docs, dict):
        return []
    rows = []
    for alert_id, doc in docs.items():
        if not isinstance(doc, dict):
            continue
        devices = doc.get("devices") or {}
        sim = doc.get("simulated") or {}

        def m(bucket: dict[str, dict]) -> dict[str, int]:
            b = _bucket(bucket)
            b["reached"] = sum(b.get(s, 0) for s in REACHED)
            return b

        rows.append({
            "alert_id": alert_id,
            "real": m(devices),
            "simulated": m(sim),
            "seeded": doc.get("seeded"),
        })
    return rows


def reset_store() -> None:
    run(db.doc_clear(_NS))
