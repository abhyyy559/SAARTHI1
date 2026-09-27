"""Offline evaluation + P2P relay chain tests (Agent 2).

Proves the two demo game-changer claims without any network:

1. OFFLINE EVALUATION: the demo alert store + the watcher's clock-driven
   evaluation advance an alert through its lifecycle purely from data already
   on the device — no fetch, no push network, no external call. A phone that
   cached the alert yesterday still sees it go ACTIVE today.
2. P2P RELAY CHAIN: the extended /api/demo/relay reports per-hop outcomes
   (relayed / failed / not-attempted), never claims a delivery that failed,
   and stays demo-gated (403 outside demo mode).

Stores are isolated by tests/conftest.py. Demo routes are demo-mode-only, so
these tests force DEMO_MODE on and restore it afterwards.
"""
import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.services import alert_watcher, demo_alert_store, notification_service


@pytest.fixture
def demo_mode(monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", True, raising=False)
    yield


@pytest.fixture
def client():
    from backend.main import app
    with TestClient(app) as c:
        yield c


def _fresh_alert(**over):
    """Create a demo alert with an explicit schedule relative to now."""
    from datetime import timedelta
    from backend.utils.time import now_ist
    now = now_ist()
    payload = {
        "title": "Offline test alert",
        "hazard": "Thunderstorm",
        "severity": "ORANGE",
        "district": "Hyderabad",
        "pre_alert_at": (now - timedelta(minutes=5)).isoformat(),
        "starts_at": (now - timedelta(minutes=2)).isoformat(),
        "ends_at": (now + timedelta(minutes=30)).isoformat(),
    }
    payload.update(over)
    return demo_alert_store.create(payload)


def test_offline_store_evaluation_advances_lifecycle_without_network(demo_mode):
    """The watcher's clock evaluation moves a cached alert UPCOMING ->
    PRE-ALERT -> ACTIVE from store data alone, and check_demo_alerts logs the
    matching notifications. No network is touched: this is the offline path."""
    alert = _fresh_alert()
    assert alert["state"] == "UPCOMING"

    # Both pre_alert_at and starts_at are in the past: the clock evaluation
    # moves the alert straight to ACTIVE (the starts boundary wins when both
    # have passed — the pre-alert instant is implied, not faked).
    taken = alert_watcher.auto_advance_demo()
    assert any(t["action"] == "activate" and t["state"] == "ACTIVE" for t in taken), taken

    got = demo_alert_store.get(alert["id"])
    assert got["state"] == "ACTIVE"

    results = alert_watcher.check_demo_alerts()
    kinds = {r.get("notified") for r in results if r.get("alert_id") == alert["id"]}
    assert "active" in kinds, results

    items = notification_service.list_all() if hasattr(notification_service, "list_all") else []
    mine = [n for n in items if n.get("alert_id") == alert["id"] and n.get("kind") == "active"]
    assert mine, "active notification missing from the log"
    # Authoritative severity rides along — the offline path never invents one.
    assert mine[-1]["severity"] == "ORANGE"


def test_offline_store_evaluation_ends_expired_alert(demo_mode):
    """An alert that is ACTIVE when its ends_at passes while 'offline'
    evaluates to ENDED and the ended notification is logged — the user is
    told it is over, from cached data alone."""
    from datetime import timedelta
    from backend.utils.time import now_ist
    now = now_ist()
    alert = demo_alert_store.create({
        "title": "Expired offline alert",
        "hazard": "Heavy rain",
        "severity": "YELLOW",
        "district": "Warangal",
        "pre_alert_at": (now - timedelta(minutes=60)).isoformat(),
        "starts_at": (now - timedelta(minutes=55)).isoformat(),
        "ends_at": (now + timedelta(minutes=30)).isoformat(),
    })
    alert_watcher.auto_advance_demo()
    assert demo_alert_store.get(alert["id"])["state"] == "ACTIVE"
    # The alert's valid window now lapses while the device is "offline":
    # move ends_at into the past via a store edit, then evaluate the clock.
    ended, err = demo_alert_store.apply_action(
        alert["id"], "update", {"ends_at": (now - timedelta(minutes=1)).isoformat()})
    assert err is None, err
    taken = alert_watcher.auto_advance_demo()
    assert any(t["action"] == "end" and t["state"] == "ENDED" for t in taken), taken
    alert_watcher.check_demo_alerts()
    items = notification_service.list_all()
    mine = [n for n in items if n.get("alert_id") == alert["id"] and n.get("kind") == "ended"]
    assert mine, "ended notification missing from the log"


def test_offline_evaluation_is_idempotent(demo_mode):
    """Re-running the offline evaluation never double-notifies: each
    (alert, state) notifies exactly once, even across restarts of the loop."""
    alert = _fresh_alert()
    alert_watcher.auto_advance_demo()
    first = alert_watcher.check_demo_alerts()
    second = alert_watcher.check_demo_alerts()
    first_kinds = [r.get("notified") for r in first if r.get("alert_id") == alert["id"]]
    second_kinds = [r.get("notified") for r in second if r.get("alert_id") == alert["id"]]
    assert first_kinds, "expected at least one notification on the first pass"
    assert second_kinds == [], f"double-notify on second pass: {second_kinds}"


def test_relay_multihop_trace_reports_each_hop(client, demo_mode):
    """hops=3 returns one trace entry per hop, all relayed, and the durable
    notification carries the alert's own severity."""
    scn = client.post("/api/demo/alerts/scenario", json={"name": "thunderstorm"})
    alert_id = scn.json()["alert_id"]

    r = client.post("/api/demo/relay", json={"alert_id": alert_id, "hops": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "relayed"
    assert body["hops"] == 3
    assert [h["state"] for h in body["hop_states"]] == ["relayed", "relayed", "relayed"]
    assert body["failed_at_hop"] is None
    assert len(body["trace"]) == 5  # you + 3 hops + out
    assert body["trace"][-1]["state"] == "delivered"

    items = client.get("/api/notifications").json()["notifications"]
    p2p = [n for n in items if n.get("kind") == "p2p-relay" and n.get("alert_id") == alert_id]
    assert p2p, "relay must be logged as a p2p-relay notification"
    assert p2p[-1]["severity"] == "ORANGE"
    assert "SIMULATED" in (p2p[-1]["title"] + p2p[-1]["body"])


def test_relay_failed_hop_never_claims_delivery(client, demo_mode):
    """fail_at_hop=2: status failed, hop 2 failed, hop 3 not attempted, the
    notification says FAILED — the endpoint never reports a delivery that
    did not happen."""
    scn = client.post("/api/demo/alerts/scenario", json={"name": "rain"})
    alert_id = scn.json()["alert_id"]

    r = client.post("/api/demo/relay", json={"alert_id": alert_id, "hops": 3, "fail_at_hop": 2})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "failed"
    assert body["failed_at_hop"] == 2
    assert [h["state"] for h in body["hop_states"]] == ["relayed", "failed", "not-attempted"]
    assert body["trace"][-1]["state"] == "failed"

    items = client.get("/api/notifications").json()["notifications"]
    p2p = [n for n in items if n.get("kind") == "p2p-relay" and n.get("alert_id") == alert_id]
    assert p2p
    assert "failed" in p2p[-1]["title"].lower()


def test_relay_validates_hop_arguments(client, demo_mode):
    """Out-of-range hops / fail_at_hop are rejected, not silently clamped."""
    scn = client.post("/api/demo/alerts/scenario", json={"name": "heatwave"})
    alert_id = scn.json()["alert_id"]
    assert client.post("/api/demo/relay", json={"alert_id": alert_id, "hops": 0}).status_code == 400
    assert client.post("/api/demo/relay", json={"alert_id": alert_id, "hops": 9}).status_code == 400
    r = client.post("/api/demo/relay", json={"alert_id": alert_id, "hops": 2, "fail_at_hop": 3})
    assert r.status_code == 400
    assert client.post("/api/demo/relay", json={"alert_id": "no-such-alert"}).status_code == 404


def test_relay_stays_demo_gated(client, monkeypatch):
    """Outside demo mode the relay is a 403 — the simulated mesh can never
    run against live data."""
    monkeypatch.setattr(config, "DEMO_MODE", False, raising=False)
    assert client.post("/api/demo/relay", json={"alert_id": "x"}).status_code == 403
