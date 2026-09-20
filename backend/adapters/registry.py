"""Source registry — single source of truth for per-source live status.

Statuses: LIVE | CACHED | DEMO | READY | UNCONFIGURED | OFFLINE | ERROR
READY = configured but not yet exercised (first call will verify it for real).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..utils.time import iso_now

LIVE = "LIVE"
CACHED = "CACHED"
DEMO = "DEMO"
READY = "READY"
UNCONFIGURED = "UNCONFIGURED"
OFFLINE = "OFFLINE"
ERROR = "ERROR"

_KNOWN_SOURCES = ("imd", "open-meteo", "govdata", "cap", "owm", "stt", "tts")


@dataclass
class SourceStatus:
    name: str
    status: str = UNCONFIGURED
    detail: str = ""
    updated_at: str = ""


_STATUSES: dict[str, SourceStatus] = {n: SourceStatus(name=n) for n in _KNOWN_SOURCES}


class AdapterUnavailable(Exception):
    """Raised when a live adapter cannot produce data. Never silently fixture-fallback."""


def report(name: str, status: str, detail: str = "") -> SourceStatus:
    st = _STATUSES.get(name) or SourceStatus(name=name)
    st.status = status
    st.detail = detail
    st.updated_at = iso_now()
    _STATUSES[name] = st
    return st


def get_status(name: str) -> SourceStatus:
    return _STATUSES.get(name) or SourceStatus(name=name)


def _initial_state(name: str) -> tuple[str, str]:
    """Truthful state for an adapter that has not run yet in this process.

    READY = the needed credentials/env exist, so the adapter will be exercised
    (and verified LIVE/ERROR) on first real use. Runtime reports — LIVE, DEMO,
    OFFLINE, ERROR — always take precedence once they exist; this only replaces
    the old blank "UNCONFIGURED" that made configured adapters look unkeyed.
    """
    from .. import config

    if name in ("stt", "tts"):
        if config.SARVAM_API_KEY:
            return (READY, "configured (Sarvam) — verified on first use")
        return (UNCONFIGURED, "SARVAM_API_KEY not set — browser voice fallback")
    if name == "govdata":
        if config.DATAGOV_API_KEY and config.DATAGOV_RESOURCE_ID:
            return (READY, "configured (data.gov.in) — verified on first use")
        return (UNCONFIGURED, "needs DATAGOV_API_KEY + DATAGOV_RESOURCE_ID (data.gov.in)")
    if name == "cap":
        if config.CAP_FEED_URL:
            return (READY, "CAP feed configured — verified on first use")
        return (UNCONFIGURED, "needs CAP_FEED_URL (NDMA-Sachet / IMD CAP feed)")
    if name == "owm":
        if config.OWM_API_KEY:
            return (READY, "configured (OpenWeatherMap) — verified on first use")
        return (UNCONFIGURED, "OWM_API_KEY not set — second-opinion panel hidden")
    if name == "imd":
        if config.IMD_API_KEY:
            return (READY, "IMD credentials present — verified on first use")
        if config.IMD_ADAPTER == "demo":
            return (READY, "demo adapter: IMD-grade fixtures (stamped DEMO) until IMD API access is issued")
        return (UNCONFIGURED, "no IMD_API_KEY — IMD platform is credential-gated; set IMD_ADAPTER=demo for fixture warnings")
    return (READY, "no key required — verified on first use")  # open-meteo


def snapshot() -> list[dict[str, Any]]:
    out = []
    for n in _KNOWN_SOURCES:
        s = _STATUSES[n]
        if not s.updated_at:
            # Adapter never exercised in this process — report the truthful
            # configured/unconfigured state instead of a blank UNCONFIGURED.
            st, detail = _initial_state(n)
            out.append({"name": s.name, "status": st, "detail": detail, "updated_at": ""})
        else:
            out.append({"name": s.name, "status": s.status, "detail": s.detail, "updated_at": s.updated_at})
    return out
