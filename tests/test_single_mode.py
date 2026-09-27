"""Single-mode contract tests (2026-09-27).

WeatherGPT runs in exactly one mode: IMD-first. There is no demo mode, no hybrid
mode, and no mode switcher.

  * GET /api/mode always reports mode "imd", demo_mode false, and the one
    weather chain (IMD -> Open-Meteo -> OpenWeatherMap -> file cache) plus the
    IMD + SACHET/CAP warning chain.
  * POST /api/mode does not exist (405/404 — the switcher is gone).
  * /api/sources reports the sources honestly; IMD is UNCONFIGURED when the
    key is absent, never mislabelled.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

client = TestClient(app)


def test_get_mode_reports_single_imd_mode():
    body = client.get("/api/mode").json()
    assert body["mode"] == "imd"
    assert body["source_mode"] == "imd"
    assert body["demo_mode"] is False


def test_get_mode_documents_the_one_chain():
    body = client.get("/api/mode").json()
    assert body["weather_chain"] == ["IMD", "Open-Meteo", "OpenWeatherMap", "file cache"]
    assert body["warning_chain"] == ["IMD", "SACHET/CAP"]
    assert body["available_modes"] == ["imd"]


def test_post_mode_is_gone():
    r = client.post("/api/mode", json={"mode": "hybrid"})
    assert r.status_code in (404, 405), r.status_code


def test_sources_endpoint_is_honest_about_imd():
    body = client.get("/api/sources").json()
    assert body["demo_mode"] is False
    assert body["source_mode"] == "imd"
    by_name = {s["name"]: s for s in body["sources"]}
    # Without a key in this environment IMD must say UNCONFIGURED, not LIVE.
    assert by_name["imd"]["status"] == "UNCONFIGURED"
    assert by_name["imd"]["status"] != "LIVE"


def test_health_reports_imd_adapter():
    body = client.get("/api/health").json()
    assert body["source_mode"] == "imd"
    assert "imd_adapter" in body
