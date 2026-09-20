"""ISOLATED Unit Test for alert_service lifecycle (T1.1 S1.1.1).
Target: weathergpt/backend/services/alert_service.py
Session: ses_t11

WARNING: THIS FILE WILL BE DELETED AFTER TEST PASSES.
Test code preserved in: .opencode/unit-tests/
"""
import sys
from pathlib import Path

# Add weathergpt/ so `backend.*` imports resolve.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services import alert_service


def test_lifecycle_states_present():
    for s in ["UPCOMING", "PRE-ALERT", "ACTIVE", "UPDATED", "EXTENDED", "ENDED", "CANCELLED"]:
        assert s in alert_service.LIFECYCLE, f"missing state {s}"


def test_valid_transitions_admin_verbs():
    vt = alert_service.VALID_TRANSITIONS
    assert vt[("UPCOMING", "pre-alert")] == "PRE-ALERT"
    assert vt[("UPCOMING", "activate")] == "ACTIVE"
    assert vt[("UPCOMING", "cancel")] == "CANCELLED"
    assert vt[("ACTIVE", "update")] == "UPDATED"
    assert vt[("ACTIVE", "extend")] == "EXTENDED"
    assert vt[("ACTIVE", "end")] == "ENDED"


def test_set_lifecycle_pure_full_walk():
    alert = {"state": "UPCOMING"}
    for verb, expect in [("pre-alert", "PRE-ALERT"), ("activate", "ACTIVE"),
                         ("update", "UPDATED"), ("extend", "EXTENDED"), ("end", "ENDED")]:
        new_state, err = alert_service.set_lifecycle(alert, verb)
        assert err is None, f"{verb} failed: {err}"
        assert new_state == expect
        assert alert["state"] == expect


def test_set_lifecycle_rejects_bad_and_terminal():
    alert = {"state": "UPCOMING"}
    _, err = alert_service.set_lifecycle(alert, "bogus-verb")
    assert err is not None
    assert alert["state"] == "UPCOMING"  # untouched on failure
    ended = {"state": "ENDED"}
    _, err2 = alert_service.set_lifecycle(ended, "update")
    assert err2 is not None
    assert ended["state"] == "ENDED"


def test_lifecycle_state_and_timeline_never_raise():
    assert alert_service.lifecycle_state(None) == "UPCOMING"
    assert alert_service.lifecycle_state({"state": "weird"}) == "UPCOMING"
    assert alert_service.lifecycle_state({"state": "active"}) == "ACTIVE"
    assert alert_service.timeline(None) == []
    assert alert_service.timeline({"history": [{"at": "x", "action": "create"}]}) == [
        {"at": "x", "action": "create"}]
