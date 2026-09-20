"""Push notification endpoints.

Registering a subscription is what turns "notify me" from a preference into a
capability: the backend can then reach this device while the app is closed. The
browser never tells us who the user is — a subscription is an opaque endpoint
plus two public keys.
"""
from fastapi import APIRouter

from ..services import alert_watcher, push_service
from ..utils.time import iso_now

router = APIRouter(prefix="/api/push")


@router.get("/vapid")
async def vapid() -> dict:
    """The public key the browser needs to subscribe. Safe to serve: it is public
    by definition, and the private half never leaves the server."""
    return {
        "public_key": push_service.public_key() if push_service.push_available() else "",
        "available": push_service.push_available(),
        "generated_at": iso_now(),
    }


@router.post("/subscribe")
async def subscribe(payload: dict) -> dict:
    try:
        out = push_service.subscribe(
            payload.get("subscription") or {},
            district=payload.get("district", ""),
            language=payload.get("language", "en"),
            persona=payload.get("persona", "general"),
        )
    except ValueError as exc:
        return {"status": "error", "reason": str(exc)}
    return {"status": "subscribed", **out, "generated_at": iso_now()}


@router.post("/unsubscribe")
async def unsubscribe(payload: dict) -> dict:
    endpoint = (payload or {}).get("endpoint", "")
    if not endpoint:
        return {"status": "error", "reason": "endpoint is required"}
    return {"status": "unsubscribed", **push_service.unsubscribe(endpoint), "generated_at": iso_now()}


@router.post("/test")
async def test_push(payload: dict | None = None) -> dict:
    """Send a real push right now, so the path can be proven end to end.

    Targets one endpoint when given, otherwise every subscriber for the district.
    """
    payload = payload or {}
    endpoint = payload.get("endpoint")
    if endpoint:
        sub = next((s for s in push_service.subscriptions() if s["endpoint"] == endpoint), None)
        if not sub:
            return {"status": "error", "reason": "unknown endpoint"}
        ok, reason = push_service.send_one(sub, {
            "title": "Test alert",
            "body": "If you can see this with the app closed, push works.",
            "severity": "YELLOW",
            "district": sub.get("district", ""),
            "kind": "test",
            "url": "/",
        })
        return {"status": "sent" if ok else "failed", "reason": reason, "generated_at": iso_now()}

    district = payload.get("district", "")
    if not district:
        return {"status": "error", "reason": "district or endpoint is required"}
    result = push_service.broadcast({
        "title": "Test alert",
        "body": f"Test push for {district}. If this arrived with the app closed, push works.",
        "severity": "YELLOW",
        "district": district,
        "kind": "test",
        "url": "/",
    }, district=district)
    return {"status": "sent", **result, "generated_at": iso_now()}


@router.post("/check")
async def check_now() -> dict:
    """Run one watcher pass immediately. Used by the demo and for manual recovery;
    the scheduled loop runs on its own regardless."""
    results = await alert_watcher.check_all()
    return {"status": "checked", "districts": results, "generated_at": iso_now()}


@router.get("/status")
async def status() -> dict:
    return {**alert_watcher.status(), "generated_at": iso_now()}
