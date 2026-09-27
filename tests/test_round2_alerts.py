"""Round2 alert-pipeline tests.

The demo-alert HTTP machinery this file used to exercise (/api/demo/*,
demo lifecycles, coverage seeding, auto-advance) was removed with demo mode
(2026-09-23): the router is unregistered and the watcher helpers are gone.
What remains is the live advisory endpoint coverage.
"""
import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_student_persona_advisory(client):
    r = client.get("/api/advisory", params={"severity": "ORANGE", "hazard": "Thunderstorm",
                                            "user_type": "student", "language": "en"})
    assert r.status_code == 200
    assert "school" in r.json()["advisory"].lower()
