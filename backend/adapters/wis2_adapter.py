"""WIS2 / MQTT ingestion layer — conceptual architecture (§24–25), honest status.

INVESTIGATION 2026-09-23: public WIS2 global brokers DO exist and need no
private credentials — mqtts://everyone:everyone@globalbroker.meteo.fr:8883
(also wss on :443/mqtt), NOAA and CMA equivalents; subscribe topic
`origin/a/wis2/#`. A live subscription from this sandbox could NOT be
verified: the egress proxy answers the TCP connection but breaks the TLS
handshake (SSL WRONG_VERSION_NUMBER on both 8883 and 443), so no MQTT
session could be established here. On an open network (e.g. Render) the
same credentials should work — but until a subscription is actually
verified end-to-end, this layer stays UNCONFIGURED/STUB.

Set WIS2_BROKER=mqtts://everyone:everyone@globalbroker.meteo.fr:8883 and
WIS2_TOPICS=origin/a/wis2/# to document intent; the live subscriber itself
is not implemented in the MVP. CAP polling remains the official-warning
path and the system is fully functional without WIS2.
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
        report(NAME, UNCONFIGURED,
               "broker set but live subscription not verified — CAP polling used instead")
        return {"name": NAME, "status": UNCONFIGURED,
                "detail": "broker set; live MQTT subscription not implemented/verified in MVP — CAP polling used instead"}
    report(NAME, UNCONFIGURED,
           "WIS2_BROKER not set — public brokers exist (everyone/everyone) but unverified here; CAP polling used instead")
    return {"name": NAME, "status": UNCONFIGURED,
            "detail": "optional layer; public WIS2 brokers exist but live subscription unverified — system works without it"}


def simulated_event() -> dict:
    """SIMULATED event in MQTT topic shape. Labelled — never presented as live intake."""
    t = _SIM_TEMPLATES[(next(_counter) - 1) % len(_SIM_TEMPLATES)]
    report(NAME, DEMO, "simulated event (architecture demo)")
    return {
        "provenance": "SIMULATED", "topic": t["topic"], "event": t["event"],
        "district": t["district"], "severity": t["severity"],
        "published_at": iso_now(), "valid_until": (now_ist() + timedelta(hours=3)).isoformat(),
    }
