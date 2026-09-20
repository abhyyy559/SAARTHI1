"""Web Push — deliver a warning when the app is CLOSED.

WHY THIS EXISTS
---------------
The whole point of the notification feature is a user who never opens the app:
a fisherman on a boat at 5am, a farmer asleep, a driver on a highway. An
in-app notification cannot reach any of them. That needs the browser's push
service, which needs three things this module provides:

  1. a VAPID key pair, so the push service knows who is sending;
  2. stored subscriptions, so we know who to send to;
  3. a sender that encrypts the payload end-to-end (aes128gcm) — the push
     service relays it without ever being able to read it.

WHAT IS STILL REQUIRED, STATED PLAINLY
--------------------------------------
The SERVER must be running. Push is not magic: our backend decides a warning
started and asks the push service to wake the device. If this process is down,
nobody is notified. The phone does not need to be awake, the server does.

HTTPS is required by every browser for Web Push, with `localhost` exempt. So
this works in local development and needs TLS in production.

Deliberately NOT stored here: anything about the person. A subscription is an
opaque endpoint plus two public keys — enough to notify, not enough to identify.
"""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from .. import config
from . import db
from .store_bridge import run

log = logging.getLogger("weathergpt.push")

# The push service tells us the subscription is gone with 404/410. That is the
# only correct time to delete one: anything else (a timeout, a 500) is a
# temporary failure and dropping the subscription would silently unsubscribe a
# real user.
_GONE_CODES = {404, 410}


def _store_path() -> Path:
    return Path(getattr(config, "CACHE_FILE", "weathergpt_cache.json")).parent / "push_subscriptions.json"


def _keys_path() -> Path:
    return Path(getattr(config, "CACHE_FILE", "weathergpt_cache.json")).parent / "vapid_keys.json"


# --------------------------------------------------------------------------
# VAPID keys
# --------------------------------------------------------------------------

def _generate_keys() -> tuple[str, str]:
    """A fresh P-256 key pair: (private PEM, public base64url point)."""
    private = ec.generate_private_key(ec.SECP256R1())
    private_pem = private.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_point = private.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    # The browser wants the raw uncompressed point, base64url, unpadded.
    public_b64 = base64.urlsafe_b64encode(public_point).decode("ascii").rstrip("=")
    return private_pem, public_b64


def vapid_keys() -> tuple[str, str]:
    """(private_pem, public_b64). Generated once and reused.

    Regenerating would invalidate every existing subscription, so the file is
    the source of truth. Env vars win when set, so a deployment can pin the pair
    across restarts and instances.
    """
    env_priv = getattr(config, "VAPID_PRIVATE_KEY", "") or ""
    env_pub = getattr(config, "VAPID_PUBLIC_KEY", "") or ""
    if env_priv and env_pub:
        return env_priv, env_pub

    path = _keys_path()
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("private") and data.get("public"):
                return data["private"], data["public"]
    except Exception:  # noqa: BLE001 - a corrupt file is regenerated below
        log.warning("vapid key file unreadable; regenerating")

    private_pem, public_b64 = _generate_keys()
    try:
        path.write_text(json.dumps({"private": private_pem, "public": public_b64}), encoding="utf-8")
    except Exception:  # noqa: BLE001 - read-only fs: keys live for this process only
        log.warning("could not persist vapid keys; subscriptions will not survive a restart")
    return private_pem, public_b64


def public_key() -> str:
    return vapid_keys()[1]


def push_available() -> bool:
    try:
        import pywebpush  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


# --------------------------------------------------------------------------
# Subscriptions
# --------------------------------------------------------------------------
# Persisted through services/db.py: PostgreSQL when DATABASE_URL is set (so a
# redeploy does not silently unsubscribe every device), JSON files otherwise.
# Doc id == the subscription endpoint, which is unique by construction.
_SUBS_NS = "push_subscriptions"


def _load() -> list[dict[str, Any]]:
    docs = run(db.doc_all(_SUBS_NS))
    if not isinstance(docs, dict):
        return []
    return [sub for sub in docs.values() if isinstance(sub, dict) and sub.get("endpoint")]


def _save(items: list[dict[str, Any]]) -> None:
    """Upsert every item (full-list writer kept for existing callers).
    Deletions go through `unsubscribe`, which removes the doc by id."""
    for sub in items:
        if isinstance(sub, dict) and sub.get("endpoint"):
            run(db.doc_put(_SUBS_NS, sub["endpoint"], sub))


