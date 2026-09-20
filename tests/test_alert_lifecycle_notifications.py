"""Alert lifecycle -> notifications: every transition fires exactly once.

The user requirement: an alert's FULL lifecycle must reach the in-app
Notification Center — issued -> active -> extended/updated -> ended — for BOTH
chains:

* demo alerts (Admin-panel actions in demo mode): the HTTP action notifies
  immediately via `_notify_alert`, and the watcher loop never double-sends.
* the official SACHET/IMD chain (hybrid/IMD modes): `check_district` pushes
  AND logs every detected transition, including `updated` when a bulletin
  changes without moving the verdict level.

A missed transition is the failure under test: simulate the whole lifecycle
and assert the notification count and kinds match exactly.
"""
import asyncio

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.services import alert_watcher, demo_alert_store, notification_service
from backend.services import alert_service as alert_service_mod
from backend.services import push_service

DISTRICT = "LifecycleDistrict"


@pytest.fixture
def demo_mode(monkeypatch):
    """Demo-only routes; force demo mode on, restore afterwards."""
    monkeypatch.setattr(config, "DEMO_MODE", True, raising=False)
    yield


@pytest.fixture
def client():
    from backend.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_stores():
    notification_service.reset_store()
    demo_alert_store.reset_store()
    alert_watcher._save_state({})
    yield
    notification_service.reset_store()
    demo_alert_store.reset_store()
    alert_watcher._save_state({})


def _create_demo(client, **over):
    fields = {
        "title": "Lifecycle test storm",
        "hazard": "Thunderstorm",
        "severity": "ORANGE",
        "district": DISTRICT,
        "instruction": "Stay indoors.",
    }
    fields.update(over)
    r = client.post("/api/demo/alerts", json=fields)
    assert r.status_code == 200, r.text
    return r.json()["alert"]["id"]


def _kinds_newest_first():
    return [n["kind"] for n in notification_service.list_all()]


def test_demo_full_lifecycle_fires_exactly_four_notifications(client, demo_mode):
    """issue -> active -> extend -> end = exactly 4 notifications, in order."""
    aid = _create_demo(client)
    # UPCOMING does not notify: creation alone must stay silent.
    assert notification_service.list_all() == []

    plan = [("pre-alert", "pre-alert"), ("activate", "active"),
            ("extend", "extended"), ("end", "ended")]
    for action, expected_kind in plan:
        r = client.post(f"/api/demo/alerts/{aid}/{action}")
        assert r.status_code == 200, f"{action}: {r.text}"
        assert r.json().get("notified") == expected_kind

    kinds = list(reversed(_kinds_newest_first()))
    assert kinds == ["pre-alert", "active", "extended", "ended"], kinds
    assert len(notification_service.list_all()) == 4

    for n in notification_service.list_all():
        # Every notification carries the contract the inbox needs: alert id,
        # district, server-set severity, transition label and timestamp.
        assert n["alert_id"] == aid
        assert n["district"] == DISTRICT
        assert n["severity"] == "ORANGE"
        assert n["kind"] in ("pre-alert", "active", "extended", "ended")
        assert n["at"], "notification must carry a timestamp"
        assert n["title"] and n["body"]

    # The watcher loop must not double-send what the actions already sent.
    assert alert_watcher.check_demo_alerts() == []
    assert len(notification_service.list_all()) == 4


def test_demo_update_fires_updated_notification(client, demo_mode):
    """An in-flight content update is its own transition, not silence."""
    aid = _create_demo(client)
    client.post(f"/api/demo/alerts/{aid}/activate")
    r = client.post(f"/api/demo/alerts/{aid}/update",
                    json={"instruction": "Updated: avoid the riverbank."})
    assert r.status_code == 200, r.text
    assert r.json().get("notified") == "updated"
    kinds = list(reversed(_kinds_newest_first()))
    assert kinds == ["active", "updated"], kinds


def _cap_alert(aid, severity="ORANGE", sent="2026-09-20T10:00:00+05:30"):
    return {
        "id": aid,
        "severity": severity,
        "hazard": "Thunderstorm",
        "event": "Thunderstorm",
        "headline": "Thunderstorm warning",
        "source": "NDMA-Sachet-CAP",
        "sent": sent,
        "expires": "2026-09-21T10:00:00+05:30",
        "relevance": {"relevant": True},
    }


