"""Demo/Admin alert panel API (Round2, demo-mode only).

API CONTRACT (frontend uses exactly these):
- POST /api/demo/alerts            create  {title*, district*, hazard?, severity? RED|ORANGE|YELLOW,
                                            area?, instruction?, pre_alert_at?, starts_at?, ends_at?}
                                   -> {alert_id, state, alert, notified}
- GET  /api/demo/alerts            list, optional ?district=  -> {alerts: [...]}
- GET  /api/demo/alerts/{id}       one alert                 -> {alert}
- POST /api/demo/alerts/{id}/{action}
      action in pre-alert|activate|update|extend|cancel|end; optional JSON patch body
      (editable fields for update/extend, e.g. {ends_at}) -> {alert_id, state, alert, notified}
- POST /api/demo/alerts/reset      empty the store (demo reset button)
- POST /api/demo/alerts/notify     {alert_id} — send the notification for the
      alert's CURRENT state again only if not already sent (idempotent)
- POST /api/demo/alerts/scenario   {name} — create a ready-made alert at demo
      times relative to NOW, so the jury sees the full lifecycle without typing
- POST /api/demo/relay             {alert_id, to_device?, from_device?} —
      simulate one P2P relay delivering the alert to a nearby device
- POST /api/demo/coverage/seed     {alert_id, total?} — seed a labelled
      SIMULATED audience so the authority dashboard shows realistic volumes
- GET  /api/demo/coverage/{alert_id} — delivered/ack/offline/P2P numbers + zones

Every route returns 403 outside demo mode. Every mutating call appends
history {at, action, state} via the store. Notifications fire IMMEDIATELY on
each lifecycle action (a human pressed the button on stage) and are also
recorded in the notification log and the delivery ledger.
"""
from fastapi import APIRouter, HTTPException

from .. import config
from ..services import (alert_watcher, demo_alert_store, delivery_service,
                        notification_service, push_service)
from ..services.alert_service import normalise_action
from ..utils.time import iso_now, now_ist
from datetime import timedelta

router = APIRouter(prefix="/api/demo", tags=["demo"])

ACTIONS = ("pre-alert", "activate", "update", "extend", "cancel", "end")


def _require_demo() -> None:
    if not config.DEMO_MODE:
        raise HTTPException(status_code=403, detail="demo mode only")


def _notify_alert(alert: dict) -> dict:
    """Push + log + ledger for one alert in its CURRENT state. Never raises."""
    state = str(alert.get("state") or "").upper()
    kind = alert_watcher._DEMO_NOTIFY.get(state)
    if not kind:
        return {"skipped": f"state {state} does not notify"}
    payload = alert_watcher.demo_message_for(alert, kind)
    payload["alert_id"] = alert.get("id")
    district = str(alert.get("district") or "")
    try:
        result = push_service.broadcast(payload, district=district)
    except Exception as exc:  # noqa: BLE001 - a dead push must not kill the demo action
        return {"error": f"{type(exc).__name__}: {exc}"}
    try:
        notification_service.log(
            kind, payload.get("title", ""), payload.get("body", ""),
            district=district, alert_id=str(alert.get("id") or ""),
            severity=str(alert.get("severity") or ""),
            push={k: result.get(k) for k in ("targeted", "delivered", "failed", "pruned")},
        )
        delivery_service.record_issue(str(alert.get("id") or ""), result.get("results") or [])
    except Exception:  # noqa: BLE001 - bookkeeping must not stop alerts
        pass
    # Mark this (alert, state) as already-notified so the background loop does
    # not double-send what the button just sent.
    try:
        from ..services.alert_watcher import _load_state, _save_state
        st = _load_state()
        seen = st.setdefault("_demo_notified", {})
        seen[f"{alert.get('id')}:{state}"] = payload.get("body", "")
        _save_state(st)
    except Exception:  # noqa: BLE001
        pass
    return {"notified": kind, "push": {k: result.get(k) for k in ("targeted", "delivered", "failed")}}


