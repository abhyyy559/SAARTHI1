"""P2P propagation tests (Harbour Signal rebuild).

Covers the two genuine P2P paths end-to-end through the real HTTP API:

1. P2P send -> the message appears in the inbox (local-relay transport).
2. The SOS stage-drill endpoint stays honestly labelled SIMULATED.

The server-side simulated relay (POST /api/demo/relay) was deleted: it
fabricated hop traces and ledger rows (simulated:false) for a device-to-device
delivery that never happened. Real device-to-device relay is the client-side
QR flow (frontend-react/src/p2pqr.js), covered by the node test suite.

Stores are isolated by tests/conftest.py (SAARTHI_STORE_DIR + emergency
store file point at a temp dir).
"""
import pytest
from fastapi.testclient import TestClient


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
