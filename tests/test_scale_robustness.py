"""SCALE robustness regression tests (2026-09-20).

Covers the dead-end fixes in the demo lifecycle / P2P relay / delivery ledger:
1. auto_advance_demo must not report a failed transition as taken.
2. record_pending writes honest PENDING rows and never regresses a reach record.
3. POST /api/demo/relay surfaces a ledger failure instead of silently
   claiming "relayed", and the response never 500s on bookkeeping failure.
   SIMULATED honesty labelling is asserted throughout.
"""
import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.services import alert_watcher, demo_alert_store, delivery_service


@pytest.fixture
def demo_mode(monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", True, raising=False)
    yield


@pytest.fixture
def client():
    from backend.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_stores():
    delivery_service.reset_store()
    demo_alert_store.reset_store()
    yield
    delivery_service.reset_store()
    demo_alert_store.reset_store()


def _alert(**fields):
    base = {"title": "Test storm", "district": "Hyderabad", "severity": "ORANGE"}
    base.update(fields)
    return demo_alert_store.create(base)


def test_auto_advance_ignores_failed_transitions(monkeypatch):
    """A transition the state machine rejects must not appear in `taken`."""
    _alert()
    monkeypatch.setattr(
        demo_alert_store, "apply_action",
        lambda aid, action, patch=None: ({"id": aid, "state": "UPCOMING"}, "terminal-state: CANCELLED"),
    )
    taken = alert_watcher.auto_advance_demo()
    assert taken == [], "failed transitions must not be reported as taken"


def test_auto_advance_still_advances_on_success():
    """Sanity: a due pre-alert boundary still advances normally."""
    from datetime import timedelta
    from backend.utils.time import now_ist
    past = (now_ist() - timedelta(seconds=5)).isoformat()
    a = _alert(pre_alert_at=past)
    taken = alert_watcher.auto_advance_demo()
    assert taken and taken[0]["state"] == "PRE-ALERT"
    assert demo_alert_store.get(a["id"])["state"] == "PRE-ALERT"


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


def test_broadcast_failure_leaves_pending_ledger(client, demo_mode, monkeypatch):
    """A total push failure must leave honest PENDING rows, not a silent
    empty ledger."""
    monkeypatch.setattr(
        "backend.services.push_service.broadcast",
        lambda payload, district="": (_ for _ in ()).throw(RuntimeError("vapid broken")),
    )
    # One fake subscriber so the failed broadcast has a known target.
    monkeypatch.setattr(
        "backend.services.push_service.subscriptions",
        lambda district="": [{"endpoint": "dev-1", "district": "Hyderabad"}],
    )
    scn = client.post("/api/demo/alerts/scenario", json={"name": "thunderstorm"})
    assert scn.status_code == 200
    alert_id = scn.json()["alert_id"]

    # Advance to a notifying state: the button-press push fails loudly...
    r = client.post(f"/api/demo/alerts/{alert_id}/pre-alert")
    assert r.status_code == 200
    assert "error" in r.json(), "push failure must be reported, not hidden"
    assert r.json()["state"] == "PRE-ALERT", "the state change itself must survive"

    # ...the watcher pass records the same failure instead of stopping...
    results = alert_watcher.check_demo_alerts()
    assert any(x.get("error") for x in results)

    # ...and the ledger shows the device as PENDING, never reached.
    cov = delivery_service.coverage(alert_id)
    assert cov is not None
    assert cov["real"]["PENDING"] == 1
    assert cov["real"]["DELIVERED"] == 0


def test_relay_reports_ledger_failure(client, demo_mode, monkeypatch):
    """A relay whose ledger write fails must say so in the response —
    it must not claim a clean "relayed". SIMULATED labelling stays."""
    scn = client.post("/api/demo/alerts/scenario", json={"name": "thunderstorm"})
    alert_id = scn.json()["alert_id"]

    def boom(*a, **k):
        raise RuntimeError("store down")

    monkeypatch.setattr(delivery_service, "record_relay", boom)
    monkeypatch.setattr(delivery_service, "record_event", boom)
    r = client.post("/api/demo/relay", json={"alert_id": alert_id})
    assert r.status_code == 200, "bookkeeping must not 500 a completed relay"
    body = r.json()
    assert body["status"] == "relayed-with-ledger-error"
    assert "ledger_error" in body
    assert body["transport"] == "P2P (simulated)"


def test_relay_still_relays_cleanly(client, demo_mode):
    """The happy path is unchanged: status "relayed", honest labelling."""
    scn = client.post("/api/demo/alerts/scenario", json={"name": "thunderstorm"})
    alert_id = scn.json()["alert_id"]
    body = client.post("/api/demo/relay", json={"alert_id": alert_id}).json()
    assert body["status"] == "relayed"
    assert "ledger_error" not in body
    assert body["ledger"]["status"] == "P2P_RELAYED"
