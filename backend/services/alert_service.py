"""Gather and classify official alerts — one implementation, both endpoints.

Why this module exists. `api/weather.py` and `api/chat.py` each built their own
`cap_alerts` / `nearby_alerts` lists. weather.py merged the multi-source chain
(InTouch → WeatherAPI → GDACS) on top of SACHET/CAP; chat.py never did. So the
Alerts page could list an alert the chat verdict had never seen, and the two
screens could disagree about how dangerous the day was — the same class of bug as
two views deriving severity independently.

The rule this follows: severity is decided once (`verdict_service`), so the
inputs to that decision are gathered once too. If you need alerts, call
`gather_alerts`; do not re-implement the classification.
"""
from __future__ import annotations

import asyncio
from typing import Any

from .. import config
from ..adapters import cap_adapter
from ..adapters.registry import LIVE, AdapterUnavailable
from . import district_service
from .gis_service import alert_text, warning_relevant

# The official feed's name as it appears in the evidence panel.
CAP_SOURCE = "NDMA-Sachet-CAP"
# The commercial/global chain, used only to merge extra alerts in.
CHAIN_SOURCE = "InTouch/WeatherAPI/GDACS"

# In-flight gathers, keyed by what makes two requests the same question. See
# `gather_alerts`: this shares concurrent duplicate work, it never serves a
# stored answer.
_inflight: dict[tuple, "asyncio.Future[dict[str, Any]]"] = {}


# ---------------------------------------------------------------------------
# Demo alert lifecycle (Round2 alert-first).
#
# Official alerts are pre-authorized (NDMA-SACHET CAP / IMD auto-ingest, no
# human gate). These helpers only move demo/CAP alert dicts between display
# states — they never invent warnings and never touch severity. The verdict
# stays decided once in `verdict_service`.
# ---------------------------------------------------------------------------

# Ordered display states, UPCOMING first, terminal states last. Official alerts
# are pre-authorized (NDMA-SACHET CAP / IMD auto-ingest, no human gate) — this
# list only names the states demo/CAP alert dicts move between.
LIFECYCLE = ["UPCOMING", "PRE-ALERT", "ACTIVE", "UPDATED", "EXTENDED", "ENDED", "CANCELLED"]

# Terminal states: no action leaves them.
TERMINAL_STATES = frozenset({"ENDED", "CANCELLED"})

# (current_state, action) -> new_state. Actions use the Admin-panel verbs.
VALID_TRANSITIONS: dict[tuple[str, str], str] = {
    ("UPCOMING", "pre-alert"): "PRE-ALERT",
    ("UPCOMING", "activate"): "ACTIVE",
    ("UPCOMING", "cancel"): "CANCELLED",
    ("PRE-ALERT", "activate"): "ACTIVE",
    ("PRE-ALERT", "update"): "PRE-ALERT",
    ("PRE-ALERT", "cancel"): "CANCELLED",
    ("ACTIVE", "update"): "UPDATED",
    ("ACTIVE", "extend"): "EXTENDED",
    ("ACTIVE", "end"): "ENDED",
    ("UPDATED", "update"): "UPDATED",
    ("UPDATED", "extend"): "EXTENDED",
    ("UPDATED", "end"): "ENDED",
    ("EXTENDED", "update"): "UPDATED",
    ("EXTENDED", "extend"): "EXTENDED",
    ("EXTENDED", "end"): "ENDED",
}

# Forgiving spellings the API accepts before lookup.
_ACTION_ALIASES = {
    "pre_alert": "pre-alert",
    "prealert": "pre-alert",
    "pre": "pre-alert",
    "active": "activate",
    "start": "activate",
    "cancelled": "cancel",
    "ended": "end",
    "expire": "end",
}


def normalise_action(action: str) -> str:
    """Lowercase + alias-resolve an Admin-panel verb (pure)."""
    key = str(action or "").strip().lower().replace("_", "-")
    key = "-".join(p for p in key.split("-") if p)
    return _ACTION_ALIASES.get(key, key)


