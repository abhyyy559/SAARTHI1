"""QA: safety invariants — the promises that must never bend.

1. With the warning service unreachable, NO endpoint may report a confirmed-safe
   state. "We could not check" is never "you are safe".
2. Provenance travels and is never upgraded (a CACHED alert stays CACHED even
   when a live source contributes alongside it; a DEMO fixture stays DEMO).
3. build_verdict is the single severity authority: it returns the same contract
   on every branch, including total failure, so no view can fall back to a guess.
4. Internal watcher bookkeeping must not leak into the public status payload.
"""
import asyncio

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.adapters.registry import AdapterUnavailable
from backend.main import app
from backend.services import alert_service, alert_watcher
from backend.services.imd_service import IMDService
from backend.services.verdict_service import build_verdict

VERDICT_KEYS = {"level", "basis", "confirmed", "severity", "hazard", "source",
                "nearby_count", "detail"}


# ---------------------------------------------------------------------------
# 1. Outage is never a calm.
# ---------------------------------------------------------------------------
@pytest.fixture()
def outage(monkeypatch):
    """Every upstream fails; the app must still answer honestly."""
    monkeypatch.setattr(config, "DEMO_MODE", False)
    monkeypatch.setattr(config, "SOURCE_MODE", "hybrid")

    async def _raise(*a, **k):
        raise AdapterUnavailable("simulated outage")

    async def _cap_down():
        raise AdapterUnavailable("CAP down")

    async def _chain_down(lat, lon, district):
        return [], "UNAVAILABLE"

    monkeypatch.setattr(alert_service.cap_adapter, "fetch_alerts", _cap_down)
    import backend.adapters.alert_sources as alert_sources
    monkeypatch.setattr(alert_sources, "get_alerts", _chain_down)
    monkeypatch.setattr(IMDService, "get_district_warning", _raise)
    import backend.api.chat as chat
    monkeypatch.setattr(chat, "_live_current", _raise)
    monkeypatch.setattr(chat, "_live_forecast", _raise)
    with TestClient(app) as c:
        yield c


def test_warnings_endpoint_reports_unavailable_not_calm(outage):
    r = outage.get("/api/weather/warnings", params={"district": "Hyderabad"})
    assert r.status_code == 200, r.text
    body = r.json()
    v = body["verdict"]
    assert body["status"] == "unavailable", body
    assert v["level"] == "UNKNOWN" and v["confirmed"] is False, v
    assert v["basis"] == "unavailable", v
    assert v["level"] != "LOW"


def test_v1_warnings_and_advisories_agree(outage):
    w = outage.get("/api/v1/warnings", params={"district": "Hyderabad"}).json()
    assert w["verdict"]["confirmed"] is False, w["verdict"]

    a = outage.get("/api/v1/advisories",
                   params={"district": "Hyderabad", "user_type": "farmer"}).json()
    assert a["verdict"]["confirmed"] is False, a["verdict"]
    adv = a["advisory"].lower()
    # It must say we could not check — never that there is no warning.
    assert "unreachable" in adv or "cannot confirm" in adv, a["advisory"]
    assert "no active severe-weather warning" not in adv, a["advisory"]


def test_chat_reports_unknown_risk_not_safe(outage):
    body = outage.post("/api/chat", json={"message": "Is it safe today?", "user_type": "general"}).json()
    assert body["risk"]["level"] == "UNKNOWN", body["risk"]
    assert body["verdict"]["confirmed"] is False, body["verdict"]
    ans = body["answer"].lower()
    assert "could not be checked" in ans or "cannot confirm" in ans or "unavailable" in ans, body["answer"]
    assert "no warning" not in ans and "safe" not in ans, body["answer"]


def test_v1_chat_marks_location_unaffected_on_an_outage(outage):
    body = outage.post("/api/v1/chat", json={"message": "Is it safe?", "context": "general"}).json()
    assert body["risk"]["level"] == "UNKNOWN", body["risk"]
    assert body["location_affected"] is False, body


def test_no_endpoint_500s_during_a_full_outage(outage):
    for path in ("/api/weather/warnings?district=Hyderabad",
                 "/api/v1/warnings?district=Hyderabad",
                 "/api/v1/advisories?district=Hyderabad&user_type=driver",
                 "/api/health", "/api/mode", "/api/sources", "/api/coverage"):
        assert outage.get(path).status_code < 500, path


