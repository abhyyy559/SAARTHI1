"""Official warning lifecycle -> notifications (non-demo).

Restored from the deleted test_alert_lifecycle_notifications.py: the demo-only
tests are gone with the demo store, but the official SACHET/IMD chain
transition coverage (start -> escalate -> clear, updated bulletins, and the
never-clear-on-unreachable-feed honesty rule) is mode-independent and must
stay green in the single IMD-first mode.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from backend.services import alert_watcher, notification_service
from backend.services import alert_service as alert_service_mod
from backend.services import push_service

DISTRICT = "LifecycleDistrict"


@pytest.fixture(autouse=True)
def clean_stores():
    notification_service.reset_store()
    alert_watcher._save_state({})
    yield
    notification_service.reset_store()
    alert_watcher._save_state({})


def _cap_alert(aid, severity="ORANGE", sent="2026-09-20T10:00:00+05:30"):
    # `expires` must always be in the future: these tests exercise the
    # transition logic, not the clock.
    now = datetime.now(timezone.utc)
    return {
        "id": aid,
        "severity": severity,
        "hazard": "Thunderstorm",
        "event": "Thunderstorm",
        "headline": "Thunderstorm warning",
        "source": "NDMA-Sachet-CAP",
        "sent": sent,
        "expires": (now + timedelta(hours=6)).isoformat(),
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
    assert n["alert_id"] == "cap-a"
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
    assert newest["alert_id"] == "cap-b"
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