def set_lifecycle(alert: dict[str, Any], action: str) -> tuple[str, str | None]:
    """Move one alert dict to its next lifecycle state (pure function).

    `action` is an Admin-panel verb (`pre-alert`, `activate`, `update`,
    `extend`, `cancel`, `end`, plus the forgiving aliases in
    `_ACTION_ALIASES`) — or a target state name from `LIFECYCLE`
    (`"ACTIVE"`, `"ENDED"`, …), in which case the verb that leads there from
    the current state is resolved automatically.

    Returns `(new_state, error)`. On success `error` is None and the alert's
    `"state"` is updated in place. On failure the alert is untouched and
    `error` names the problem (`unknown-action`, `terminal-state`, or
    `invalid-transition: STATE + action`).
    """
    if not isinstance(alert, dict):
        return "", "bad-alert"
    current = str(alert.get("state") or "UPCOMING").upper()
    verb = normalise_action(action)
    valid_verbs = {a for (_, a) in VALID_TRANSITIONS}
    if verb not in valid_verbs:
        # Fallback: accept a target state name (e.g. set_lifecycle(a, "ENDED")).
        upper = str(action or "").strip().upper().replace("_", "-")
        upper = "-".join(p for p in upper.split("-") if p)
        if upper in LIFECYCLE:
            resolved = next(
                (v for (s, v), nxt in VALID_TRANSITIONS.items()
                 if s == current and nxt == upper),
                None,
            )
            if resolved is None:
                return current, f"invalid-transition: {current} -> {upper}"
            verb = resolved
        else:
            return current, f"unknown-action: {action!r}"
    if current in TERMINAL_STATES:
        return current, f"terminal-state: {current}"
    nxt = VALID_TRANSITIONS.get((current, verb))
    if nxt is None:
        return current, f"invalid-transition: {current} + {verb}"
    alert["state"] = nxt
    return nxt, None


def lifecycle_state(alert: dict[str, Any] | None) -> str:
    """Current lifecycle state of an alert dict (pure, never raises)."""
    if not isinstance(alert, dict):
        return "UPCOMING"
    state = str(alert.get("state") or "UPCOMING").upper()
    return state if state in LIFECYCLE else "UPCOMING"


def timeline(alert: dict[str, Any] | None) -> list[dict[str, Any]]:
    """The alert's history trail for the Alert Details view (pure, a copy)."""
    if not isinstance(alert, dict):
        return []
    history = alert.get("history")
    return list(history) if isinstance(history, list) else []


# ---------------------------------------------------------------------------
# Full lifecycle detail (alerts redesign).
#
# The Alerts detail view shows, per alert: when it started, when it completed
# or is expected to end, effects, who issued it, and why. This helper reads
# ONLY fields the backend actually has — a missing field stays None and the
# frontend says "not available" honestly. Nothing is invented here.
#
# Mapping (pure, no network, no severity math):
#   started_at      demo: the store's own stamp on activate; CAP: the feed's
#                         `onset` (or `effective`). An UPCOMING demo alert has
#                         none — it has not started.
#   expected_end_at demo: `ends_at`; CAP: the feed's `expires`.
#   completed_at    demo: the store's own stamp on ENDED/CANCELLED. Official
#                         feeds that expire silently leave it None — the UI
#                         says "not available" rather than guessing.
#   issuer          demo: the alert's `issuer`, default DEMO; CAP: the feed's
#                         `sender`, default NDMA-Sachet-CAP.
#   reason          demo: the alert's `reason`; CAP: urgency/certainty as the
#                         feed sent them (untranslated source values).
#   effects         demo: the alert's `effects`; CAP: the feed's description
#                         (the feed's own wording, shown as-is).
# ---------------------------------------------------------------------------

