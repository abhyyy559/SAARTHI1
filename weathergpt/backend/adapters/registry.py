"""Source registry — single source of truth for per-source live status.

Statuses: LIVE | CACHED | DEMO | UNCONFIGURED | OFFLINE | ERROR
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..utils.time import iso_now

LIVE = "LIVE"
CACHED = "CACHED"
DEMO = "DEMO"
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


def snapshot() -> list[dict[str, Any]]:
    return [
        {"name": s.name, "status": s.status, "detail": s.detail, "updated_at": s.updated_at}
        for s in (_STATUSES[n] for n in _KNOWN_SOURCES)
    ]
