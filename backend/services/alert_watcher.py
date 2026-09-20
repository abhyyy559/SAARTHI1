"""Background alert watcher — decides when to wake a sleeping phone.

This is the piece that makes the notification feature real. It runs on the
SERVER, independent of any browser, so a user who never opens the app still
gets told when a warning starts for their district and when it clears.

It reuses `verdict_service.build_verdict` — the same call the UI renders. If it
derived severity itself, the push and the screen could disagree, which is the
exact failure the verdict module was written to prevent.

WHAT IT WILL NOT DO
-------------------
- It will not send an all-clear on an unconfirmed verdict. "We could not check"
  is not "you are safe", and a phone that says safe because the feed broke is
  worse than a phone that stays quiet.
- It will not re-send the same event. Each district's last verdict is persisted,
  so a restart does not re-notify everyone.
- It will not notify on the very first verdict it computes for a district. A
  fresh install should not buzz about a warning that is already old news; pushes
  are for CHANGES.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

from .. import config
from . import alert_service, push_service
from . import db, delivery_service, notification_service
from .location_service import LocationService
from .store_bridge import run
from .verdict_service import build_verdict

log = logging.getLogger("weathergpt.watcher")

RANK = {"MODERATE": 1, "HIGH": 2, "CRITICAL": 3}

# How often to re-check the NETWORK sources. CAP bulletins are issued on the
# scale of hours, so five minutes is responsive without hammering NDMA.
DEFAULT_INTERVAL = 300

# How often to run the LOCAL lifecycle pass (advance + notify demo alerts). No
# network involved, and the one-tap scenarios are timed for a 10s loop.
DEMO_TICK_DEFAULT = 10


_STATE_KEY = "alert_watch_state"


def _load_state() -> dict[str, Any]:
    """Watcher state through services/db.py: Postgres when configured, else the
    JSON file beside the cache. Losing this state means re-notifying everyone —
    exactly what the persistence layer exists to prevent."""
    state = run(db.kv_get(_STATE_KEY))
    return state if isinstance(state, dict) else {}


def _save_state(state: dict[str, Any]) -> None:
    run(db.kv_set(_STATE_KEY, state))


def hazard_of(verdict: dict[str, Any] | None) -> str | None:
    """Confirmed hazard level, or None. Mirrors alertWatch.js on the client."""
    if not verdict or not verdict.get("confirmed"):
        return None
    level = str(verdict.get("level") or "").upper()
    return level if level in RANK else None


def decide(prev: dict[str, Any] | None, nxt: dict[str, Any]) -> str | None:
    """'start' | 'escalate' | 'clear' | None. The safety rule lives here."""
    was, now = hazard_of(prev), hazard_of(nxt)

    if prev is None:
        return None  # first sighting: record, never announce

    if not was and now:
        return "start"
    if was and now and RANK[now] > RANK[was]:
        return "escalate"
    if was and not now:
        # Only a confirmed LOW is an all-clear.
        if nxt.get("confirmed") and str(nxt.get("level") or "").upper() == "LOW":
            return "clear"
        return None
    return None


def message_for(kind: str, verdict: dict[str, Any], district: str) -> dict[str, Any]:
    """The push payload. Short: it is read on a lock screen.

    Kinds `pre-alert` / `active` / `ended` are the demo-alert lifecycle kinds
    (explicit Admin-panel actions); they reuse the same shape so the client
    needs no second code path.
    """
    severity = verdict.get("severity") or verdict.get("level") or ""
    hazard = verdict.get("hazard") or ""
    if kind == "clear" or kind == "ended":
        title = "Safe now"
        body = (f"The {hazard} warning for {district} has ended."
                if hazard else f"The weather warning for {district} has ended.")
    elif kind == "escalate":
        title = "Warning upgraded"
        body = f"Now {severity} for {district} — {hazard}."
    elif kind == "pre-alert":
        title = "Alert incoming"
        body = (f"{severity} {hazard} expected in {district}. Get ready."
                if hazard else f"A weather alert is expected in {district}. Get ready.")
    elif kind == "active":
        title = "Weather alert"
        body = f"{severity} {hazard} warning for {district}. Avoid going out unless you must."
    elif kind == "updated":
        title = "Alert update"
        body = f"{severity} {hazard} conditions continue for {district}. Latest official guidance applies."
    elif kind == "extended":
        title = "Alert extended"
        body = f"The {hazard} warning for {district} has been extended. Stay alert until it ends."
    elif kind == "cancelled":
        title = "Alert cancelled"
        body = f"The weather alert for {district} was cancelled by the issuing authority."
    else:
        title = "Weather alert"
        body = f"{severity} {hazard} warning for {district}. Avoid going out unless you must."
    return {
        "title": title,
        "body": " ".join(body.split()),
        "severity": severity,
        "hazard": hazard,
        "district": district,
        "kind": kind,
        # Tapping the OS notification lands on the Notification Center, where
        # the full lifecycle trail is readable even hours later.
        "url": "/?view=notifications",
    }


# Demo-alert lifecycle states that push, and the push kind each maps to.
# UPDATED/EXTENDED re-announce as `active` so an open phone shows the change.
_DEMO_NOTIFY: dict[str, str] = {
    "PRE-ALERT": "pre-alert",
    "ACTIVE": "active",
    "UPDATED": "updated",
    "EXTENDED": "extended",
    "ENDED": "ended",
    "CANCELLED": "cancelled",
}


def demo_message_for(alert: dict[str, Any], kind: str) -> dict[str, Any]:
    """Build a push payload from a demo-store alert (same shape as CAP).

    The `tag` collapses repeat notifications for the same (alert, kind) on the
    device; `alert_id` lets the client deep-link to Alert Details.
    """
    payload = message_for(kind, {
        "severity": alert.get("severity") or "",
        "level": alert.get("severity") or "",
        "hazard": alert.get("hazard") or alert.get("title") or "",
    }, str(alert.get("district") or ""))
    payload["alert_id"] = alert.get("id")
    payload["tag"] = f"demo-{alert.get('id')}-{kind}"
    payload["demo"] = True
    return payload


def check_demo_alerts() -> list[dict[str, Any]]:
    """Broadcast demo alerts that entered a notifying state. Never raises.

    Explicit demo actions MUST notify immediately — a human pressed the button
    on stage, so there is no first-sighting silence here (that rule stays for
    CAP verdicts in `decide`). De-duplication is per (alert_id, state): each
    lifecycle entry notifies exactly once, even across restarts.

    Every broadcast is also (a) written to the notification log — the in-app
    Notification Center renders exactly what was pushed, nothing more — and
    (b) written to the delivery ledger per device from the push service's own
    results, so coverage numbers describe what actually happened.
    """
    try:
        from . import demo_alert_store
    except Exception:  # noqa: BLE001 - store import must not break the loop
        return []
    try:
        alerts = demo_alert_store.list_all()
    except Exception:  # noqa: BLE001 - one bad store read must not stop the loop
        return []
    state = _load_state()
    seen = state.setdefault("_demo_notified", {})
    if not isinstance(seen, dict):
        seen = state["_demo_notified"] = {}
    results: list[dict[str, Any]] = []
    dirty = False
    for alert in alerts:
        alert_state = str(alert.get("state") or "").upper()
        kind = _DEMO_NOTIFY.get(alert_state)
        if not kind:
            continue
        key = f"{alert.get('id')}:{alert_state}"
        if key in seen:
            continue
        payload = demo_message_for(alert, kind)
        payload["alert_id"] = alert.get("id")
        district = str(alert.get("district") or "")
        try:
            result = push_service.broadcast(payload, district=district)
        except Exception as exc:  # noqa: BLE001 - one bad broadcast must not stop the rest
            results.append({"district": district, "alert_id": alert.get("id"),
                            "error": f"{type(exc).__name__}: {exc}"})
            continue
        seen[key] = payload.get("body", "")
        dirty = True
        # The push happened: record it in the history the user scrolls, and in
        # the ledger the authority dashboard counts. Both must never raise.
        try:
            notification_service.log(
                kind, payload.get("title", ""), payload.get("body", ""),
                district=district, alert_id=str(alert.get("id") or ""),
                severity=str(alert.get("severity") or ""),
                push={k: result.get(k) for k in ("targeted", "delivered", "failed", "pruned")},
            )
            delivery_service.record_issue(str(alert.get("id") or ""), result.get("results") or [])
        except Exception as exc:  # noqa: BLE001 - bookkeeping must not stop alerts
            log.warning("notification/delivery bookkeeping failed: %s", exc)
        log.info("push demo %s for %s -> %s", kind, district, result)
        results.append({"district": district, "alert_id": alert.get("id"),
                        "level": alert.get("severity"), "notified": kind,
                        "demo": True, "push": result})
    if dirty:
        _save_state(state)
    return results


def auto_advance_demo() -> list[dict[str, Any]]:
    """Move demo alerts through their SCHEDULED lifecycle by the clock.

    An alert with pre_alert_at/starts_at/ends_at set advances itself when the
    wall clock crosses each boundary: UPCOMING -> PRE-ALERT at pre_alert_at,
    -> ACTIVE at starts_at, -> ENDED at ends_at. The state machine in
    `alert_service.VALID_TRANSITIONS` stays the only mover of state; this just
    chooses the verb from time instead of a button press.

    Returns the actions taken, so the watcher pass and the API can report them.
    """
    try:
        from . import demo_alert_store
    except Exception:  # noqa: BLE001
        return []
    taken: list[dict[str, Any]] = []
    try:
        from datetime import datetime
        from ..utils.time import IST

        def _parse(value: Any) -> datetime | None:
            if not value:
                return None
            try:
                dt = datetime.fromisoformat(str(value))
                return dt if dt.tzinfo else dt.replace(tzinfo=IST)
            except ValueError:
                return None

        from ..utils.time import now_ist
        now = now_ist()
        for alert in demo_alert_store.list_all():
            aid = str(alert.get("id") or "")
            state = str(alert.get("state") or "").upper()
            starts = _parse(alert.get("starts_at"))
            ends = _parse(alert.get("ends_at"))
            pre = _parse(alert.get("pre_alert_at"))
            if state in ("UPCOMING", "PRE-ALERT") and ends and now >= ends:
                alert, _err = demo_alert_store.apply_action(aid, "cancel")
                if alert:
                    taken.append({"alert_id": aid, "action": "cancel", "state": alert["state"]})
                continue
            if state in ("UPCOMING", "PRE-ALERT") and starts and now >= starts:
                alert, _err = demo_alert_store.apply_action(aid, "activate")
                if alert:
                    taken.append({"alert_id": aid, "action": "activate", "state": alert["state"]})
                continue
            if pre and state == "UPCOMING" and now >= pre:
                alert, _err = demo_alert_store.apply_action(aid, "pre-alert")
                if alert:
                    taken.append({"alert_id": aid, "action": "pre-alert", "state": alert["state"]})
                continue
            if state in ("ACTIVE", "UPDATED", "EXTENDED") and ends and now >= ends:
                alert, _err = demo_alert_store.apply_action(aid, "end")
                if alert:
                    taken.append({"alert_id": aid, "action": "end", "state": alert["state"]})
    except Exception as exc:  # noqa: BLE001 - the loop must survive anything
        log.warning("demo auto-advance failed: %s", exc)
    return taken


async def check_district(district: str) -> dict[str, Any]:
    """Compute one district's verdict and push if it changed. Never raises."""
    loc = LocationService().lookup(district) or {"district": district, "latitude": None, "longitude": None}
    try:
        gathered = await alert_service.gather_alerts(
            lat=loc.get("latitude"), lon=loc.get("longitude"),
            district=district, state=loc.get("state") or "",
        )
    except Exception as exc:  # noqa: BLE001 - one bad district must not stop the loop
        return {"district": district, "error": f"{type(exc).__name__}: {exc}"}

    verdict = build_verdict(
        cap_alerts=gathered["relevant"],
        nearby_alerts=gathered["nearby"],
        # Availability is passed through truthfully, never assumed. This loop
        # never calls IMD's district-warning endpoint, so the only warning
        # sources it has are the alert feeds; with all of them unreachable
        # `gathered` is empty and a hardcoded True made that a CONFIRMED calm —
        # which `decide` turns into "Safe now", an all-clear invented from a
        # network failure. Unconfirmed here means no push at all, which is the
        # safe direction.
        warning_service_available=gathered.get("available", False),
    )

    state = _load_state()
    prev = state.get(district)
    kind = decide(prev, verdict)
    state[district] = verdict
    _save_state(state)

    if not kind:
        return {"district": district, "level": verdict.get("level"), "notified": None}

    payload = message_for(kind, verdict, district)
    result = push_service.broadcast(payload, district=district)
    log.info("push %s for %s -> %s", kind, district, result)
    return {"district": district, "level": verdict.get("level"), "notified": kind, "push": result}


