"""ISOLATED unit test for T3.3 S3.3.1-S3.3.2 (push telemetry + ack API).

Target files:
  - weathergpt/backend/services/push_service.py (record_event, coverage)
  - weathergpt/backend/api/ack.py (POST /api/ack, GET /api/coverage)

Session: ses_ack32
WARNING: THIS FILE WILL BE DELETED AFTER TEST PASSES.
Preserved in: .opencode/unit-tests/
"""
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture()
def iso_store(monkeypatch):
    """Isolate ALL persistence for this test.

    Uses SAARTHI_STORE_DIR, the switch db._json_path actually honours. Patching
    config.CACHE_FILE (the old approach) no longer isolates anything: the
    override takes precedence, so both tests in this module shared one store and
    the second saw the first one's events.
    """
    tmp = tempfile.mkdtemp(prefix="ack_iso_")
    from backend.services import db as dbmod
    monkeypatch.setenv("SAARTHI_STORE_DIR", tmp)
    monkeypatch.setattr(dbmod, "_BACKEND", "json")
    monkeypatch.setattr(dbmod, "_POOL", None)
    return tmp


def test_record_event_and_coverage(iso_store):
    from backend.services import push_service

    # Valid events are recorded with normalised lowercase names.
    rec = push_service.record_event("ep-1", "alert-1", "delivered", district="Hyderabad")
    assert rec is not None and rec["event"] == "delivered"
    push_service.record_event("ep-2", "alert-1", "acknowledged", district="Hyderabad")
    push_service.record_event("ep-3", "alert-1", "p2p_relayed", district="Kakinada")

    # Unknown event -> None, never raises.
    assert push_service.record_event("ep-x", "alert-1", "bogus-event") is None
    # Empty endpoint/alert -> None, never raises.
    assert push_service.record_event("", "alert-1", "delivered") is None
    assert push_service.record_event("ep-x", "", "delivered") is None

    cov = push_service.coverage("Hyderabad")
    assert cov["district"] == "Hyderabad"
    assert cov["counts"]["delivered"] == 1
    assert cov["counts"]["acknowledged"] == 1
    assert cov["total"] == 2

    cov_all = push_service.coverage("")
    assert cov_all["total"] == 3
    zones = {z["zone"]: z for z in cov_all["zones"]}
    assert zones["Hyderabad"]["total"] == 2
    assert zones["Kakinada"]["total"] == 1


def test_ack_router_post_and_coverage_get(iso_store):
    from backend.api import ack as ackmod

    mini = FastAPI()
    mini.include_router(ackmod.router)
    c = TestClient(mini)

    r = c.post("/api/ack", json={
        "endpoint": "dev-1", "alert_id": "a-1",
        "event": "delivered", "district": "Hyderabad",
    })
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "delivered"

    # Invalid event is a 400, never a 500.
    r = c.post("/api/ack", json={"endpoint": "dev-1", "alert_id": "a-1", "event": "nope"})
    assert r.status_code == 400

    # Missing fields are a 400.
    r = c.post("/api/ack", json={"endpoint": "dev-1"})
    assert r.status_code == 400

    r = c.get("/api/coverage", params={"district": "Hyderabad"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["district"] == "Hyderabad"
    assert body["counts"]["delivered"] == 1
    assert "zones" in body
