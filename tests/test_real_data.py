"""Real-data guarantees: chat never answers from fixtures by default, a live
SACHET check counts as a warning check, and the chat names the true source."""
import importlib
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from fastapi.testclient import TestClient

from backend import config
from backend.adapters.registry import AdapterUnavailable
from backend.api import chat, weather
from backend.main import app
from backend.services import alert_service

HYD = {"latitude": 17.385, "longitude": 78.4867, "district": "Hyderabad"}


def _reload_config(monkeypatch, **env):
    """Config as it would load under `env`, then restore the real one."""
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    try:
        return SimpleNamespace(**vars(importlib.reload(config)))
    finally:
        monkeypatch.undo()
        importlib.reload(config)


def test_demo_mode_defaults_off(monkeypatch):
    assert _reload_config(monkeypatch, DEMO_MODE="").DEMO_MODE is False
    assert _reload_config(monkeypatch, DEMO_MODE="true").DEMO_MODE is True


def test_sachet_feeds_on_by_default(monkeypatch):
    cfg = _reload_config(monkeypatch, CAP_FEED_URLS="", CAP_FEED_URL="")
    assert cfg.CAP_FEED_URLS == cfg.DEFAULT_CAP_FEED_URLS
    assert all(u.startswith("https://sachet.ndma.gov.in/") for u in cfg.CAP_FEED_URLS)
    assert _reload_config(monkeypatch, CAP_FEED_URLS="off").CAP_FEED_URLS == []


def test_imd_key_alias(monkeypatch):
    assert _reload_config(monkeypatch, IMD_API_KEY="", IMD_KEY="abc").IMD_API_KEY == "abc"


def _gathered(official: bool):
    return {"relevant": [], "nearby": [], "provenance": "LIVE" if official else "UNAVAILABLE",
            "feeds": ["NDMA-Sachet-CAP"] if official else [], "available": official,
            "official_available": official}


def _imd_down(monkeypatch):
    async def down(self, district):
        raise AdapterUnavailable("no IMD key")
    monkeypatch.setattr(weather.IMDService, "get_district_warning", down)


def test_sachet_checked_with_no_district_alert_is_not_unreachable(monkeypatch):
    _imd_down(monkeypatch)
    monkeypatch.setattr(weather, "gather_alerts", AsyncMock(return_value=_gathered(True)))
    with TestClient(app) as client:
        body = client.get("/api/weather/warnings", params={
            "district": "Hyderabad", "lat": HYD["latitude"], "lon": HYD["longitude"]}).json()
    assert body["status"] == "ok"
    assert body["verdict"]["level"] == "LOW"
    assert "unreachable" not in body["verdict"]["detail"]


def test_imd_and_sachet_both_down_stays_unknown(monkeypatch):
    _imd_down(monkeypatch)
    monkeypatch.setattr(weather, "gather_alerts", AsyncMock(return_value=_gathered(False)))
    with TestClient(app) as client:
        body = client.get("/api/weather/warnings", params={
            "district": "Hyderabad", "lat": HYD["latitude"], "lon": HYD["longitude"]}).json()
    assert body["verdict"]["level"] == "UNKNOWN"


def test_cached_sachet_cannot_support_a_calm():
    # The flag that lets a verdict say "checked" is LIVE-only by construction.
    src = open(alert_service.__file__, encoding="utf-8").read()
    assert '"official_available": cap_prov == LIVE' in src


def test_chat_names_the_source_that_supplied_the_numbers(monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", False)
    monkeypatch.setattr(chat, "_fetch_current_safe", AsyncMock(return_value=(
        {"source": "Open-Meteo", "temperature": 31.0, "observed_at": "2026-10-09T12:00:00+05:30"}, "LIVE")))
    monkeypatch.setattr(chat, "_fetch_forecast_safe", AsyncMock(return_value=(None, "UNAVAILABLE")))
    monkeypatch.setattr(chat, "_fetch_warning_safe", AsyncMock(return_value=(
        None, {"verified": False, "severity": "GREEN", "hazard": None, "source": "IMD",
               "warning_service": "unavailable"}, False)))
    monkeypatch.setattr(chat, "gather_alerts", AsyncMock(return_value=_gathered(True)))
    import asyncio
    loc = {"district": "Hyderabad", "state": "Telangana", "latitude": 17.385, "longitude": 78.4867}
    _, _, _, _, notes = asyncio.run(chat._retrieve_live(loc, 17.385, 78.4867))
    assert notes["source_name"] == "Open-Meteo"
    assert notes["warning_service_available"] is True


def test_sea_permission_question_never_opens_with_yes_or_no():
    te = "ఈ రోజు సముద్రంలోకి వెళ్ళవచ్చా?"
    assert chat._drop_permission_yesno(te, "**అవును, రేపు 0.6 మిమీ వర్షం.**") == "**రేపు 0.6 మిమీ వర్షం.**"
    assert chat._drop_permission_yesno("Can I go to sea today?", "Yes — no warning.") == "no warning."
    assert chat._drop_permission_yesno("Is it safe to go fishing?", "No warning is active.") == "No warning is active."
    # A rain question keeps its yes/no: that one IS a weather fact.
    assert chat._drop_permission_yesno("Will it rain at sea?", "Yes, 4 mm.") == "Yes, 4 mm."
