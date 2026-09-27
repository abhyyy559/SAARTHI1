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
from urllib.parse import quote

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

# How often to re-check subscribed districts against the official CAP/IMD chain.
# Bulletins are issued on the scale of hours; the 10s value keeps the loop
# responsive to reconnects without hammering NDMA (the network pass itself is
# guarded by the 300s `interval` inside run_forever).
WATCH_TICK_DEFAULT = config.WATCH_TICK


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


def _alert_url(alert_id: str | None) -> str:
    """Where a tap on the OS notification lands: the alerts view, deep-linked
    to the alert when its id is known. The app reads ?view=alerts on launch;
    &alert= is the per-alert deep link the SW passes through on notification
    tap (payload.alert_id travels alongside in the notification data)."""
    url = "/?view=alerts"
    if alert_id:
        url += "&alert=" + quote(str(alert_id), safe="")
    return url


def message_for(kind: str, verdict: dict[str, Any], district: str,
                alert_id: str | None = None) -> dict[str, Any]:
    """The push payload. Short: it is read on a lock screen.

    Kinds `pre-alert` / `active` / `ended` are alert-lifecycle kinds; they reuse
    the same shape so the client needs no second code path.

    Every payload carries the alert id and a deep link to the alert, so a tap
    on the OS notification opens the app ON the alert — the whole point of a
    notification that arrives with the app closed.
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
        "alert_id": str(alert_id) if alert_id is not None else "",
        # Tapping the OS notification opens the app ON THE ALERT: the alerts
        # view, deep-linked to this alert id when one is known.
        "url": _alert_url(alert_id),
    }


def _cap_fingerprint(gathered: dict[str, Any]) -> str:
    """Stable identity of the current official-alert set for one district.

    Two polls can return the SAME verdict level while the underlying bulletins
    changed — a bulletin re-issued at the same severity, or its text updated.
    The fingerprint catches that so the user hears "Alert update" instead of
    silence. Severity itself is never derived here; it stays the verdict's.
    """
    parts = []
    for a in gathered.get("relevant") or []:
        if not isinstance(a, dict):
            continue
        aid = str(a.get("id") or a.get("identifier") or "")
        stamp = str(a.get("updated") or a.get("sent") or a.get("effective") or "")
        parts.append(f"{aid}@{stamp}")
    return "|".join(sorted(parts))


def _official_alert_id(gathered: dict[str, Any]) -> str:
    """Raw CAP alert id for the push payload and deep link.

    The payload/deep-link id must match the raw `a.id` the app's AlertsList
    matches on (`alertKey`), otherwise a notification tap lands on the list
    without expanding the alert. "" when no relevant CAP id exists — the
    deep link then falls back to the plain alerts view.
    """
    for a in gathered.get("relevant") or []:
        if isinstance(a, dict) and a.get("id"):
            return str(a["id"])
    return ""


# Internal watcher bookkeeping lives under underscore keys in the same store.
# `status()` skips them so they never surface as phantom "districts".
_FP_KEY = "_fp:{district}"


async def check_district(district: str) -> dict[str, Any]:
    """Compute one district's verdict, push on change, and log the transition.

    Every transition the watcher detects (start / escalate / clear on the
    official SACHET/IMD chain, plus `updated` when a bulletin changes without
    moving the level) is BOTH pushed to subscribed devices AND written to the
    notification log — the OS push is fire-and-forget, the Notification Center
    is the durable trail the user can scroll. Bookkeeping never raises.
    """
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
    fp_key = _FP_KEY.format(district=district)
    prev_fp = state.get(fp_key)
    cur_fp = _cap_fingerprint(gathered)
    # A new or changed official bulletin at the SAME level is an update, not
    # silence: the verdict did not move, but the warning did change and the
    # user must hear about it. Never fires on the first sighting (prev is
    # None — the fingerprint is recorded, nothing is announced), and never on
    # an unchanged fingerprint.
    if (not kind and prev is not None and cur_fp and prev_fp
            and cur_fp != prev_fp
            and hazard_of(prev) and hazard_of(prev) == hazard_of(verdict)):
        kind = "updated"
    state[district] = verdict
    state[fp_key] = cur_fp
    _save_state(state)

    if not kind:
        return {"district": district, "level": verdict.get("level"), "notified": None}

    payload = message_for(kind, verdict, district, alert_id=_official_alert_id(gathered))
    result = push_service.broadcast(payload, district=district)
    # The push happened (or was attempted): record it in the history the user
    # scrolls. This was the missing link — official-chain transitions pushed
    # to devices but never reached the in-app inbox.
    try:
        notification_service.log(
            kind, payload.get("title", ""), payload.get("body", ""),
            district=district,
            alert_id=payload.get("alert_id") or "",
            severity=str(payload.get("severity") or ""),
            push={k: result.get(k) for k in ("targeted", "delivered", "failed", "pruned")},
        )
    except Exception as exc:  # noqa: BLE001 - bookkeeping must not stop alerts
        log.warning("notification bookkeeping failed: %s", exc)
    log.info("push %s for %s -> %s", kind, district, result)
    return {"district": district, "level": verdict.get("level"), "notified": kind, "push": result}


async def check_all() -> list[dict[str, Any]]:
    """One pass over every district anyone is subscribed to."""
    districts = sorted({s.get("district") for s in push_service.subscriptions() if s.get("district")})
    if not districts:
        return []
    return [await check_district(d) for d in districts]


async def run_forever(interval: int = DEFAULT_INTERVAL, tick: int | None = None) -> None:
    """The loop. Started from the app lifespan; cancelled on shutdown.

    The NETWORK pass re-checks every subscribed district against CAP/IMD/
    Open-Meteo. Bulletins are issued on the scale of hours, so the pass keeps
    the slow `interval` and does not hammer NDMA; `tick` is only how often the
    loop wakes to see whether the interval has elapsed.
    """
    tick = tick or WATCH_TICK_DEFAULT
    if tick <= 0:
        tick = WATCH_TICK_DEFAULT
    log.info("alert watcher started (network every %ss)", interval)

    last_net = 0.0  # 0.0 forces a network pass on the very first loop
    while True:
        try:
            results: list[dict[str, Any]] = []
            now = time.monotonic()
            if now - last_net >= interval:
                last_net = now
                results = await check_all()

            notified = [r for r in results if r.get("notified")]
            if results:
                log.info("watcher pass: %d district(s), %d CAP notification(s)",
                         len(results), len(notified))
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
        "watch_tick_seconds": int(getattr(config, "WATCH_TICK", WATCH_TICK_DEFAULT)),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