# ---------------------------------------------------------------------------
# 2. Provenance travels and is never upgraded.
# ---------------------------------------------------------------------------
def _wire(monkeypatch, cap, cap_prov, chain=(), chain_prov="UNAVAILABLE"):
    async def fake_cap():
        if cap_prov == "":
            raise AdapterUnavailable("down")
        return [dict(c) for c in cap], cap_prov

    async def fake_chain(lat, lon, district):
        return [dict(c) for c in chain], chain_prov

    monkeypatch.setattr(alert_service.cap_adapter, "fetch_alerts", fake_cap)
    import backend.adapters.alert_sources as alert_sources
    monkeypatch.setattr(alert_sources, "get_alerts", fake_chain)


def _alert(sev="YELLOW", hazard="Thunderstorm", district="Hyderabad"):
    return {"severity": sev, "hazard": hazard, "area": f"{district} district",
            "headline": f"{hazard} over {district}", "expires": "2099-01-01T00:00:00+05:30"}


def test_cached_provenance_is_not_upgraded_by_a_live_chain(monkeypatch):
    _wire(monkeypatch, cap=[_alert()], cap_prov="CACHED",
          chain=[_alert(sev="ORANGE", hazard="Heavy Rain")], chain_prov="LIVE")
    got = asyncio.run(alert_service.gather_alerts(
        lat=17.385, lon=78.4867, district="Hyderabad", state="Telangana"))
    assert got["provenance"] == "CACHED", got["provenance"]
    provs = {a["provenance"] for a in (*got["relevant"], *got["nearby"])}
    assert provs == {"CACHED", "LIVE"}, provs  # each alert keeps its own origin


def test_demo_fixture_stays_labelled_demo(monkeypatch):
    from backend.adapters import cap_adapter
    alerts, prov = cap_adapter.demo_fixture("Hyderabad")
    _wire(monkeypatch, cap=alerts, cap_prov=prov)
    got = asyncio.run(alert_service.gather_alerts(
        lat=17.385, lon=78.4867, district="Hyderabad", state="Telangana"))
    assert got["provenance"] == "DEMO", got["provenance"]
    assert got["available"] is True, got
    assert all(a["provenance"] == "DEMO" for a in (*got["relevant"], *got["nearby"]))


def test_unconfigured_and_unavailable_are_not_reported_as_live(monkeypatch):
    _wire(monkeypatch, cap=[], cap_prov="")
    got = asyncio.run(alert_service.gather_alerts(
        lat=17.385, lon=78.4867, district="Hyderabad", state="Telangana"))
    assert got["provenance"] in ("UNCONFIGURED", "UNAVAILABLE"), got["provenance"]
    assert got["available"] is False, got


# ---------------------------------------------------------------------------
# 3. build_verdict is the single authority and never changes shape.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("kwargs", [
    {},                                                        # total failure default
    {"warning_service_available": False},
    {"verified": {"verified": True, "severity": "RED", "hazard": "Cyclone"}},
    {"cap_alerts": [{"severity": "ORANGE", "hazard": "Rain", "expires": "2099-01-01T00:00:00+05:00"}]},
    {"cap_alerts": [{"severity": "ORANGE", "hazard": "Rain", "expires": "2000-01-01T00:00:00+05:00"}]},
    {"warning": {"severity": "YELLOW", "hazard": "Storm"}},
    {"warning": {"severity": "YELLOW", "hazard": "Storm"}, "warning_matches_location": False,
     "warning_service_available": False},
])
def test_build_verdict_contract_holds_on_every_branch(kwargs):
    v = build_verdict(**kwargs)
    assert VERDICT_KEYS <= set(v), (kwargs, v)
    assert v["level"] in {"CRITICAL", "HIGH", "MODERATE", "LOW", "UNKNOWN"}, v
    assert isinstance(v["confirmed"], bool), v
    # Severity is never invented: no official severity -> UNKNOWN, not LOW.
    if v["basis"] == "unavailable":
        assert v["level"] == "UNKNOWN" and v["confirmed"] is False, v


def test_official_severity_is_mapped_once_not_re_graded():
    v = build_verdict(verified={"verified": True, "severity": "ORANGE", "hazard": "Rain"})
    assert v["level"] == "HIGH" and v["severity"] == "ORANGE" and v["confirmed"] is True, v


# ---------------------------------------------------------------------------
# 4. Watcher status key hygiene.
# ---------------------------------------------------------------------------
def test_push_status_does_not_report_internal_keys_as_districts():
    state = alert_watcher._load_state()
    saved = dict(state)
    try:
        state["QA-StatusDistrict"] = {"level": "LOW", "confirmed": True, "detail": "x"}
        state["_demo_notified"] = {"some-id:ACTIVE": "body"}
        alert_watcher._save_state(state)
        st = alert_watcher.status()
        assert "QA-StatusDistrict" in st["last_verdicts"], st["last_verdicts"]
        assert "_demo_notified" not in st["last_verdicts"], st["last_verdicts"]
    finally:
        alert_watcher._save_state(saved)