@router.post("/alerts")
@router.post("/alerts/")
async def create_alert(payload: dict) -> dict:
    _require_demo()
    try:
        alert = demo_alert_store.create(payload or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    notified = _notify_alert(alert)
    return {"alert_id": alert["id"], "state": alert["state"], "alert": alert,
            **notified, "generated_at": iso_now()}


@router.get("/alerts")
@router.get("/alerts/")
async def list_alerts(district: str = "") -> dict:
    _require_demo()
    return {"alerts": demo_alert_store.list_all(district), "generated_at": iso_now()}


@router.get("/alerts/{alert_id}")
async def get_alert(alert_id: str) -> dict:
    _require_demo()
    alert = demo_alert_store.get(alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="unknown alert")
    return {"alert": alert, "generated_at": iso_now()}


@router.post("/alerts/reset")
async def reset_alerts() -> dict:
    _require_demo()
    demo_alert_store.reset_store()
    return {"status": "reset", "generated_at": iso_now()}


# NOTE: literal routes must be declared BEFORE /{alert_id}/{action} so "reset",
# "notify" and "scenario" are never captured as an alert id.
@router.post("/alerts/notify")
async def notify_alert(payload: dict) -> dict:
    """Re-send (idempotently) the notification for the alert's current state."""
    _require_demo()
    alert_id = str((payload or {}).get("alert_id") or "")
    alert = demo_alert_store.get(alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="unknown alert")
    return {**_notify_alert(alert), "alert_id": alert_id, "state": alert.get("state"),
            "generated_at": iso_now()}


@router.post("/alerts/scenario")
async def create_scenario(payload: dict) -> dict:
    """One-button demo scenarios. All times are relative to NOW so the jury
    watches the lifecycle advance live instead of typing timestamps."""
    _require_demo()
    name = str((payload or {}).get("name") or "").strip().lower()
    now = now_ist()

    def t(delta_min: float) -> str:
        return (now + timedelta(minutes=delta_min)).isoformat()

    SCENARIOS: dict[str, dict] = {
        "thunderstorm": {
            "title": "Severe Thunderstorm Warning",
            "hazard": "Thunderstorm",
            "severity": "ORANGE",
            "district": "Hyderabad",
            "area": "Hyderabad district",
            "instruction": "Avoid unnecessary outdoor travel between the valid hours. Stay away from exposed areas and follow official safety guidance.",
            "pre_alert_at": t(0.2),   # ~12s from now: pre-alert pops on stage
            "starts_at": t(0.7),      # ~40s: alert goes ACTIVE
            "ends_at": t(3.0),        # ~3 min: ENDED notification closes the loop
        },
        "heatwave": {
            "title": "Heat Wave Warning",
            "hazard": "Heat wave",
            "severity": "YELLOW",
            "district": "Warangal",
            "area": "Warangal district",
            "instruction": "Avoid outdoor exposure during peak afternoon hours. Hydrate frequently; check on elderly neighbours.",
            "pre_alert_at": t(0.2),
            "starts_at": t(0.7),
            "ends_at": t(3.0),
        },
        "rain": {
            "title": "Heavy Rainfall Alert",
            "hazard": "Heavy rain",
            "severity": "ORANGE",
            "district": "Visakhapatnam",
            "area": "Visakhapatnam district",
            "instruction": "Waterlogging likely on low-lying roads. Commuters: avoid vulnerable routes during the peak period.",
            "pre_alert_at": t(0.2),
            "starts_at": t(0.7),
            "ends_at": t(3.0),
        },
        "cyclone": {
            "title": "Cyclone Alert",
            "hazard": "Cyclone",
            "severity": "RED",
            "district": "Kakinada",
            "area": "Kakinada district (coastal)",
            "instruction": "Fishermen: do not venture into the sea. Coastal residents: follow evacuation instructions from local authorities.",
            "pre_alert_at": t(0.2),
            "starts_at": t(0.7),
            "ends_at": t(3.0),
        },
    }
    if name not in SCENARIOS:
        raise HTTPException(status_code=400, detail=f"name must be one of {', '.join(sorted(SCENARIOS))}")
    try:
        alert = demo_alert_store.create(SCENARIOS[name])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # Pre-alert fires within seconds; let the 10s lifecycle loop deliver it.
    return {"alert_id": alert["id"], "state": alert["state"], "alert": alert,
            "scheduled": {"pre_alert_at": alert["pre_alert_at"],
                          "starts_at": alert["starts_at"], "ends_at": alert["ends_at"]},
            "generated_at": iso_now()}


@router.post("/alerts/{alert_id}/{action}")
async def act_on_alert(alert_id: str, action: str, payload: dict | None = None) -> dict:
    _require_demo()
    verb = normalise_action(action)
    if verb not in ACTIONS:
        raise HTTPException(status_code=400, detail=f"action must be one of {', '.join(ACTIONS)}")
    alert, error = demo_alert_store.apply_action(alert_id, verb, payload)
    if alert is None:
        raise HTTPException(status_code=404, detail="unknown alert")
    if error:
        raise HTTPException(status_code=409, detail=error)
    # Immediate feedback: a state change notifies NOW, not on the next loop tick.
    notified = _notify_alert(alert)
    return {"alert_id": alert["id"], "state": alert["state"], "alert": alert,
            **notified, "generated_at": iso_now()}


@router.post("/relay")
async def simulate_relay(payload: dict) -> dict:
    """One P2P hop: the alert travels device-to-device with no internet.

    Honest labelling: this records a P2P_RELAYED ledger entry and returns a hop
    trace marked SIMULATED. It proves the store-and-forward mechanism on stage;
    it is not a claim of nationwide P2P capability.
    """
    _require_demo()
    data = payload or {}
    alert_id = str(data.get("alert_id") or "")
    alert = demo_alert_store.get(alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="unknown alert")
    from_device = str(data.get("from_device") or "device-B")
    to_device = str(data.get("to_device") or "device-A")
    now = iso_now()
    try:
        delivery_service.record_relay(alert_id, to_device, from_device)
    except Exception:  # noqa: BLE001
        pass
    # P2P test #2: a relay writes a durable server notification so the
    # Notifications list shows it — honest SIMULATED labelling, the alert's
    # own authoritative severity, zero client invention.
    try:
        notification_service.log(
            "p2p-relay",
            f"SIMULATED relay: {alert.get('title') or alert.get('hazard') or alert_id}",
            f"This is a demo. Device {from_device} relayed the alert to {to_device} "
            "over the simulated phone-to-phone mesh — no real delivery happened.",
            district=str(alert.get("district") or ""),
            alert_id=alert_id,
            severity=str(alert.get("severity") or ""),
            channel="p2p-simulated",
        )
    except Exception:  # noqa: BLE001
        pass
    trace = [
        {"node": "you", "state": "has-alert", "at": now, "detail": f"{from_device} holds the alert (cached)"},
        {"node": "relay-a", "state": "p2p", "at": now, "detail": "device-to-device transfer, no internet"},
        {"node": "out", "state": "delivered", "at": now, "detail": f"{to_device} received the alert"},
    ]
    return {
        "status": "relayed",
        "alert_id": alert_id,
        "transport": "P2P (simulated)",
        "trace": trace,
        "ledger": delivery_service.record_event(alert_id, to_device, "opened"),
        "generated_at": now,
    }


@router.post("/coverage/seed")
async def seed_coverage(payload: dict) -> dict:
    """Seed a labelled SIMULATED audience for one alert's coverage dashboard."""
    _require_demo()
    alert_id = str((payload or {}).get("alert_id") or "")
    if demo_alert_store.get(alert_id) is None:
        raise HTTPException(status_code=404, detail="unknown alert")
    total = int((payload or {}).get("total") or 500)
    return {**delivery_service.seed_audience(alert_id, total=total), "generated_at": iso_now()}


@router.get("/coverage/{alert_id}")
async def get_coverage(alert_id: str) -> dict:
    _require_demo()
    cov = delivery_service.coverage(alert_id)
    if cov is None:
        raise HTTPException(status_code=404, detail="no delivery ledger for this alert")
    return {**cov, "generated_at": iso_now()}


@router.get("/coverage")
async def list_coverage() -> dict:
    _require_demo()
    return {"alerts": delivery_service.coverage_summary(), "generated_at": iso_now()}