@pytest.fixture
def official_chain(monkeypatch):
    """Drive check_district with scripted CAP feeds; broadcast is stubbed."""
    feeds = {"alerts": [], "available": True}
    broadcast_calls = []

    async def fake_gather(lat=None, lon=None, district="", state=""):
        return {"relevant": list(feeds["alerts"]), "nearby": [],
                "available": feeds["available"]}

    def fake_broadcast(payload, district=""):
        broadcast_calls.append(payload)
        return {"targeted": 1, "delivered": 1, "failed": 0, "pruned": 0, "results": []}

    monkeypatch.setattr(alert_service_mod, "gather_alerts", fake_gather)
    monkeypatch.setattr(push_service, "broadcast", fake_broadcast)
    return feeds, broadcast_calls


def run(coro):
    return asyncio.run(coro)


def test_official_chain_logs_start_escalate_clear(official_chain):
    """CAP chain: start -> escalate -> clear each land in the inbox exactly once."""
    feeds, _ = official_chain

    # First sighting is recorded, never announced: a calm baseline.
    feeds["alerts"] = []
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] is None
    assert notification_service.list_all() == []

    # The warning arrives: one "start".
    feeds["alerts"] = [_cap_alert("cap-a", "ORANGE")]
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] == "start"
    notes = notification_service.list_all()
    assert len(notes) == 1
    n = notes[0]
    assert n["kind"] == "start"
    assert n["alert_id"] == "cap:cap-a"
    assert n["district"] == DISTRICT
    assert n["severity"] == "ORANGE"
    assert n["at"]

    # Same bulletin again: silence.
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] is None
    assert len(notification_service.list_all()) == 1

    # Escalation: new severity, one notification.
    feeds["alerts"] = [_cap_alert("cap-a", "RED")]
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] == "escalate"
    assert len(notification_service.list_all()) == 2

    # Feed goes quiet but reachable: confirmed calm -> one "clear".
    feeds["alerts"] = []
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] == "clear"
    kinds = [n["kind"] for n in notification_service.list_all()]
    assert kinds == ["clear", "escalate", "start"], kinds


def test_official_chain_same_level_new_bulletin_fires_updated(official_chain):
    """A re-issued bulletin at the same severity is an update, not silence."""
    feeds, _ = official_chain

    # Calm baseline first (first sighting never announces).
    feeds["alerts"] = []
    assert run(alert_watcher.check_district(DISTRICT))["notified"] is None

    feeds["alerts"] = [_cap_alert("cap-a", "ORANGE", sent="2026-09-20T10:00:00+05:30")]
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] == "start"
    assert len(notification_service.list_all()) == 1

    # Same id, same sent: nothing new.
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] is None

    # New bulletin id at the same severity: the verdict does not move, but the
    # warning changed — the user must hear "Alert update".
    feeds["alerts"] = [_cap_alert("cap-b", "ORANGE", sent="2026-09-20T12:00:00+05:30")]
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] == "updated"
    notes = notification_service.list_all()
    assert len(notes) == 2
    newest = notes[0]
    assert newest["kind"] == "updated"
    assert newest["alert_id"] == "cap:cap-b"
    assert newest["severity"] == "ORANGE"
    assert "update" in newest["title"].lower()

    # Repeating the same bulletin: silence again.
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] is None
    assert len(notification_service.list_all()) == 2


def test_official_chain_unreachable_feed_never_clears(official_chain):
    """A dead feed is not an all-clear: no 'clear' on unconfirmed verdicts."""
    feeds, _ = official_chain

    feeds["alerts"] = []
    run(alert_watcher.check_district(DISTRICT))  # calm baseline
    feeds["alerts"] = [_cap_alert("cap-a", "ORANGE")]
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] == "start"
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] is None
    assert len(notification_service.list_all()) == 1  # the start

    # Feed dies: verdict becomes unconfirmed, decide() must stay silent.
    feeds["alerts"] = []
    feeds["available"] = False
    out = run(alert_watcher.check_district(DISTRICT))
    assert out["notified"] is None
    assert len(notification_service.list_all()) == 1