_EMPTY_LIFECYCLE = {
    "started_at": None,
    "expected_end_at": None,
    "completed_at": None,
    "issuer": None,
    "reason": None,
    "effects": None,
}


def _lifecycle_is_demo(alert: dict[str, Any]) -> bool:
    src = str(alert.get("source") or "").lower()
    ident = str(alert.get("id") or alert.get("identifier") or "").lower()
    return "demo" in src or ident.startswith("demo-")


def _lifecycle_reason(alert: dict[str, Any], demo: bool) -> str | None:
    if demo:
        reason = str(alert.get("reason") or "").strip()
        return reason or None
    parts = [
        str(alert.get("urgency") or "").strip(),
        str(alert.get("certainty") or "").strip(),
    ]
    joined = ", ".join(p for p in parts if p)
    return joined or None


def lifecycle_detail(alert: dict[str, Any] | None) -> dict[str, Any | None]:
    """Canonical full-lifecycle fields for the Alerts detail view (pure)."""
    if not isinstance(alert, dict):
        return dict(_EMPTY_LIFECYCLE)
    demo = _lifecycle_is_demo(alert)
    effects = str(alert.get("effects") or "").strip() or None
    if not effects and not demo:
        effects = str(alert.get("description") or "").strip() or None
    sender = str(alert.get("sender") or "").strip()
    issuer_field = str(alert.get("issuer") or "").strip()
    issuer = issuer_field or sender or ("DEMO" if demo else CAP_SOURCE)
    return {
        "started_at": (
            alert.get("started_at") or None
            if demo
            else (alert.get("onset") or alert.get("effective") or None)
        ),
        "expected_end_at": (
            alert.get("ends_at") or None
            if demo
            else (alert.get("expires") or alert.get("valid_until") or None)
        ),
        "completed_at": alert.get("completed_at") or None,
        "issuer": issuer,
        "reason": _lifecycle_reason(alert, demo),
        "effects": effects,
    }


def attach_lifecycle_detail(alert: dict[str, Any] | None) -> dict[str, Any] | None:
    """Set `alert["lifecycle_detail"]` in place (the API-served shape)."""
    if isinstance(alert, dict):
        alert["lifecycle_detail"] = lifecycle_detail(alert)
    return alert


def official_only() -> bool:
    """True in `imd` mode: IMD facts or nothing, so the commercial chain is
    skipped entirely (docs/SOURCE-MODES.md)."""
    try:
        return config.current_source_mode() == "imd"
    except Exception:  # noqa: BLE001 - never let a mode lookup break alerting
        return False


def classify_alert(alert: dict, *, lat: float, lon: float, district: str, state_name: str) -> str:
    """Tag the alert in place; return 'relevant' | 'nearby' | 'drop'.

    `relevant` may set the verdict. `nearby` is context — an alert in the same
    state that could not be confirmed for this district. Nearby is deliberately
    NOT a calm: it never lowers a verdict, it just stops the console claiming a
    silent all-clear on the strength of an alert it cannot read.

    Public because the demo-fixture path in `api/weather.py` needs the same
    tagging; it must not grow a second, subtly different copy of these rules.
    """
    # Aliases, because the feed writes "Ranga Reddy" where the user's district is
    # "Rangareddy" — and a spelling difference must not hide an official alert.
    rel = warning_relevant(alert, lat, lon, district, names=district_service.aliases_for(district))
    alert["relevance"] = rel
    # Which districts the alert itself names, so the card can say why it was shown
    # instead of asserting relevance out of nowhere.
    alert["named_districts"] = sorted(district_service.find_in_text(alert_text(alert)))
    if rel.get("relevant"):
        return "relevant"
    # The state test reads the whole text too: "…over Telangana" is a real signal
    # that this alert belongs to the user's neighbourhood even when their district
    # is not named.
    blob = alert_text(alert).lower()
    if state_name and state_name in blob:
        alert["relevance"] = {"relevant": False, "method": "state-unconfirmed"}
        return "nearby"
    return "drop"