def subscribe(subscription: dict[str, Any], district: str = "", language: str = "en",
              persona: str = "general") -> dict[str, Any]:
    """Store or refresh one subscription. Keyed by endpoint, which is unique."""
    endpoint = (subscription or {}).get("endpoint")
    if not endpoint:
        raise ValueError("subscription.endpoint is required")
    keys = subscription.get("keys") or {}
    if not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("subscription.keys.p256dh and .auth are required")

    items = [s for s in _load() if s.get("endpoint") != endpoint]
    items.append({
        "endpoint": endpoint,
        "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
        # What to notify about. Only the district is needed to decide relevance;
        # language and persona shape the wording.
        "district": district or "",
        "language": language or "en",
        "persona": persona or "general",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    _save(items)
    return {"endpoint": endpoint, "district": district, "total": len(items)}


def unsubscribe(endpoint: str) -> dict[str, Any]:
    items = _load()
    kept = [s for s in items if s.get("endpoint") != endpoint]
    if len(kept) != len(items):
        run(db.doc_delete(_SUBS_NS, endpoint))
    return {"removed": len(items) - len(kept), "total": len(kept)}


def subscriptions(district: str = "") -> list[dict[str, Any]]:
    items = _load()
    if district:
        return [s for s in items if (s.get("district") or "").lower() == district.lower()]
    return items


def count() -> int:
    return len(_load())


# --------------------------------------------------------------------------
# Sending
# --------------------------------------------------------------------------

def send_one(subscription: dict[str, Any], payload: dict[str, Any]) -> tuple[bool, str]:
    """Deliver to one subscription. Returns (delivered, reason).

    Never raises: a push failure must not take down the watcher that is
    protecting everyone else.
    """
    if not push_available():
        return False, "pywebpush not installed"
    from pywebpush import WebPushException, webpush

    private_pem, _ = vapid_keys()
    try:
        webpush(
            subscription_info={
                "endpoint": subscription["endpoint"],
                "keys": {"p256dh": subscription["keys"]["p256dh"], "auth": subscription["keys"]["auth"]},
            },
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=private_pem,
            # Required by the spec; identifies the sender to the push service.
            vapid_claims={"sub": getattr(config, "VAPID_SUBJECT", "") or "mailto:ops@weathergpt.local"},
            # On a stage with no internet a push attempt hangs until timeout; a
            # long one stalls every lifecycle action (a button press waits for
            # the whole broadcast). 3s is enough for any real push service.
            timeout=3,
        )
        return True, "delivered"
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in _GONE_CODES:
            return False, "gone"
        return False, f"webpush {status or type(exc).__name__}"
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}: {exc}"


def broadcast(payload: dict[str, Any], district: str = "") -> dict[str, Any]:
    """Send to every subscriber, optionally only those watching one district.

    Expired subscriptions are pruned as they are discovered, so a dead device
    stops being retried forever.

    The return value includes per-device `results` ({device, delivered, reason})
    so the delivery ledger can record DELIVERED/UNREACHABLE per endpoint —
    coverage numbers must come from what actually happened, not from a guess.
    """
    targets = subscriptions(district)
    delivered, gone, failed = 0, [], 0
    results = []
    for sub in targets:
        ok, reason = send_one(sub, payload)
        results.append({"device": sub.get("endpoint", ""), "delivered": ok, "reason": reason})
        if ok:
            delivered += 1
        elif reason == "gone":
            gone.append(sub["endpoint"])
        else:
            failed += 1
            log.info("push failed for %s: %s", sub["endpoint"][:40], reason)

    if gone:
        gone_set = set(gone)
        for endpoint in gone_set:
            run(db.doc_delete(_SUBS_NS, endpoint))

    # Feed the district telemetry (Round2 T3.3): every real push outcome becomes
    # a delivered/unreachable event when the payload carries an alert id. Never
    # raises — bookkeeping must not touch the push result above.
    try:
        _alert_id = str((payload or {}).get("alert_id") or "")
        if _alert_id:
            for r in results:
                record_event(r.get("device") or "",
                             _alert_id,
                             "delivered" if r.get("delivered") else "unreachable",
                             district=district)
    except Exception:  # noqa: BLE001
        pass

    return {"targeted": len(targets), "delivered": delivered, "pruned": len(gone),
            "failed": failed, "results": results}


# --------------------------------------------------------------------------
# Telemetry (ack/delivery aggregate per district — Round2 T3.3)
# --------------------------------------------------------------------------
# WHY THIS EXISTS
# ---------------
# The delivery ledger (delivery_service) answers "did alert X reach its devices?".
# The Authority Coverage Dashboard ALSO needs "how is district Y doing across
# alerts?" — delivered / opened / acknowledged / pending / offline /
# unreachable / P2P-relayed, plus a per-district (zone) breakdown. That is what
# lives here: one small document per district, fed by POST /api/ack and by the
# broadcast outcomes below.
#
# DISCIPLINE: every function here never raises. Telemetry is bookkeeping — a
# store outage must not 500 an alert, an ack, or a push.
TELEMETRY_EVENTS = ("delivered", "opened", "acknowledged", "pending",
                    "offline", "unreachable", "p2p_relayed")
# Reached states: the device has the alert by some channel.
TELEMETRY_REACHED = frozenset({"delivered", "opened", "acknowledged", "p2p_relayed"})
_TELEMETRY_ALIASES = {
    "ack": "acknowledged", "acked": "acknowledged", "acknowledge": "acknowledged",
    "open": "opened", "p2p": "p2p_relayed", "p2p_relay": "p2p_relayed",
    "undelivered": "unreachable", "failed": "unreachable",
}
_TELEMETRY_NS = "push_telemetry"
_UNKNOWN_DISTRICT = "_unknown"


def _norm_telemetry_event(event: Any) -> str | None:
    """Lowercased canonical event name, or None when unknown."""
    raw = str(event or "").strip().lower()
    raw = _TELEMETRY_ALIASES.get(raw, raw)
    return raw if raw in TELEMETRY_EVENTS else None


def _telemetry_key(endpoint: str, alert_id: str) -> str:
    return f"{endpoint}||{alert_id}"


def record_event(endpoint: str, alert_id: str, event: str,
                 district: str = "") -> dict[str, Any] | None:
    """Record one device's delivery event. Returns the stored record, or None
    when the event is unknown / identifiers are missing. Never raises.

    Idempotent per (endpoint, alert_id): a re-ack overwrites the same slot, so
    retries and double-taps cannot inflate the coverage numbers.
    """
    try:
        endpoint = str(endpoint or "").strip()
        alert_id = str(alert_id or "").strip()
        norm = _norm_telemetry_event(event)
        if not endpoint or not alert_id or norm is None:
            return None
        district = str(district or "").strip()
        ns_key = district.lower() or _UNKNOWN_DISTRICT
        doc = run(db.doc_get(_TELEMETRY_NS, ns_key))
        if not isinstance(doc, dict):
            doc = {}
        doc["district"] = district or doc.get("district", "")
        devices = doc.setdefault("devices", {})
        if not isinstance(devices, dict):
            devices = doc["devices"] = {}
        devices[_telemetry_key(endpoint, alert_id)] = {
            "endpoint": endpoint,
            "alert_id": alert_id,
            "event": norm,
            "district": district,
            "at": datetime.now(timezone.utc).isoformat(),
        }
        run(db.doc_put(_TELEMETRY_NS, ns_key, doc))
        return {"endpoint": endpoint, "alert_id": alert_id,
                "event": norm, "district": district}
    except Exception as exc:  # noqa: BLE001 - telemetry must never break alerts
        log.warning("telemetry record failed: %s: %s", type(exc).__name__, exc)
        return None


def coverage(district: str = "") -> dict[str, Any]:
    """Aggregate counts (+ per-district zones) for one district, or every
    district when `district` is empty. Never raises — returns zeros on failure.
    """
    empty_counts = {e: 0 for e in TELEMETRY_EVENTS}

    def _empty_payload() -> dict[str, Any]:
        return {"district": district, "counts": dict(empty_counts), "total": 0,
                "reached": 0, "zones": []}

    try:
        district = str(district or "").strip()
        if district:
            doc = run(db.doc_get(_TELEMETRY_NS, district.lower() or _UNKNOWN_DISTRICT))
            docs = {district.lower(): doc} if isinstance(doc, dict) else {}
        else:
            docs = run(db.doc_all(_TELEMETRY_NS))
            if not isinstance(docs, dict):
                docs = {}
        counts = dict(empty_counts)
        zones: list[dict[str, Any]] = []
        for key, doc in docs.items():
            if not isinstance(doc, dict):
                continue
            devices = doc.get("devices") or {}
            if not isinstance(devices, dict):
                continue
            z_total, z_reached = 0, 0
            for rec in devices.values():
                if not isinstance(rec, dict):
                    continue
                ev = rec.get("event")
                if ev not in counts:
                    continue
                counts[ev] += 1
                z_total += 1
                if ev in TELEMETRY_REACHED:
                    z_reached += 1
            label = doc.get("district") or key
            zones.append({
                "zone": label,
                "total": z_total,
                "reached": z_reached,
                "pct": round(100 * z_reached / z_total) if z_total else 0,
            })
        total = sum(counts.values())
        reached = sum(counts[e] for e in TELEMETRY_REACHED)
        zones.sort(key=lambda z: z["zone"].lower())
        return {"district": district, "counts": counts, "total": total,
                "reached": reached, "zones": zones}
    except Exception as exc:  # noqa: BLE001 - telemetry must never break callers
        log.warning("telemetry coverage failed: %s: %s", type(exc).__name__, exc)
        return _empty_payload()


def reset_telemetry() -> dict[str, Any]:
    """Clear the telemetry store (demo reset / tests). Never raises."""
    try:
        run(db.doc_clear(_TELEMETRY_NS))
        return {"status": "reset"}
    except Exception as exc:  # noqa: BLE001
        log.warning("telemetry reset failed: %s: %s", type(exc).__name__, exc)
        return {"status": "error", "reason": f"{type(exc).__name__}: {exc}"}
