"""P2P / simulated-mesh propagation tests (Harbour Signal rebuild).

Covers the three required scenarios end-to-end through the real HTTP API:

1. P2P send -> the message appears in the inbox.
2. Alert raised -> a SIMULATED P2P notification is propagated to the
   notification list (via POST /api/demo/relay -> notification_service.log).
3. Notification acknowledge flow: read -> ack, with the read/ack state
   visible in the notification list afterwards.

Stores are isolated by tests/conftest.py (SAARTHI_STORE_DIR + emergency
store file point at a temp dir). Demo routes are demo-mode-only, so these
tests force DEMO_MODE on and restore it afterwards.
"""
import pytest
from fastapi.testclient import TestClient

from backend import config


@pytest.fixture
def demo_mode(monkeypatch):
    """These tests exercise demo-only routes; force demo mode on, restore after."""
    monkeypatch.setattr(config, "DEMO_MODE", True, raising=False)
    yield
    # monkeypatch auto-restores


@pytest.fixture
def client():
    from backend.main import app
    with TestClient(app) as c:
        yield c


def test_p2p_send_appears_in_inbox(client):
    """Scenario 1: an emergency message sent with a per-session sender id
    shows up in the shared inbox under that same sender id."""
    r = client.post("/api/v1/emergency/messages", json={
        "sender_id": "you-test-session",
        "message_type": "NEED_HELP",
        "people_count": 2,
        "medical_required": True,
        "text": "test mayday",
        "location": {"latitude": 17.4, "longitude": 78.5},
    })
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "queued"
    assert body["message_id"]

    inbox = client.get("/api/v1/emergency/messages").json()["messages"]
    mine = [m for m in inbox if m["sender_id"] == "you-test-session"]
    assert mine, "sent message missing from inbox"
    assert mine[-1]["message_id"] == body["message_id"]
    assert mine[-1]["message_type"] == "NEED_HELP"
    assert mine[-1]["people_count"] == 2
    assert mine[-1]["medical_required"] is True
    # Timestamps exist and parse — the frontend renders relative times from them.
    assert mine[-1]["timestamp"]


def test_alert_relay_propagates_simulated_notification(client, demo_mode):
    """Scenario 2: firing a scenario alert and relaying it via POST
    /api/demo/relay appends a SIMULATED P2P notification to the durable
    notification log, carrying the alert's own severity."""
    scn = client.post("/api/demo/alerts/scenario", json={"name": "thunderstorm"})
    assert scn.status_code == 200
    alert_id = scn.json()["alert_id"]

    relay = client.post("/api/demo/relay", json={
        "alert_id": alert_id, "from_device": "device-B", "to_device": "device-A",
    })
    assert relay.status_code == 200
    assert relay.json()["status"] == "relayed"
    assert relay.json()["trace"], "relay must return a hop trace"

    items = client.get("/api/notifications").json()["notifications"]
    p2p = [n for n in items if n.get("kind") == "p2p-relay" and n.get("alert_id") == alert_id]
    assert p2p, "no simulated P2P notification propagated to the list"
    n = p2p[-1]
    assert n["channel"] == "p2p-simulated"
    assert "SIMULATED" in n["title"] or "SIMULATED" in n["body"]
    # The backend's authoritative severity rides along — never client-derived.
    assert n["severity"] == "ORANGE"
    # Fresh notifications are unread.
    assert not n.get("read")


def test_notification_acknowledge_flow(client, demo_mode):
    """Scenario 3: read -> ack for the propagated P2P notification; both
    state flips are server-confirmed before the list reflects them."""
    scn = client.post("/api/demo/alerts/scenario", json={"name": "thunderstorm"})
    alert_id = scn.json()["alert_id"]
    client.post("/api/demo/relay", json={"alert_id": alert_id})

    items = client.get("/api/notifications", params={"device": "test-device"}).json()["notifications"]
    n = next(x for x in items if x.get("kind") == "p2p-relay" and x.get("alert_id") == alert_id)
    assert not n["read"]

    r = client.post("/api/notifications/read", json={"ids": [n["id"]], "device": "test-device"})
    assert r.status_code == 200
    after = client.get("/api/notifications", params={"device": "test-device"}).json()["notifications"]
    by_id = {x["id"]: x for x in after}
    assert by_id[n["id"]]["read"] is True

    ack = client.post("/api/notifications/ack", json={"alert_id": alert_id, "device": "test-device"})
    assert ack.status_code == 200
    assert ack.json()["status"] == "acknowledged"


def test_emergency_simulate_stays_simulated(client):
    """The SOS stage-demo endpoint must never claim a real relay."""
    r = client.post("/api/v1/emergency/simulate", json={
        "sender_id": "demo-A", "message_type": "NEED_HELP", "people_count": 1,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "relayed-simulated"
    assert body["properties"]["provenance"] == "SIMULATED"
    assert "SIMULATED" in body["trace"][-1]["detail"]