def _merge(bucket: dict[str, list[dict]], alert: dict, *, lat: float, lon: float,
           district: str, state_name: str) -> bool:
    """Classify one alert into the buckets. Returns True when it was kept."""
    kind = classify_alert(alert, lat=lat, lon=lon, district=district, state_name=state_name)
    if kind == "relevant":
        bucket["relevant"].append(alert)
        attach_lifecycle_detail(alert)
        return True
    if kind == "nearby":
        bucket["nearby"].append(alert)
        attach_lifecycle_detail(alert)
        return True
    return False


async def _fetch_cap() -> tuple[list[dict], str]:
    """The official feed, or nothing. Never raises: a dead official feed is a
    state to report, not an exception to propagate into a verdict.

    The provenance distinguishes two different facts: UNCONFIGURED (no
    CAP_FEED_URL — the feed was never set up) vs UNAVAILABLE (configured but
    every URL failed). Reporting a failing feed as UNCONFIGURED would hide an
    outage behind a setup label."""
    try:
        alerts, prov = await cap_adapter.fetch_alerts()
        return list(alerts or []), prov or ""
    except AdapterUnavailable:
        configured = bool(getattr(config, "CAP_FEED_URLS", None) or config.CAP_FEED_URL)
        return [], "UNAVAILABLE" if configured else "UNCONFIGURED"
    except Exception:  # noqa: BLE001 - a malformed feed must not take the verdict down
        return [], "UNAVAILABLE"


async def _fetch_chain(lat: float, lon: float, district: str) -> tuple[list[dict], str]:
    """The commercial/global chain, best-effort. Never raises."""
    try:
        from ..adapters.alert_sources import get_alerts as chain_get_alerts

        chained, prov = await chain_get_alerts(lat, lon, district)
        return list(chained or []), prov or ""
    except Exception:  # noqa: BLE001 - the chain is best-effort
        return [], ""


async def gather_alerts(*, lat: float, lon: float, district: str, state: str = "",
                        force_official_only: bool | None = None) -> dict[str, Any]:
    """Return `{relevant, nearby, provenance, feeds}`, sharing concurrent work.

    Two screens ask for the same place at the same moment: Home needs the verdict
    and the advisory, and both go through the alert chain. Served separately that
    is two full passes over NDMA and the commercial chain — slow for the user, and
    needlessly hard on a public feed. A request that arrives while an identical
    one is already running waits on THAT fetch rather than starting another.

    This is de-duplication, not caching: nothing is ever served after it was
    fetched, and the answer is exactly as live as the request that produced it.
    """
    key = (
        round(float(lat or 0.0), 3), round(float(lon or 0.0), 3),
        (district or "").lower(), (state or "").lower(),
        official_only() if force_official_only is None else bool(force_official_only),
    )
    pending = _inflight.get(key)
    if pending is None:
        pending = asyncio.ensure_future(
            _gather_uncached(lat=lat, lon=lon, district=district, state=state,
                             force_official_only=force_official_only)
        )
        _inflight[key] = pending
        pending.add_done_callback(lambda _f, k=key: _inflight.pop(k, None))
    # shield: one caller giving up (a closed tab) must not cancel the fetch the
    # other caller is still waiting on.
    result = await asyncio.shield(pending)
    # Hand each caller its own lists. The alert dicts are already fully tagged
    # inside the shared fetch, so they are safe to share; the containers are not,
    # because an endpoint that later appends would otherwise edit another
    # endpoint's payload.
    return {
        "relevant": list(result["relevant"]),
        "nearby": list(result["nearby"]),
        "provenance": result["provenance"],
        "feeds": list(result["feeds"]),
        # Unknown availability must never read as "reached it, nothing to report":
        # a caller that treats this as a calm would invent one out of an outage.
        "available": bool(result.get("available", False)),
    }


