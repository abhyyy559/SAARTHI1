"""Notification Center API — the user-side record of everything SAARTHI sent.

- GET  /api/notifications?district=&device=   newest-first log, `read` per device
- GET  /api/notifications/unread?district=&device=  count for the badge
- POST /api/notifications/read     {ids | all: true, district, device}
- POST /api/notifications/ack      {alert_id, device} — explicit "I received this"
- POST /api/notifications/open     {alert_id, device} — device reports alert opened
- POST /api/notifications/reset    (demo mode) clear the log

`device` is an opaque id the frontend keeps in localStorage. The server never
learns who the user is; the id only separates "my phone marked it read" from
"my tablet did".
"""
from fastapi import APIRouter

from .. import config
from ..services import delivery_service, notification_service
from ..utils.time import iso_now

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
@router.get("/")
async def list_notifications(district: str = "", device: str = "") -> dict:
    items = notification_service.list_all(district, device)
    return {"notifications": items, "unread": sum(1 for n in items if not n["read"]),
            "generated_at": iso_now()}


@router.get("/unread")
async def unread(district: str = "", device: str = "") -> dict:
    return {"unread": notification_service.unread_count(district, device),
            "generated_at": iso_now()}


@router.post("/read")
async def read(payload: dict) -> dict:
    data = payload or {}
    device = str(data.get("device") or "")
    if data.get("all"):
        out = notification_service.mark_all_read(str(data.get("district") or ""), device)
    else:
        out = notification_service.mark_read(list(data.get("ids") or []), device)
    return {**out, "generated_at": iso_now()}


def _record_event(payload: dict, event: str) -> dict:
    data = payload or {}
    alert_id = str(data.get("alert_id") or "")
    device = str(data.get("device") or "")
    if not alert_id or not device:
        return {"status": "error", "reason": "alert_id and device are required"}
    rec = delivery_service.record_event(alert_id, device, event)
    if rec is None:
        return {"status": "error", "reason": f"unknown event {event}"}
    return {"status": event, "alert_id": alert_id, "device_status": rec["status"],
            "generated_at": iso_now()}


@router.post("/opened")
async def opened(payload: dict) -> dict:
    """A device reports the alert was OPENED (delivery telemetry)."""
    return _record_event(payload, "opened")


@router.post("/ack")
async def acknowledged(payload: dict) -> dict:
    """A device reports the user explicitly ACKNOWLEDGED the alert."""
    return _record_event(payload, "acknowledged")


@router.post("/reset")
async def reset() -> dict:
    if not config.DEMO_MODE:
        return {"status": "error", "reason": "demo mode only"}
    notification_service.reset_store()
    delivery_service.reset_store()
    return {"status": "reset", "generated_at": iso_now()}
