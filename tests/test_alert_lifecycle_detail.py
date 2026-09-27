"""Alerts redesign: full-lifecycle detail (started / completed-or-expected-end /
effects / issuer / reason) on demo and official alerts.

The contract: the backend only ever reports fields it actually has. A missing
field stays None and the UI says "not available" honestly — nothing is
invented.
"""
from backend.services import alert_service


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