async def _gather_uncached(*, lat: float, lon: float, district: str, state: str = "",
                           force_official_only: bool | None = None) -> dict[str, Any]:
    """The actual gather. See `gather_alerts` for the contract.

    `relevant` and `nearby` are the alert dicts, each carrying a `provenance` key
    so a screen can show where a specific alert came from rather than labelling
    every row with one blanket source. `feeds` lists the sources that actually
    contributed, for the evidence panel.

    The two feeds are independent network calls and are fetched CONCURRENTLY.
    Sequentially they cost the sum of their latencies, and this runs before the
    safety verdict can render at all — measured at ~10s serially, which is the
    difference between a fisherman reading a warning and putting the phone down.
    Merging still happens in priority order below (official first), because
    concurrency is about when we fetch, not about who wins.
    """
    buckets: dict[str, list[dict]] = {"relevant": [], "nearby": []}
    state_name = (state or "").lower()
    provenance = "UNCONFIGURED"
    feeds: list[str] = []

    only_official = official_only() if force_official_only is None else force_official_only
    if only_official:
        cap_alerts, cap_prov = await _fetch_cap()
        chain_alerts, chain_prov = [], ""
    else:
        (cap_alerts, cap_prov), (chain_alerts, chain_prov) = await asyncio.gather(
            _fetch_cap(), _fetch_chain(lat, lon, district)
        )

    # Did any feed actually ANSWER? Both fetchers swallow their own failures:
    # they return an empty list plus a negative provenance ("" / UNAVAILABLE /
    # UNCONFIGURED) when the call raised, and a positive provenance label when
    # the source answered (CAP: LIVE/CACHED). A negative label is NOT an answer:
    # "we could not reach it" must never read as "reached it, nothing to report".
    # The commercial chain's only positive label is LIVE — it returns UNAVAILABLE
    # both when every provider failed and when a provider answered with no
    # alerts, so that label cannot support a calm and is not treated as an
    # answer. "It answered and had nothing" and "we could not reach it" are
    # different facts (see verdict_service); only the first may be a calm.
    _NEGATIVE = ("", "UNAVAILABLE", "UNCONFIGURED")
    feeds_answered = (cap_prov not in _NEGATIVE) or chain_prov == LIVE

    # The overall provenance names where the shown alerts came from — or, when
    # nothing is shown, why. A configured feed that failed is UNAVAILABLE, not
    # UNCONFIGURED: the distinction tells the evidence panel "outage" vs "setup".
    if cap_prov == "UNAVAILABLE":
        provenance = "UNAVAILABLE"

    # 1. SACHET / CAP — the official feed, first and never suppressed.
    for a in cap_alerts:
        a["provenance"] = cap_prov
        _merge(buckets, a, lat=lat, lon=lon, district=district, state_name=state_name)
    if cap_alerts:
        provenance = cap_prov
        feeds.append(CAP_SOURCE)

    # 2. The commercial/global chain MERGES in. A quiet chain is not a quiet
    #    world, so it can add alerts but never remove SACHET's.
    if chain_alerts:
        # Only de-duplicate on a real identifier: a missing one is not a match.
        seen = {
            a.get("identifier")
            for a in (*buckets["relevant"], *buckets["nearby"])
            if a.get("identifier")
        }
        added = 0
        for a in chain_alerts:
            ident = a.get("identifier")
            if ident and ident in seen:
                continue
            if ident:
                seen.add(ident)
            a["provenance"] = chain_prov
            if _merge(buckets, a, lat=lat, lon=lon, district=district, state_name=state_name):
                added += 1
        if added:
            feeds.append(CHAIN_SOURCE)
        if provenance in ("UNCONFIGURED", "UNAVAILABLE"):
            provenance = chain_prov  # the alerts shown came from the chain

    return {
        "relevant": buckets["relevant"],
        "nearby": buckets["nearby"],
        "provenance": provenance,
        "feeds": feeds,
        "available": feeds_answered,
    }
