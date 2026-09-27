"""Regression: the inland-fisherman refusal must fire through HTTP.

`advisory_service.advisory_for` carries the inland-fisherman sentence
("Hyderabad is not a coastal district, so sea and marine warnings do not
apply here."), but `GET /api/advisory` called it without coastal/district,
so a fisherman in inland Hyderabad received the generic coastal template.
The routes now resolve the location and thread coastal/district through.

Network is stubbed (alert gather + server-side weather fetch); location
resolution is REAL — these tests prove the district's coastal flag, not the
network, decides whether the refusal fires.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import backend.api.weather as weather_mod  # noqa: E402
from backend.main import app  # noqa: E402

HYD = {"lat": 17.385, "lon": 78.4867}          # Hyderabad — coastal=False
MUMBAI = {"lat": 19.076, "lon": 72.8777}      # Mumbai — coastal=True

INLAND_REFUSAL_EN = "Hyderabad is not a coastal district"


@pytest.fixture()
def offline(monkeypatch):
    """Stub network boundaries; keep location resolution real."""
    async def fake_gather(**kwargs):
        return {"relevant": [], "nearby": [], "provenance": "UNAVAILABLE",
                "feeds": [], "available": True}

    async def fake_resolve(lat, lon, explicit):
        return None, {}

    monkeypatch.setattr(weather_mod, "gather_alerts", fake_gather)
    monkeypatch.setattr(weather_mod, "resolve_advisory_weather", fake_resolve)


def _advisory_text(resp) -> str:
    assert resp.status_code == 200, resp.text
    return resp.json()["advisory"]


def test_api_advisory_fisherman_inland_gets_refusal(offline):
    text = _advisory_text(TestClient(app).get(
        "/api/advisory",
        params={"user_type": "fisherman", "language": "en", **HYD}))
    assert INLAND_REFUSAL_EN in text, text
    print("PASS: test_api_advisory_fisherman_inland_gets_refusal")


def test_api_advisory_fisherman_coastal_no_refusal(offline):
    text = _advisory_text(TestClient(app).get(
        "/api/advisory",
        params={"user_type": "fisherman", "language": "en", **MUMBAI}))
    assert "not a coastal district" not in text, text
    print("PASS: test_api_advisory_fisherman_coastal_no_refusal")


def test_api_advisory_fisherman_unknown_location_no_refusal(offline):
    # No lat/lon -> coastal is None (we do not know). An unknown location
    # must NOT be called inland.
    text = _advisory_text(TestClient(app).get(
        "/api/advisory",
        params={"user_type": "fisherman", "language": "en"}))
    assert "not a coastal district" not in text, text
    print("PASS: test_api_advisory_fisherman_unknown_location_no_refusal")


def test_api_advisory_fisherman_refusal_in_hindi_and_telugu(offline):
    text = _advisory_text(TestClient(app).get(
        "/api/advisory",
        params={"user_type": "fisherman", "language": "hi", **HYD}))
    assert "तटीय" in text, text
    text = _advisory_text(TestClient(app).get(
        "/api/advisory",
        params={"user_type": "fisherman", "language": "te", **HYD}))
    assert "తీర" in text, text
    print("PASS: test_api_advisory_fisherman_refusal_in_hindi_and_telugu")


def test_v1_advisories_fisherman_inland_gets_refusal(offline):
    text = _advisory_text(TestClient(app).get(
        "/api/v1/advisories",
        params={"district": "Hyderabad", "user_type": "fisherman",
                "language": "en", **HYD}))
    assert INLAND_REFUSAL_EN in text, text
    print("PASS: test_v1_advisories_fisherman_inland_gets_refusal")


def test_v1_advisories_fisherman_medchal_by_name_gets_refusal(offline):
    # District-name-only path: "Medchal Malkajgiri" must resolve to its own
    # inland district — never inherit another place's coastal flag.
    text = _advisory_text(TestClient(app).get(
        "/api/v1/advisories",
        params={"district": "Medchal Malkajgiri", "user_type": "fisherman",
                "language": "en"}))
    assert "Medchal Malkajgiri is not a coastal district" in text, text
    print("PASS: test_v1_advisories_fisherman_medchal_by_name_gets_refusal")


def test_v1_advisories_fisherman_coastal_no_refusal(offline):
    text = _advisory_text(TestClient(app).get(
        "/api/v1/advisories",
        params={"district": "Mumbai", "user_type": "fisherman",
                "language": "en", **MUMBAI}))
    assert "not a coastal district" not in text, text
    print("PASS: test_v1_advisories_fisherman_coastal_no_refusal")
