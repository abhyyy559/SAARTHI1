"""Ack + coverage API — device delivery telemetry ingest (Round2 T3.3).

- POST /api/ack  {endpoint, alert_id, event, district?} — a device reports what
  happened to an alert on its side. `event` is one of delivered / opened /
  acknowledged / pending / offline / unreachable / p2p_relayed.
- GET  /api/coverage?district= — district telemetry aggregate: counts per event
  + per-district zones. Empty `district` returns every district.

Two ledgers, kept apart on purpose:
- push_service telemetry (here): per-DISTRICT reach — "how is Hyderabad doing
  across alerts?" Every event lands here.
- delivery_service ledger: per-ALERT reach — "did alert X reach its devices?"
  Only opened / acknowledged / p2p_relayed bridge across, because only those
  are device-confirmed engagement with an alert; raw delivered/pending/offline
  stay in the district ledger.

DISCIPLINE: every function here never raises. Telemetry is bookkeeping — a
store outage must not 500 an alert, an ack, or a push.
"""
import logging

from fastapi import APIRouter, HTTPException

from ..services import delivery_service, push_service
from ..utils.time import iso_now

log = logging.getLogger("weathergpt.ack")

router = APIRouter(prefix="/api", tags=["ack"])

# The only events that bridge from the per-DISTRICT telemetry ledger into the
# per-ALERT delivery ledger. These three mean the device actually engaged with
# this specific alert; raw delivered/pending/offline/unreachable do not, and
# stay in the district ledger (see the module docstring).
_BRIDGE_EVENTS = frozenset({"opened", "acknowledged", "p2p_relayed"})


def _bridge(alert_id: str, device: str, event: str) -> dict | None:
    """Mirror a device-confirmed engagement into the per-alert ledger.

    Returns the resulting ledger row, or None for events that do not bridge and
    for an unknown alert. Never raises — bookkeeping must not break the ack.
    """
    if event not in _BRIDGE_EVENTS:
        return None
    try:
        if event == "p2p_relayed":
            # A relay hop, not an engagement: record the hop itself.
            return delivery_service.record_relay(alert_id, device)
        return delivery_service.record_event(alert_id, device, event)
    except Exception as exc:  # noqa: BLE001 - telemetry must never 500
        log.warning("ledger bridge failed for %s/%s: %s: %s",
                    alert_id, event, type(exc).__name__, exc)
        return None


@router.post("/ack")
async def receive_ack(payload: dict) -> dict:
    """Receive acknowledgment from client device.

    Body: {endpoint, alert_id, event, district?}
    event is one of: delivered, opened, acknowledged, pending, offline, unreachable, p2p_relayed
    """
    try:
        endpoint = str((payload or {}).get("endpoint") or "").strip()
        alert_id = str((payload or {}).get("alert_id") or "").strip()
        event = str((payload or {}).get("event") or "").strip().lower()
        district = str((payload or {}).get("district") or "").strip()

        if not endpoint or not alert_id or not event:
            raise HTTPException(
                status_code=400,
                detail="endpoint, alert_id, and event are required"
            )

        # Record the event via push_service telemetry
        record = push_service.record_event(endpoint, alert_id, event, district)

        if record is None:
            raise HTTPException(
                status_code=400,
                detail=f"unknown event type: {event}"
            )

        # push_service accepts documented aliases ("ack", "open", "p2p", ...) and
        # stores the CANONICAL event. Use that canonical name for both the echoed
        # status and the ledger bridge: the raw alias is not in `_BRIDGE_EVENTS`,
        # so bridging on it silently dropped the per-alert record for every alias
        # while the district telemetry recorded the engagement — the two ledgers
        # disagreed about the same ack.
        canonical = str(record.get("event") or event)
        return {
            "status": canonical,
            "endpoint": endpoint,
            "alert_id": alert_id,
            "district": district,
            "telemetry": record,
            "ledger": _bridge(alert_id, endpoint, canonical),
            "generated_at": iso_now(),
        }
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - telemetry must never 500
        # Log but don't break the ack flow. "unrecorded" is the honest answer:
        # the client is not told the event was stored when it was not. The
        # response still carries every contract key (honest nulls), so a client
        # parsing the documented shape cannot crash on the degraded branch.
        log.warning("ack receive failed: %s: %s", type(exc).__name__, exc)
        return {
            "status": "unrecorded",
            "endpoint": str((payload or {}).get("endpoint") or "").strip(),
            "alert_id": str((payload or {}).get("alert_id") or "").strip(),
            "district": str((payload or {}).get("district") or "").strip(),
            "telemetry": None,
            "ledger": None,
            "generated_at": iso_now(),
        }


@router.get("/coverage")
async def get_coverage(district: str = "") -> dict:
    """Get district telemetry aggregate.

    Query param: district (optional) — empty returns all districts.
    Returns: {district, counts, total, reached, zones}
    """
    try:
        district = str(district or "").strip()
        result = push_service.coverage(district)
        return result
    except Exception as exc:  # noqa: BLE001 - telemetry must never 500
        import logging
        log = logging.getLogger("weathergpt.ack")
        log.warning("coverage failed: %s: %s", type(exc).__name__, exc)
        empty_counts = {e: 0 for e in push_service.TELEMETRY_EVENTS}
        return {"district": district, "counts": empty_counts, "total": 0,
                "reached": 0, "zones": []}