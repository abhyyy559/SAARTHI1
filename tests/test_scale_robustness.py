"""SCALE robustness regression tests (2026-09-20, updated 2026-09-23).

Covers the dead-end fixes in the delivery ledger:
1. record_pending writes honest PENDING rows and never regresses a reach record.
2. A failed OS push on the official chain must still log the transition to
   the in-app notification inbox — the durable trail survives push failures.
3. (deleted) auto_advance_demo tests — the demo alert machinery was removed
   with demo mode. (deleted) POST /api/demo/relay bookkeeping tests — the
   endpoint was removed; real device-to-device relay is the client-side QR flow.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from backend.services import alert_watcher, demo_alert_store, delivery_service


@pytest.fixture(autouse=True)
def clean_stores():
    from backend.services import notification_service
    delivery_service.reset_store()
    demo_alert_store.reset_store()
    notification_service.reset_store()
    alert_watcher._save_state({})
    yield
    delivery_service.reset_store()
    demo_alert_store.reset_store()
    notification_service.reset_store()
    alert_watcher._save_state({})


def test_record_pending_never_regresses_reach():
    aid = "demo-x1"
    delivery_service.record_pending(aid, ["dev-a"])
    devs = delivery_service.coverage(aid)["real"]
    assert devs["PENDING"] == 1

    # A later successful push resolves PENDING -> DELIVERED.
    delivery_service.record_issue(aid, [{"device": "dev-a", "delivered": True, "reason": ""}])
    devs = delivery_service.coverage(aid)["real"]
    assert devs["PENDING"] == 0 and devs["DELIVERED"] == 1

    # But PENDING must not un-reach a device the ledger already knows reached.
    delivery_service.record_pending(aid, ["dev-a"])
    devs = delivery_service.coverage(aid)["real"]
    assert devs["DELIVERED"] == 1 and devs["PENDING"] == 0

    # Simulated rows stay separated from real rows.
    assert delivery_service.coverage(aid)["simulated"]["PENDING"] == 0


def test_broadcast_failure_still_logs_the_transition(monkeypatch):
    """A total push failure must not swallow the transition: the check result
    reports the honest push outcome and the notification log still records it
    — the in-app inbox is the durable trail even when the OS push fails."""
    from backend.services import notification_service, push_service

    feeds = {"alerts": [], "available": True}

    async def fake_gather(lat=None, lon=None, district="", state=""):
        return {"relevant": list(feeds["alerts"]), "nearby": [],
                "available": feeds["available"]}

    monkeypatch.setattr(alert_watcher.alert_service, "gather_alerts", fake_gather)
    monkeypatch.setattr(
        push_service, "broadcast",
        lambda payload, district="": {"targeted": 1, "delivered": 0, "failed": 1,
                                      "pruned": 0, "results": [{"error": "vapid broken"}]},
    )

    district = "ScaleDistrict"
    # Calm baseline: first sighting is recorded, never announced.
    out = asyncio.run(alert_watcher.check_district(district))
    assert out["notified"] is None

    # The warning arrives with a broken push backend.
    now = datetime.now(timezone.utc)
    feeds["alerts"] = [{
        "id": "cap-1", "severity": "ORANGE", "hazard": "Thunderstorm",
        "event": "Thunderstorm", "headline": "Thunderstorm warning",
        "source": "NDMA-Sachet-CAP",
        "sent": "2026-09-20T10:00:00+05:30",
        "expires": (now + timedelta(hours=6)).isoformat(),
        "relevance": {"relevant": True},
    }]
    out = asyncio.run(alert_watcher.check_district(district))
    assert out["notified"] == "start", out
    push = out["push"]
    assert push["failed"] == 1 and push["delivered"] == 0, push

    # The transition still landed in the notification log.
    notes = notification_service.list_all()
    assert len(notes) == 1, notes
    n = notes[0]
    assert n["kind"] == "start"
    assert n["district"] == district
    assert n["push"] == {"targeted": 1, "delivered": 0, "failed": 1, "pruned": 0}
