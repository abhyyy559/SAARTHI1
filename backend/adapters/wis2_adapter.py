"""WIS2 / MQTT ingestion layer — conceptual architecture (§24–25), honest status.

Without a configured broker (WIS2_BROKER env / MQTT deps) this layer reports
UNCONFIGURED. A clearly-labelled SIMULATED event generator exists so the
architecture (publisher -> MQTT -> ingestion -> event processor -> warning
engine) can be demonstrated without pretending to a live feed. The system
remains fully functional without it.
"""
from __future__ import annotations

import itertools
from datetime import timedelta

from .. import config
from ..utils.time import iso_now, now_ist
from .registry import DEMO, UNCONFIGURED, report

NAME = "wis2"

_SIM_TEMPLATES = [
    {"topic": "wis2/imd/warning", "event": "district_warning", "district": "Hyderabad", "severity": "YELLOW"},
    {"topic": "wis2/imd/nowcast", "event": "nowcast_update", "district": "Hyderabad", "severity": "GREEN"},
    {"topic": "wis2/nwp/gfs", "event": "model_cycle", "district": "-", "severity": "-"},
]

_counter = itertools.count(1)


def status() -> dict:
    broker = getattr(config, "WIS2_BROKER", "") or ""
    if broker:
        report(NAME, UNCONFIGURED, "broker configured but live subscription not implemented in MVP")
        return {"name": NAME, "status": UNCONFIGURED, "detail": "broker set; subscription planned"}
    report(NAME, UNCONFIGURED, "WIS2_BROKER not set — layer documented, optional")
    return {"name": NAME, "status": UNCONFIGURED, "detail": "optional layer; system works without it"}


def simulated_event() -> dict:
    """SIMULATED event in MQTT topic shape. Labelled — never presented as live intake."""
    t = _SIM_TEMPLATES[(next(_counter) - 1) % len(_SIM_TEMPLATES)]
    report(NAME, DEMO, "simulated event (architecture demo)")
    return {
        "provenance": "SIMULATED", "topic": t["topic"], "event": t["event"],
        "district": t["district"], "severity": t["severity"],
        "published_at": iso_now(), "valid_until": (now_ist() + timedelta(hours=3)).isoformat(),
    }
