"""Authoritative warning verdict — ONE severity, decided once, server-side.

WHY THIS MODULE EXISTS
----------------------
The frontend used to derive severity independently in two components from
different subsets of the same payload:

    HeroCard.jsx     looked only at `warning`   -> saw null -> "All clear"
    AlertCenter.jsx  also looked at `cap_alerts` -> showed the ORANGE alert

One payload, two contradictory verdicts on the same screen. That is the single
worst bug in this codebase because it breaks the product's core promise: absence
of data is never rendered as safety.

The fix is architectural, not cosmetic: severity is computed exactly here, once,
and every view renders the same answer. No frontend component may re-derive it.

CONTRACT
--------
`build_verdict()` always returns a dict with the same keys, on every branch —
including total failure. The UI can therefore never be missing a verdict and can
never fall back to a guessed calm.

    {
      "level":      "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN",
      "basis":      "verified_warning" | "cap_alert" | "unverified_warning"
                    | "unavailable" | "none",
      "confirmed":  bool,   # backed by an official source we actually reached
      "severity":   str | None,   # official severity when known (never translated)
      "hazard":     str | None,
      "source":     str | None,
      "nearby_count": int,  # official state-level alerts, not verified here
      "detail":     str,    # short machine-readable reason, for evidence panels
    }

HONESTY RULES ENFORCED HERE
---------------------------
1. `UNKNOWN` is returned whenever we could not reach the warning service and no
   relevant official alert was found. "We could not check" is never `LOW`.
2. Relevant CAP alerts count as authoritative even when IMD is unreachable — they
   are official NDMA/SACHET products whose geometry or district matched the user.
3. A warning that is present but failed validation is `UNKNOWN`, never `LOW`. We
   saw something and could not confirm it, which is not the same as calm.
4. `nearby_count` never raises the district's own level. Alerts in another part of
   the state are context, not this district's warning.
5. Official severity is never modified. `RED` maps to `CRITICAL`, it is not
   re-graded.
6. "The service answered and had nothing" and "we could not reach the service" are
   different facts. Callers must pass `warning_service_available` truthfully —
   see `api/weather.py::warnings` for how the two are distinguished.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from ..utils.time import IST, now_ist

# Official severity -> WeatherGPT level. Order matters (index = rank).
_SEVERITY_TO_LEVEL = {
    "RED": "CRITICAL",
    "ORANGE": "HIGH",
    "YELLOW": "MODERATE",
    "GREEN": "LOW",
}
_LEVEL_RANK = {"LOW": 0, "MODERATE": 1, "HIGH": 2, "CRITICAL": 3}

UNAVAILABLE = "unavailable"


def _sev_of(alert: dict[str, Any]) -> str:
    """Official severity of an alert, upper-cased. Never invents one."""
    return str((alert or {}).get("severity") or "").upper()


def _expiry_raw(alert: dict[str, Any]) -> str:
    """The alert's expiry as written: `expires`, else `valid_until`, else ''.

    One accessor for both the expiry test and the "newest expired alert" pick,
    so an alert that carries only `valid_until` is not read as having no expiry
    at all (which reported "latest None" in the verdict detail).
    """
    return str((alert or {}).get("expires") or (alert or {}).get("valid_until") or "")


def _is_expired(alert: dict[str, Any], now: Optional[datetime] = None) -> bool:
    """True when the alert's validity window has already closed.

    Unknown or unparseable `expires` counts as NOT expired: an alert whose window
    we cannot read is still an alert, and guessing that it lapsed would be a calm
    invented from a parsing failure.
    """
    raw = _expiry_raw(alert)
    if not raw:
        return False
    try:
        when = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return False
    # Compare like with like: a feed that omitted the offset gives a naive
    # datetime, and subtracting an aware one from it raises.
    if when.tzinfo is None:
        # A timestamp with no offset from IMD/SACHET is IST — an Indian official
        # product, in an app that is IST throughout. Reading it against the
        # SERVER's local clock shifts the window by the host's offset: on a UTC
        # box a naive IST expiry was judged 5h30m early, flipping an alert
        # between "in force" and "expired" and therefore between CRITICAL and
        # UNKNOWN.
        reference = now if now is not None else now_ist()
        if reference.tzinfo is not None:
            reference = reference.astimezone(IST)
        current = reference.replace(tzinfo=None)
    else:
        current = (now or datetime.now(timezone.utc)).astimezone(when.tzinfo)
    return when < current


def _strongest(alerts: Iterable[dict[str, Any]]) -> Optional[str]:
    """Highest official severity present, or None when none is usable."""
    best: Optional[str] = None
    for a in alerts or []:
        sev = _sev_of(a)
        if sev not in _SEVERITY_TO_LEVEL:
            continue
        if best is None or _LEVEL_RANK[_SEVERITY_TO_LEVEL[sev]] > _LEVEL_RANK[_SEVERITY_TO_LEVEL[best]]:
            best = sev
    return best


def build_verdict(
    *,
    verified: Optional[dict[str, Any]] = None,
    warning: Optional[dict[str, Any]] = None,
    cap_alerts: Optional[list[dict[str, Any]]] = None,
    nearby_alerts: Optional[list[dict[str, Any]]] = None,
    warning_service_available: bool = True,
    warning_matches_location: bool = True,
) -> dict[str, Any]:
    """Compute the one verdict every view renders.

    `cap_alerts` must already be filtered to those relevant to the user
    (see `gis_service.warning_relevant`). `nearby_alerts` are official alerts in
    the same state that did NOT verify for this district.

    `warning_matches_location` must be `False` when the warning we received is
    for some *other* district. Such a warning is context, not this district's
    warning, so it must not raise this district's level — otherwise a feed that
    routinely returns neighbouring districts would mark everywhere UNKNOWN.
    """
    cap_alerts = list(cap_alerts or [])
    nearby_alerts = list(nearby_alerts or [])
    nearby_count = len(nearby_alerts)
    verified = verified or {}

    # 1. A warning that passed source/freshness/location/validity/completeness.
    if verified.get("verified"):
        sev = str(verified.get("severity") or "").upper()
        level = _SEVERITY_TO_LEVEL.get(sev, "UNKNOWN")
        return {
            "level": level,
            "basis": "verified_warning",
            "confirmed": True,
            "severity": sev or None,
            "hazard": verified.get("hazard") or (warning or {}).get("hazard"),
            "source": verified.get("source") or (warning or {}).get("source"),
            "nearby_count": nearby_count,
            "detail": f"verified {sev} {verified.get('hazard') or 'warning'}",
        }

    # An alert whose validity window has closed is not evidence of a hazard NOW.
    # The SACHET feed routinely serves a backlog of expired bulletins: on this
    # machine all three "relevant" alerts had expired — one of them three days
    # earlier — yet they drove a confirmed MODERATE verdict while the Alerts page
    # marked every one of them Expired. Two screens contradicting each other
    # about the same alerts is exactly the failure this module exists to prevent,
    # and it is worse than cosmetic: it presents stale official data as current.
    active_cap = [a for a in cap_alerts if not _is_expired(a)]
    expired_cap = [a for a in cap_alerts if _is_expired(a)]

    # 2. Relevant official CAP/SACHET alert. Authoritative even if IMD is down —
    #    this is an official product that matched the user's location.
    cap_sev = _strongest(active_cap)
    if cap_sev:
        top = next((a for a in active_cap if _sev_of(a) == cap_sev), {})
        return {
            "level": _SEVERITY_TO_LEVEL[cap_sev],
            "basis": "cap_alert",
            "confirmed": True,
            "severity": cap_sev,
            "hazard": top.get("hazard") or top.get("event") or top.get("headline"),
            "source": top.get("source") or "NDMA-Sachet-CAP",
            "nearby_count": nearby_count,
            "detail": f"official CAP alert ({cap_sev}) relevant to this location",
        }

    # 2b. Alerts matched this district but every one has lapsed. We DID reach the
    #     feed, so this is not an outage — but a feed whose newest entry has
    #     closed its window cannot tell us whether a warning is in force now.
    #     Reporting "no active warning" here would be a calm built on stale data,
    #     which is the one thing this product must never emit.
    if expired_cap and not active_cap:
        newest = max(expired_cap, key=_expiry_raw)
        return {
            "level": "UNKNOWN",
            "basis": UNAVAILABLE,
            "confirmed": False,
            "severity": None,
            "hazard": None,
            "source": newest.get("source") or "NDMA-Sachet-CAP",
            "nearby_count": nearby_count,
            # Additive flag, ignored by every existing view. It lets the advisory
            # say "the feed answered, its alerts are stale" instead of the plain
            # unavailable wording "the service is unreachable" — which would be a
            # false statement about the world, and the reason here is different.
            "stale_cap": True,
            "detail": (
                f"{len(expired_cap)} official alert(s) matched this district but all have "
                f"expired (latest {_expiry_raw(newest)}) — current status unconfirmed"
            ),
        }

    # 3. A warning for THIS district that failed validation (stale, outside its
    #    validity window, incomplete, or from an untrusted source). It is neither
    #    an active warning nor a calm — we saw something and could not confirm it.
    #    Presenting this as LOW would be a false calm.
    if warning and warning_matches_location:
        return {
            "level": "UNKNOWN",
            "basis": "unverified_warning",
            "confirmed": False,
            "severity": str(warning.get("severity") or "").upper() or None,
            "hazard": warning.get("hazard"),
            "source": warning.get("source"),
            "nearby_count": nearby_count,
            "detail": "a warning is present but did not pass validation — not confirmed",
        }

    # 4. Could not reach the warning service. Honest UNKNOWN — never a calm.
    if not warning_service_available:
        return {
            "level": "UNKNOWN",
            "basis": UNAVAILABLE,
            "confirmed": False,
            "severity": None,
            "hazard": None,
            "source": None,
            "nearby_count": nearby_count,
            "detail": "warning service unreachable — active warnings cannot be confirmed",
        }

    # 4. Service reachable, nothing relevant for this district.
    return {
        "level": "LOW",
        "basis": "none",
        "confirmed": True,
        "severity": "GREEN",
        "hazard": None,
        "source": None,
        "nearby_count": nearby_count,
        "detail": (
            f"no warning for this district; {nearby_count} official alert(s) elsewhere in the state"
            if nearby_count
            else "no active warning for this district"
        ),
    }
