"""Round2 alert-pipeline tests: demo lifecycle -> notification log -> coverage.

The whole alert story the jury sees must work end to end without any external
service: create -> pre-alert -> active -> ended notifications logged, delivery
ledger seeded, P2P relay recorded, acknowledged counted. Isolation via the
DEMO_ALERT_STORE_FILE / NOTIFICATION_STORE_FILE / DELIVERY_STORE_FILE env vars
set in conftest.
"""
import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture()
def client():
    # DEMO_MODE defaults to true in tests (config reads .env; the repo .env sets
    # DEMO_MODE=true) — but never depend on it: force the demo flag for this suite.
    from backend import config
    config.DEMO_MODE = True
    with TestClient(app) as c:
        yield c
    # Clean the stores between tests so counting assertions stay exact.
    from backend.services import demo_alert_store, delivery_service, notification_service
    demo_alert_store.reset_store()
    delivery_service.reset_store()
    notification_service.reset_store()


def test_full_lifecycle_logs_notifications(client):
    from backend.services import notification_service

    r = client.post("/api/demo/alerts", json={
        "title": "Severe Thunderstorm", "hazard": "Thunderstorm", "severity": "ORANGE",
        "district": "Hyderabad", "area": "Hyderabad",
        "pre_alert_at": "2030-01-01T00:00:00+05:30",
        "starts_at": "2030-01-01T01:00:00+05:30",
        "ends_at": "2030-01-01T02:00:00+05:30",
    })
    assert r.status_code == 200, r.text
    alert_id = r.json()["alert_id"]

    # Lifecycle: every state change responds with the push outcome.
    for verb, state in (("pre-alert", "PRE-ALERT"), ("activate", "ACTIVE"), ("end", "ENDED")):
        r = client.post(f"/api/demo/alerts/{alert_id}/{verb}", json={})
        assert r.status_code == 200, r.text
        assert r.json()["state"] == state
        assert "notified" in r.json()

    # The notification center saw the same lifecycle the admin panel triggered.
    r = client.get("/api/notifications", params={"district": "Hyderabad", "device": "dev-x"})
    assert r.status_code == 200
    items = r.json()["notifications"]
    kinds = [n["kind"] for n in items]
    assert "pre-alert" in kinds and "active" in kinds and "ended" in kinds
    # Newest first.
    ats = [n["at"] for n in items]
    assert ats == sorted(ats, reverse=True)


def test_read_receipts_and_ack(client):
    from backend.services import notification_service

    r = client.post("/api/demo/alerts", json={
        "title": "Heavy rain", "district": "Hyderabad", "severity": "YELLOW",
    })
    alert_id = r.json()["alert_id"]
    client.post(f"/api/demo/alerts/{alert_id}/activate", json={})

    r = client.get("/api/notifications", params={"device": "dev-a"})
    items = r.json()["notifications"]
    assert items, "activation must log a notification"
    unread = r.json()["unread"]
    assert unread == len(items)

    ids = [n["id"] for n in items]
    r = client.post("/api/notifications/read", json={"ids": ids, "device": "dev-a"})
    assert r.json()["marked"] == len(ids)

    # Read state is per device: dev-b still sees everything unread.
    r = client.get("/api/notifications", params={"device": "dev-b"})
    assert r.json()["unread"] == len(ids)

    # Device telemetry: opened then acknowledged.
    r = client.post("/api/notifications/opened", json={"alert_id": alert_id, "device": "dev-a"})
    assert r.status_code == 200
    r = client.post("/api/notifications/ack", json={"alert_id": alert_id, "device": "dev-a"})
    assert r.status_code == 200
    # Engagement is reported separately from the reach channel, so neither
    # metric can hide the other.
    cov = client.get(f"/api/demo/coverage/{alert_id}").json()
    assert cov["real"]["engagement"]["acknowledged"] == 1
    assert cov["real"]["engagement"]["opened"] == 1
    assert cov["real"]["reached"] == 1


