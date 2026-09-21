"""Alerts redesign: full-lifecycle detail (started / completed-or-expected-end /
effects / issuer / reason) on demo and official alerts.

The contract: the backend only ever reports fields it actually has. A missing
field stays None and the UI says "not available" honestly — nothing is
invented.
"""
from backend.services import alert_service, demo_alert_store


def test_lifecycle_detail_cap_alert_maps_official_fields():
    alert = {
        "source": "NDMA-Sachet-CAP",
        "identifier": "cap-1",
        "sender": "ndma@gov.in",
        "onset": "2026-09-21T06:00:00+05:30",
        "expires": "2026-09-22T06:00:00+05:30",
        "urgency": "Expected",
        "certainty": "Likely",
        "description": "Heavy rain with gusty winds",
    }
    lc = alert_service.lifecycle_detail(alert)
    assert lc["started_at"] == "2026-09-21T06:00:00+05:30"
    assert lc["expected_end_at"] == "2026-09-22T06:00:00+05:30"
    # The feed said nothing about completion: honest None, not a guess.
    assert lc["completed_at"] is None
    assert lc["issuer"] == "ndma@gov.in"
    assert lc["reason"] == "Expected, Likely"
    assert lc["effects"] == "Heavy rain with gusty winds"


def test_lifecycle_detail_official_fallbacks_stay_honest():
    lc = alert_service.lifecycle_detail({"identifier": "cap-x"})
    assert lc["started_at"] is None
    assert lc["expected_end_at"] is None
    assert lc["completed_at"] is None
    # No sender: the known feed name, not an invented issuer.
    assert lc["issuer"] == alert_service.CAP_SOURCE
    assert lc["reason"] is None
    assert lc["effects"] is None


def test_lifecycle_detail_bad_input_is_empty_not_a_crash():
    for bad in (None, [], "nope", 42):
        lc = alert_service.lifecycle_detail(bad)
        assert all(v is None for v in lc.values())


def test_demo_store_create_accepts_lifecycle_fields():
    demo_alert_store.reset_store()
    try:
        a = demo_alert_store.create({
            "title": "Flood drill", "district": "Hyderabad", "severity": "ORANGE",
            "issuer": "NDMA demo desk", "reason": "Heavy rainfall forecast",
            "effects": "Low-lying areas may flood",
            "ends_at": "2026-09-21T18:00:00+05:30",
        })
        lc = a["lifecycle_detail"]
        assert lc["issuer"] == "NDMA demo desk"
        assert lc["reason"] == "Heavy rainfall forecast"
        assert lc["effects"] == "Low-lying areas may flood"
        assert lc["expected_end_at"] == "2026-09-21T18:00:00+05:30"
        # UPCOMING: it has not started, so started_at is None.
        assert lc["started_at"] is None
        assert lc["completed_at"] is None
    finally:
        demo_alert_store.reset_store()


def test_demo_store_stamps_started_and_completed_on_transitions():
    demo_alert_store.reset_store()
    try:
        a = demo_alert_store.create({
            "title": "Flood drill", "district": "Hyderabad", "severity": "ORANGE",
        })
        aid = a["id"]
        demo_alert_store.apply_action(aid, "activate")
        g = demo_alert_store.get(aid)
        assert g["started_at"], "activate must stamp started_at"
        assert g["lifecycle_detail"]["started_at"] == g["started_at"]
        # Re-entering ACTIVE must not overwrite the earlier stamp.
        first = g["started_at"]
        demo_alert_store.apply_action(aid, "update")
        assert demo_alert_store.get(aid)["started_at"] == first
        demo_alert_store.apply_action(aid, "end")
        g = demo_alert_store.get(aid)
        assert g["completed_at"], "end must stamp completed_at"
        assert g["lifecycle_detail"]["completed_at"] == g["completed_at"]
        # A UPCOMING alert that is cancelled never started.
        b = demo_alert_store.create({
            "title": "Cancel drill", "district": "Hyderabad", "severity": "YELLOW",
        })
        demo_alert_store.apply_action(b["id"], "cancel")
        c = demo_alert_store.get(b["id"])
        assert c["started_at"] is None
        assert c["completed_at"]
    finally:
        demo_alert_store.reset_store()


def test_demo_store_patch_can_edit_lifecycle_fields():
    demo_alert_store.reset_store()
    try:
        a = demo_alert_store.create({
            "title": "Edit drill", "district": "Hyderabad", "severity": "YELLOW",
        })
        # "update" is only a legal verb once the alert has left UPCOMING.
        _, act_err = demo_alert_store.apply_action(a["id"], "activate")
        assert act_err is None
        updated, err = demo_alert_store.apply_action(
            a["id"], "update",
            {"issuer": "IMD demo cell", "reason": "Cyclone watch", "effects": "Strong winds"},
        )
        assert err is None
        assert updated["issuer"] == "IMD demo cell"
        assert updated["lifecycle_detail"]["reason"] == "Cyclone watch"
        assert updated["lifecycle_detail"]["effects"] == "Strong winds"
    finally:
        demo_alert_store.reset_store()


def test_list_all_attaches_lifecycle_detail():
    demo_alert_store.reset_store()
    try:
        demo_alert_store.create({"title": "List drill", "district": "Hyderabad"})
        items = demo_alert_store.list_all("Hyderabad")
        assert items and all("lifecycle_detail" in i for i in items)
    finally:
        demo_alert_store.reset_store()