async def check_all() -> list[dict[str, Any]]:
    """One pass over every district anyone is subscribed to."""
    districts = sorted({s.get("district") for s in push_service.subscriptions() if s.get("district")})
    if not districts:
        return []
    return [await check_district(d) for d in districts]


# The demo lifecycle loop is FASTER than the CAP loop: a scheduled demo alert
# advances within seconds of its boundary crossing, so the stage demo shows the
# lifecycle live instead of five minutes later.
DEMO_INTERVAL = 10


async def run_forever(interval: int = DEFAULT_INTERVAL, tick: int | None = None) -> None:
    """The loop. Started from the app lifespan; cancelled on shutdown.

    TWO CADENCES, because the two jobs have nothing in common cost-wise:

      * the LOCAL pass — advance any scheduled demo alert whose time boundary
        crossed, then notify every newly entered lifecycle state. It touches
        only the local store, so it runs every `tick` seconds. The on-stage
        scenarios depend on that: they schedule pre-alert at ~12s and ACTIVE at
        ~40s.
      * the NETWORK pass — re-check every subscribed district against CAP/IMD/
        Open-Meteo. Bulletins are issued on the scale of hours, so this keeps
        the slow `interval` and does not hammer NDMA.

    One shared cadence was the bug: on the 300s network interval the pre-alert
    push could arrive up to five minutes late, by which time the demo alert had
    already ended — the lifecycle the jury is meant to watch never landed.

    Order inside a pass matters: the advance must land before the notify pass
    sees the state, so the user is told about the NEW state, not the old one.
    """
    tick = tick or int(getattr(config, "DEMO_TICK", DEMO_TICK_DEFAULT) or DEMO_TICK_DEFAULT)
    if tick <= 0:
        tick = DEMO_TICK_DEFAULT
    log.info("alert watcher started (lifecycle every %ss, network every %ss)", tick, interval)

    last_net = 0.0  # 0.0 forces a network pass on the very first loop
    while True:
        try:
            advanced = auto_advance_demo()
            demo_results = check_demo_alerts()
            if advanced:
                log.info("demo lifecycle advanced: %s", advanced)

            results: list[dict[str, Any]] = []
            now = time.monotonic()
            if now - last_net >= interval:
                last_net = now
                results = await check_all()

            notified = [r for r in results if r.get("notified")]
            if results or demo_results:
                log.info("watcher pass: %d district(s), %d CAP notification(s), %d demo notification(s)",
                         len(results), len(notified), len(demo_results))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - the loop must survive anything
            log.warning("watcher pass failed: %s: %s", type(exc).__name__, exc)
        await asyncio.sleep(tick)


def status() -> dict[str, Any]:
    state = _load_state()
    return {
        "subscribed_districts": sorted({s.get("district") for s in push_service.subscriptions() if s.get("district")}),
        "subscriptions": push_service.count(),
        "push_available": push_service.push_available(),
        "last_verdicts": {
            d: {"level": v.get("level"), "confirmed": v.get("confirmed"), "at": v.get("detail")}
            for d, v in state.items()
            # The same store also holds internal bookkeeping under an underscore
            # key (`_demo_notified`). It is not a district, and reporting it as
            # one put a null-level "district" in /api/push/status.
            if not str(d).startswith("_") and isinstance(v, dict)
        },
        "interval_seconds": int(getattr(config, "ALERT_WATCH_INTERVAL", DEFAULT_INTERVAL)),
        "demo_tick_seconds": int(getattr(config, "DEMO_TICK", DEMO_TICK_DEFAULT)),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