def test_p2p_relay_and_seed(client):
    r = client.post("/api/demo/alerts", json={
        "title": "Cyclone", "district": "Kakinada", "severity": "RED",
    })
    alert_id = r.json()["alert_id"]

    r = client.post("/api/demo/relay", json={"alert_id": alert_id, "from_device": "B", "to_device": "A"})
    assert r.status_code == 200
    assert r.json()["transport"].startswith("P2P")
    # The relay hop is a ledger event, visible in coverage — and it STAYS visible
    # as P2P reach even after the receiving device opens the alert.
    cov = client.get(f"/api/demo/coverage/{alert_id}").json()
    assert cov["real"]["P2P_RELAYED"] == 1

    r = client.post("/api/demo/coverage/seed", json={"alert_id": alert_id, "total": 100})
    assert r.json()["seeded"] == 100
    cov = client.get(f"/api/demo/coverage/{alert_id}").json()
    sim_total = sum(cov["simulated"][k] for k in
                    ("DELIVERED", "OPENED", "ACKNOWLEDGED", "P2P_RELAYED", "PENDING", "OFFLINE", "UNREACHABLE"))
    assert sim_total == 100
    # The simulated label travels with the payload — always.
    assert cov["simulated"]["label"] == "SIMULATED AUDIENCE"
    # Zones are populated for the simulated audience.
    assert any(z["total"] > 0 for z in cov["simulated"]["zones"])
    # Real and simulated stay separate.
    assert cov["real"]["reached"] == 1  # only the relayed device


def test_scenario_endpoint_schedules_lifecycle(client):
    r = client.post("/api/demo/alerts/scenario", json={"name": "thunderstorm"})
    assert r.status_code == 200
    body = r.json()
    assert body["alert"]["state"] == "UPCOMING"
    assert body["scheduled"]["starts_at"] > body["scheduled"]["pre_alert_at"]


def test_lifecycle_guards(client):
    r = client.post("/api/demo/alerts", json={"title": "X", "district": "Hyderabad"})
    alert_id = r.json()["alert_id"]
    # UPCOMING cannot jump straight to ENDED.
    r = client.post(f"/api/demo/alerts/{alert_id}/end", json={})
    assert r.status_code == 409
    # Unknown action is a 400.
    r = client.post(f"/api/demo/alerts/{alert_id}/explode", json={})
    assert r.status_code == 400
    # Terminal state rejects everything.
    client.post(f"/api/demo/alerts/{alert_id}/pre-alert", json={})
    client.post(f"/api/demo/alerts/{alert_id}/activate", json={})
    client.post(f"/api/demo/alerts/{alert_id}/end", json={})
    r = client.post(f"/api/demo/alerts/{alert_id}/activate", json={})
    assert r.status_code == 409


def test_auto_advance_moves_scheduled_alert(client):
    from backend.services import alert_watcher, demo_alert_store
    now_iso = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    # Window straddling NOW: started in the past, ends soon -> auto-ACTIVATES.
    r = client.post("/api/demo/alerts", json={
        "title": "Live storm", "district": "Hyderabad", "severity": "ORANGE",
        "starts_at": now_iso,
    })
    aid = r.json()["alert_id"]
    alert_watcher.auto_advance_demo()
    assert demo_alert_store.get(aid)["state"] == "ACTIVE"

    # Window entirely in the past -> CANCELLED, never a fake active/ended pair.
    r = client.post("/api/demo/alerts", json={
        "title": "Old storm", "district": "Hyderabad", "severity": "ORANGE",
        "pre_alert_at": "2020-01-01T00:00:00+05:30",
        "starts_at": "2020-01-01T01:00:00+05:30",
        "ends_at": "2020-01-01T02:00:00+05:30",
    })
    aid = r.json()["alert_id"]
    alert_watcher.auto_advance_demo()
    assert demo_alert_store.get(aid)["state"] == "CANCELLED"


def test_student_persona_advisory(client):
    r = client.get("/api/advisory", params={"severity": "ORANGE", "hazard": "Thunderstorm",
                                            "user_type": "student", "language": "en"})
    assert r.status_code == 200
    assert "school" in r.json()["advisory"].lower()
