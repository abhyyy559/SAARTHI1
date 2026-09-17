"""Missing warning data must never turn into a LOW-risk assessment."""
import os
import sys
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.api import chat
from backend import config
from backend.services.risk_service import RiskService


def test_unavailable_warning_risk_is_unknown():
    risk = RiskService().risk({"verified": False, "severity": "GREEN",
                               "warning_service": "unavailable"}, "fisherman")
    assert risk["level"] == "UNKNOWN"
    assert risk["official_severity"] is None


@pytest.mark.parametrize("has_weather", [False, True])
def test_chat_preserves_unknown_warning_risk(monkeypatch, has_weather):
    monkeypatch.setattr(config, "DEMO_MODE", False)
    current = {"source": "Open-Meteo", "temperature": 28} if has_weather else None
    warning = {"verified": False, "severity": "GREEN", "hazard": None,
               "source": "IMD", "warning_service": "unavailable"}
    monkeypatch.setattr(chat, "_retrieve_live", AsyncMock(return_value=(
        current, None, warning, [], {"source_name": "Open-Meteo"})))
    generator = AsyncMock(return_value=("Official warning information is unavailable.", False))
    monkeypatch.setattr(chat.LLMService, "generate", generator)
    with TestClient(app) as client:
        response = client.post("/api/v1/chat", json={
            "message": "Can I go fishing?", "latitude": 17.6868,
            "longitude": 83.2185, "user_type": "fisherman"})
    assert response.status_code == 200
    body = response.json()
    assert body["risk"]["level"] == "UNKNOWN"
    assert "unavailable" in body["risk"]["reason"].lower()
    assert body["warning"]["status"] == "unavailable"
    if has_weather:
        assert generator.await_args.args[0]["weathergpt_risk"] == "UNKNOWN"
    else:
        generator.assert_not_awaited()
