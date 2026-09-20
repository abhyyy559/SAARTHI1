"""Regression tests for the defects fixed in the pre-commit backend review.

Each test pins one real defect that was found by reading the code and reproduced
before the fix. They are grouped by the invariant they protect, because that is
what makes them worth keeping:

  * the background watcher must never invent an all-clear out of an outage
    (invariant 2: all-clear only after a CONFIRMED low);
  * the advisory must not announce as "active" a warning the verdict refused to
    confirm (invariant 1: one severity, decided once);
  * a later lifecycle push must not erase a device's acknowledgement
    (invariant 5: DELIVERED != OPENED != ACKNOWLEDGED);
  * a naive feed timestamp is IST, not the server's local time.

Everything is offline: the two alert feeds and the LLM are monkeypatched. Runtime
stores are isolated by conftest (SAARTHI_STORE_DIR).
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import backend.adapters.alert_sources as alert_sources  # noqa: E402
import backend.adapters.cap_adapter as cap_adapter  # noqa: E402
import backend.api.chat as chat  # noqa: E402
import backend.config as config  # noqa: E402
from backend.adapters.registry import AdapterUnavailable  # noqa: E402
from backend.main import app  # noqa: E402
from backend.services import advisory_service as advisory  # noqa: E402
from backend.services import alert_service, alert_watcher, delivery_service  # noqa: E402
from backend.services.verdict_service import _is_expired, build_verdict  # noqa: E402


def _wire_feeds(monkeypatch, *, cap, cap_prov, chain=(), chain_prov="UNAVAILABLE"):
    """Deterministic offline feeds. A `cap_prov` of '' means the CAP call raised."""
    async def fake_cap():
        if cap_prov == "":
            raise AdapterUnavailable("CAP feed unreachable")
        return [dict(c) for c in cap], cap_prov

    async def fake_chain(lat, lon, district):
        return [dict(c) for c in chain], chain_prov

    monkeypatch.setattr(alert_service.cap_adapter, "fetch_alerts", fake_cap)
    monkeypatch.setattr(alert_sources, "get_alerts", fake_chain)


def _confirmed_hazard(level="HIGH", hazard="Thunderstorm"):
    return {"level": level, "basis": "cap_alert", "confirmed": True,
            "severity": "ORANGE", "hazard": hazard, "source": "NDMA-Sachet-CAP",
            "nearby_count": 0, "detail": "official CAP alert (ORANGE) relevant to this location"}


def _reset_watcher_state(district):
    state = alert_watcher._load_state()
    state.pop(district, None)
    alert_watcher._save_state(state)


# ---------------------------------------------------------------------------
# 1. An outage must never become an all-clear.
#
# `check_district` passed `warning_service_available=True` unconditionally. The
# watcher only ever looks at the alert feeds, so with CAP and the chain both
# unreachable `gather_alerts` returned nothing, that hardcoded True made it a
# CONFIRMED low, and `decide` turned a previous ORANGE into a "Safe now" push —
# an all-clear invented from a network failure.
# ---------------------------------------------------------------------------
def test_gather_reports_whether_any_feed_answered(monkeypatch):
    _wire_feeds(monkeypatch, cap=[], cap_prov="")
    down = asyncio.run(alert_service.gather_alerts(
        lat=17.385, lon=78.4867, district="Hyderabad", state="Telangana"))
    assert down["available"] is False, down

    _wire_feeds(monkeypatch, cap=[], cap_prov="LIVE")
    answered = asyncio.run(alert_service.gather_alerts(
        lat=17.385, lon=78.4867, district="Hyderabad", state="Telangana"))
    assert answered["available"] is True, answered


def test_watcher_never_all_clears_when_every_feed_is_unreachable(monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", False)
    district = "Hyderabad"
    _reset_watcher_state(district)
    state = alert_watcher._load_state()
    state[district] = _confirmed_hazard()
    alert_watcher._save_state(state)

    pushed = []
    monkeypatch.setattr(alert_watcher.push_service, "broadcast",
                        lambda payload, district="": pushed.append(payload) or
                        {"targeted": 0, "delivered": 0, "failed": 0, "pruned": 0, "results": []})
    _wire_feeds(monkeypatch, cap=[], cap_prov="")  # both feeds unreachable

    out = asyncio.run(alert_watcher.check_district(district))

    assert out["notified"] is None, out
    assert pushed == [], [p["body"] for p in pushed]
    saved = alert_watcher._load_state()[district]
    assert saved["level"] == "UNKNOWN", saved
    assert saved["confirmed"] is False, saved
    _reset_watcher_state(district)


def test_watcher_still_all_clears_after_a_real_answer(monkeypatch):
    """The safe direction must not be bought by disabling all-clears entirely."""
    monkeypatch.setattr(config, "DEMO_MODE", False)
    district = "Warangal"
    _reset_watcher_state(district)
    state = alert_watcher._load_state()
    state[district] = _confirmed_hazard()
    alert_watcher._save_state(state)

    pushed = []
    monkeypatch.setattr(alert_watcher.push_service, "broadcast",
                        lambda payload, district="": pushed.append(payload) or
                        {"targeted": 0, "delivered": 0, "failed": 0, "pruned": 0, "results": []})
    # The official feed ANSWERED and had nothing for this district.
    _wire_feeds(monkeypatch, cap=[], cap_prov="LIVE")

    out = asyncio.run(alert_watcher.check_district(district))

    assert out["notified"] == "clear", out
    assert [p["title"] for p in pushed] == ["Safe now"], pushed
    _reset_watcher_state(district)


# ---------------------------------------------------------------------------
# 2. A warning the verdict refused to confirm is not an "active" warning.
#
# `advisory_for` fell through to the _ACTIVE template for an unconfirmed verdict,
# so the advisory said "ORANGE Thunderstorm warning is active" directly under a
# risk badge reading UNKNOWN — and with the failed alert's severity missing it
# printed "GREEN ... warning is active".
# ---------------------------------------------------------------------------
def test_unverified_warning_is_not_announced_as_active():
    verdict = build_verdict(
        verified={"verified": False},
        warning={"severity": "ORANGE", "hazard": "Thunderstorm", "source": "IMD"},
        warning_service_available=True,
    )
    assert verdict["basis"] == "unverified_warning" and verdict["confirmed"] is False, verdict

    for user_type, language in (("general", "en"), ("farmer", "hi"), ("driver", "te")):
        text = advisory.advisory_for({}, user_type, language, verdict=verdict)
        assert advisory._UNVERIFIED[language] in text, (user_type, language, text)
        assert "warning is active" not in text, text
        # It must not be sold as calm either.
        assert advisory._NO_WARN[user_type if user_type in advisory._NO_WARN else "general"][language] not in text


def test_missing_severity_never_renders_a_green_active_warning():
    """The worst shape of the same bug: no severity on the failed alert."""
    verdict = build_verdict(verified={"verified": False},
                            warning={"hazard": "Thunderstorm"},
                            warning_service_available=True)
    text = advisory.advisory_for({}, "general", "en", verdict=verdict)
    assert "GREEN" not in text, text
    assert "warning is active" not in text, text


# ---------------------------------------------------------------------------
# 3. Forecast temperature extremes.
#
# `_observed_weather` documented "heat uses max, cold uses min" but wrote
# `temp = t if temp is None else temp` — a no-op after the first value, so a 44C
# day three days out never fired the heatwave rule.
# ---------------------------------------------------------------------------
def test_heatwave_fires_from_a_later_forecast_day():
    current = {"temp_c": 29.0}
    forecast = {"days": [{"temp_c": 30.0}, {"temp_c": 31.0}, {"temp_c": 44.0}]}
    items = advisory.weather_advisories(current, forecast, "general", "en")
    assert [i["kind"] for i in items] == ["heatwave"], items
    assert items[0]["fact"] == "temp 44C", items[0]


def test_cold_fires_from_a_later_forecast_night():
    forecast = {"days": [{"temp_c": 30.0}, {"temp_c": 2.0}]}
    items = advisory.weather_advisories(None, forecast, "general", "en")
    assert [i["kind"] for i in items] == ["cold"], items
    assert items[0]["fact"] == "temp 2C", items[0]


def test_ordinary_forecast_temperatures_fire_nothing():
    forecast = {"days": [{"temp_c": 30.0}, {"temp_c": 33.0}]}
    assert advisory.weather_advisories({"temp_c": 29.0}, forecast, "general", "en") == []


# ---------------------------------------------------------------------------
# 4. DELIVERED must not erase ACKNOWLEDGED.
#
# Every lifecycle push for one alert re-issued the device record with
# opened_at/acked_at = None, so the pre-alert ack vanished when the ACTIVE push
# arrived and the dashboard's engagement count fell back to zero.
# ---------------------------------------------------------------------------
def test_later_lifecycle_push_keeps_engagement():
    alert_id = "review-ack-1"
    delivery_service.reset_store()
    try:
        delivery_service.record_issue(alert_id, [{"device": "ep-1", "delivered": True, "reason": "delivered"}])
        delivery_service.record_event(alert_id, "ep-1", "acknowledged")
        first = delivery_service.coverage(alert_id)["real"]
        assert first["engagement"] == {"opened": 1, "acknowledged": 1}, first

        # The next lifecycle state pushes to the same device again.
        delivery_service.record_issue(alert_id, [{"device": "ep-1", "delivered": True, "reason": "delivered"}])
        after = delivery_service.coverage(alert_id)["real"]
        assert after["engagement"] == {"opened": 1, "acknowledged": 1}, after
        assert after["reached"] == 1 and after["DELIVERED"] == 1, after
    finally:
        delivery_service.reset_store()


def test_p2p_relay_keeps_engagement_too():
    alert_id = "review-ack-2"
    delivery_service.reset_store()
    try:
        delivery_service.record_issue(alert_id, [{"device": "ep-2", "delivered": True, "reason": "delivered"}])
        delivery_service.record_event(alert_id, "ep-2", "opened")
        delivery_service.record_relay(alert_id, "ep-2", "ep-3")
        cov = delivery_service.coverage(alert_id)["real"]
        assert cov["P2P_RELAYED"] == 1, cov
        assert cov["engagement"] == {"opened": 1, "acknowledged": 0}, cov
    finally:
        delivery_service.reset_store()


# ---------------------------------------------------------------------------
# 5. A naive feed timestamp is IST.
#
# `_is_expired` compared a naive timestamp against the SERVER's local clock. On a
# UTC host that reads an IST expiry 5h30m early, which flips an alert between
# "in force" and "expired" — and so between CRITICAL and UNKNOWN.
# ---------------------------------------------------------------------------
def test_naive_expiry_is_read_as_ist():
    # 12:00 in an IST bulletin, no offset written.
    alert = {"expires": "2026-01-01T12:00:00"}
    # 13:30 IST — the window has closed.
    after = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)
    assert _is_expired(alert, now=after) is True
    # 11:30 IST — still in force.
    before = datetime(2026, 1, 1, 6, 0, tzinfo=timezone.utc)
    assert _is_expired(alert, now=before) is False


# ---------------------------------------------------------------------------
# 6. The rain yes/no is answered once.
#
# `_ensure_rain_lead` was written to fix a shipped duplication and covered by
# tests, but the endpoint still carried its own inline copy — the helper was
# never called, so the bug was still live.
# ---------------------------------------------------------------------------
def _install_demo_chat(monkeypatch, llm_answer):
    monkeypatch.setattr(config, "DEMO_MODE", True)

    async def fake_retrieve(loc):
        current = {"source": "IMD", "temperature": 28.0}
        forecast = {"source": "IMD", "days": [{"rainfall": 1.0}, {"rainfall": 22.0}]}
        verified = {"verified": False, "severity": "GREEN", "hazard": None}
        return current, forecast, verified, [], {"source_name": "IMD"}

    async def fake_generate(self, evidence, question, language):
        return llm_answer, False

    monkeypatch.setattr(chat, "_retrieve_demo", fake_retrieve)
    monkeypatch.setattr(chat.LLMService, "generate", fake_generate)


def _ask(monkeypatch, answer, message="Will it rain tomorrow?"):
    _install_demo_chat(monkeypatch, answer)
    r = TestClient(app).post("/api/chat", json={"message": message, "user_type": "general"})
    assert r.status_code == 200, r.text
    return r.json()["answer"]


def test_endpoint_does_not_answer_the_rain_question_twice(monkeypatch):
    answer = _ask(monkeypatch, "**Yes**, it will rain tomorrow.\n\nAround 22 mm is expected.")
    assert "Yes — rain likely tomorrow" not in answer, answer
    assert answer.lower().count("yes") == 1, answer


def test_endpoint_still_adds_the_rain_lead_when_the_answer_buries_it(monkeypatch):
    answer = _ask(monkeypatch, "Temperatures will reach 31 C with high humidity.")
    assert answer.startswith("Yes — rain likely tomorrow (22.0 mm)."), answer


# ---------------------------------------------------------------------------
# 7. Demo fixtures stay coherent when retargeted.
#
# `demo_fixture(district)` rewrote areaDesc/headline/description but not
# `message` (which _normalize derives from description), so a Warangal demo alert
# still carried a body reading "... over Hyderabad district" — and Hyderabad
# landed in that alert's named_districts.
# ---------------------------------------------------------------------------
def test_demo_fixture_retargets_every_text_field():
    alerts, prov = cap_adapter.demo_fixture("Warangal")
    assert prov == "DEMO"
    assert alerts, "fixture must load"
    for a in alerts:
        for field in ("area", "areaDesc", "headline", "description", "message"):
            value = str(a.get(field) or "")
            assert "Hyderabad" not in value, (field, value)
        assert "Warangal" in a["areaDesc"], a["areaDesc"]


def test_demo_fixture_leaves_hyderabad_alone():
    alerts, _ = cap_adapter.demo_fixture("Hyderabad")
    assert any("Hyderabad" in a["message"] for a in alerts)
