"""QA: the /api/ack + /api/coverage contract (Round2 T3.3).

Independent of the reviewer's suite. Pins the contract as stated:

  * the response always carries {status, endpoint, alert_id, district, telemetry,
    ledger, generated_at};
  * only opened / acknowledged / p2p_relayed bridge into the per-alert ledger;
    delivered / pending / offline / unreachable return `ledger: null`;
  * unknown event and missing fields are 400, never 500;
  * GET /api/coverage?district= aggregates the district telemetry.

The alias cases are a real regression found in QA: push_service accepts
documented aliases ("ack", "open", "p2p", ...) and stores the CANONICAL event,
but the ack handler bridged on the RAW event — so every alias recorded district
telemetry yet silently skipped the per-alert ledger.
"""
import pytest
from fastapi.testclient import TestClient

from backend.main import app

CONTRACT_KEYS = {"status", "endpoint", "alert_id", "district", "telemetry",
                 "ledger", "generated_at"}

# raw spelling -> canonical event push_service stores
ALIASES = {
    "ack": "acknowledged", "acked": "acknowledged", "acknowledge": "acknowledged",
    "open": "opened", "p2p": "p2p_relayed", "p2p_relay": "p2p_relayed",
    "ACK": "acknowledged", "OPENED": "opened",
}
BRIDGE = {"opened", "acknowledged", "p2p_relayed"}
NON_BRIDGE = {"delivered", "pending", "offline", "unreachable"}


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c
    from backend.services import delivery_service, push_service
    delivery_service.reset_store()
    push_service.reset_telemetry()


def _ack(client, endpoint, alert_id, event, district="Hyderabad"):
    return client.post("/api/ack", json={
        "endpoint": endpoint, "alert_id": alert_id, "event": event, "district": district})


def test_response_always_has_every_contract_key(client):
    r = _ack(client, "ep-keys", "qa-keys", "delivered")
    assert r.status_code == 200, r.text
    assert CONTRACT_KEYS <= set(r.json()), r.json()


@pytest.mark.parametrize("raw,canonical", sorted(ALIASES.items()))
def test_aliases_bridge_into_the_ledger_with_the_canonical_status(client, raw, canonical):
    r = _ack(client, f"ep-alias-{raw}", f"qa-alias-{raw}", raw)
    assert r.status_code == 200, r.text
    body = r.json()
    # status must be the canonical event, not the raw alias spelling.
    assert body["status"] == canonical, body
    assert body["telemetry"]["event"] == canonical, body
    # every alias maps to a bridging event, so the ledger MUST be written.
    assert canonical in BRIDGE
    assert body["ledger"] is not None, f"alias {raw!r} recorded telemetry but skipped the ledger"


@pytest.mark.parametrize("event", sorted(NON_BRIDGE))
def test_non_bridging_events_never_touch_the_ledger(client, event):
    r = _ack(client, f"ep-nb-{event}", "qa-non-bridge", event)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == event, body
    assert body["ledger"] is None, body


def test_canonical_bridging_events_still_work(client):
    for event in sorted(BRIDGE):
        r = _ack(client, f"ep-canon-{event}", f"qa-canon-{event}", event)
        assert r.status_code == 200, r.text
        assert r.json()["ledger"] is not None, (event, r.json())


@pytest.mark.parametrize("payload", [
    {},                                                    # empty
    {"endpoint": "e", "alert_id": "a"},                    # missing event
    {"alert_id": "a", "event": "delivered"},               # missing endpoint
    {"endpoint": "e", "event": "delivered"},               # missing alert_id
    {"endpoint": "e", "alert_id": "a", "event": "nope"},   # unknown event
])
def test_bad_input_is_400_never_500(client, payload):
    r = client.post("/api/ack", json=payload)
    assert r.status_code == 400, (r.status_code, r.text)


def test_coverage_aggregates_the_district_telemetry(client):
    district = "QA-Coverage"
    for i in range(3):
        _ack(client, f"ep-cov-{i}", "qa-cov-alert", "delivered", district)
    _ack(client, "ep-cov-open", "qa-cov-alert", "opened", district)
    _ack(client, "ep-cov-ack", "qa-cov-alert", "acknowledged", district)

    r = client.get("/api/coverage", params={"district": district})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["district"] == district
    assert body["counts"]["delivered"] == 3, body
    assert body["counts"]["opened"] == 1, body
    assert body["counts"]["acknowledged"] == 1, body
    assert body["total"] == 5, body
    # reached = delivered + opened + acknowledged + p2p_relayed
    assert body["reached"] == 5, body
    assert body["zones"] and body["zones"][0]["zone"] == district, body


def test_coverage_district_match_is_case_insensitive(client):
    _ack(client, "ep-case", "qa-case-alert", "delivered", "QA-MixedCase")
    r = client.get("/api/coverage", params={"district": "qa-mixedcase"})
    assert r.status_code == 200, r.text
    assert r.json()["counts"]["delivered"] == 1, r.json()


def test_coverage_unknown_district_is_honest_zero(client):
    r = client.get("/api/coverage", params={"district": "Nowhere-At-All"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 0 and body["reached"] == 0 and body["zones"] == [], body


def test_ack_is_idempotent_per_endpoint_and_alert(client):
    """A double-tap must not inflate the coverage numbers."""
    district = "QA-Idem"
    _ack(client, "ep-idem", "qa-idem-alert", "delivered", district)
    _ack(client, "ep-idem", "qa-idem-alert", "delivered", district)
    r = client.get("/api/coverage", params={"district": district})
    assert r.json()["counts"]["delivered"] == 1, r.json()
