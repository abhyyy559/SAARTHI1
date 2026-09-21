"""Web Push delivery: the closed-app path, end to end (short of a real browser).

Worker 1's slice:
* the official-chain watcher payload carries alert_id + a ?view=alerts deep
  link before broadcast (check_district wiring);
* POST /api/push/test broadcasts to the district's subscribers — the honest
  proof of the closed-app path;
* broadcast prunes ONLY on 404/410 ("gone") — a 500 or timeout never silently
  unsubscribes a device;
* /api/push/subscribe validates its input honestly.
"""
import asyncio

import pytest
from fastapi.testclient import TestClient

from backend.services import alert_watcher, push_service
from backend.services import db
from backend.services.store_bridge import run

DISTRICT = "PushTestDistrict"
SUB = {
    "endpoint": "https://push.example.test/sub/1",
    "keys": {"p256dh": "p256dh-test", "auth": "auth-test"},
}


@pytest.fixture
def client():
    from backend.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_push():
    run(db.doc_clear("push_subscriptions"))
    alert_watcher._save_state({})
    yield
    run(db.doc_clear("push_subscriptions"))
    alert_watcher._save_state({})


def test_official_transition_payload_carries_alert_id_and_deep_link(monkeypatch):
    """A real lifecycle transition (MODERATE -> HIGH = escalate) broadcasts a
    payload with the official alert id and a deep link to the alert."""
    captured = {}

    async def fake_gather_alerts(**kwargs):
        return {"relevant": [{"id": "cap-999", "severity": "ORANGE"}],
                "nearby": [], "available": True}

    def fake_build_verdict(**kwargs):
        return {"level": "HIGH", "confirmed": True,
                "severity": "ORANGE", "hazard": "Heavy rain"}

    def fake_broadcast(payload, district=""):
        captured["payload"] = payload
        captured["district"] = district
        return {"targeted": 0, "delivered": 0, "pruned": 0, "failed": 0,
                "results": []}

    monkeypatch.setattr(alert_watcher.alert_service, "gather_alerts",
                        fake_gather_alerts)
    monkeypatch.setattr(alert_watcher, "build_verdict", fake_build_verdict)
    monkeypatch.setattr(push_service, "broadcast", fake_broadcast)
    monkeypatch.setattr(alert_watcher.notification_service, "log",
                        lambda *a, **k: None)
    monkeypatch.setattr(alert_watcher.LocationService, "lookup",
                        lambda self, d: {"district": d, "latitude": 1.0,
                                         "longitude": 2.0, "state": "S"})

    # Seed previous state: MODERATE -> HIGH escalates, which must broadcast.
    alert_watcher._save_state({DISTRICT: {"level": "MODERATE", "confirmed": True,
                                          "severity": "YELLOW",
                                          "hazard": "Heavy rain"}})

    result = asyncio.run(alert_watcher.check_district(DISTRICT))
    assert result["notified"] == "escalate"
    assert captured["district"] == DISTRICT
    payload = captured["payload"]
    # Raw CAP id (no `cap:` grouping prefix): the app matches ?alert= against
    # the alert's own id, so the tap expands the alert instead of landing on
    # the bare list.
    assert payload["alert_id"] == "cap-999"
    assert payload["url"] == "/?view=alerts&alert=cap-999"


def test_demo_payload_carries_alert_id_and_deep_link():
    alert = {"id": "demo-42", "district": DISTRICT, "severity": "RED",
             "hazard": "Cyclone", "title": "Test cyclone"}
    payload = alert_watcher.demo_message_for(alert, "active")
    assert payload["alert_id"] == "demo-42"
    assert payload["url"] == "/?view=alerts&alert=demo-42"


def test_message_for_without_id_links_to_alerts_view():
    payload = alert_watcher.message_for(
        "active", {"severity": "ORANGE", "hazard": "Heavy rain"}, DISTRICT)
    assert payload["alert_id"] == ""
    assert payload["url"] == "/?view=alerts"


def test_push_test_endpoint_broadcasts_to_district(client, monkeypatch):
    """POST /api/push/test proves the closed-app path: the SERVER sends to the
    district's subscribers (webpush itself is faked; the wiring is real)."""
    push_service.subscribe(dict(SUB), district=DISTRICT)
    sent = []

    def fake_send_one(subscription, payload):
        sent.append((subscription["endpoint"], payload))
        return True, "delivered"

    monkeypatch.setattr(push_service, "send_one", fake_send_one)

    r = client.post("/api/push/test", json={"district": DISTRICT})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "sent"
    assert body["delivered"] == 1
    endpoint, payload = sent[0]
    assert endpoint == SUB["endpoint"]
    assert payload["url"] == "/?view=alerts"


def test_broadcast_prunes_only_gone_subscriptions(monkeypatch):
    """Never silently unsubscribe: only a 404/410 ('gone') prunes a device. A
    500 or timeout keeps the subscription for the next attempt."""
    push_service.subscribe(
        {"endpoint": "https://push.example.test/gone",
         "keys": {"p256dh": "p", "auth": "a"}}, district=DISTRICT)
    push_service.subscribe(
        {"endpoint": "https://push.example.test/flaky",
         "keys": {"p256dh": "p", "auth": "a"}}, district=DISTRICT)

    def fake_send_one(subscription, payload):
        if "gone" in subscription["endpoint"]:
            return False, "gone"  # 404/410 from the push service
        return False, "webpush 500"  # temporary failure

    monkeypatch.setattr(push_service, "send_one", fake_send_one)

    result = push_service.broadcast({"title": "t", "body": "b"},
                                    district=DISTRICT)
    assert result["pruned"] == 1
    assert result["failed"] == 1
    remaining = [s["endpoint"] for s in push_service.subscriptions(DISTRICT)]
    assert remaining == ["https://push.example.test/flaky"]


def test_subscribe_validates_input(client):
    r = client.post("/api/push/subscribe", json={"subscription": {}})
    assert r.json()["status"] == "error"
    r = client.post("/api/push/subscribe",
                    json={"subscription": {"endpoint": "https://x"}})
    assert r.json()["status"] == "error"  # keys missing
    r = client.post("/api/push/subscribe",
                    json={"subscription": SUB, "district": DISTRICT,
                          "language": "te", "persona": "fisherman"})
    body = r.json()
    assert body["status"] == "subscribed"
    assert body["endpoint"] == SUB["endpoint"]
    assert body["district"] == DISTRICT
