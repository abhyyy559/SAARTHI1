"""Verdict contract tests — one severity, decided once server-side.

Regression focus: a district whose IMD warning service is unreachable must never
be rendered as "All clear". `/api/v1/warnings` (and its `/api/weather/warnings`
twin) must always emit both a `status` key and a full `verdict`, and
`/api/v1/advisories` must report "unreachable" instead of "no warning".

All external calls are monkeypatched, so these run offline. Runtime stores are
isolated to tmp_path so the developer's real weathergpt_cache.json is untouched.
"""
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import backend.config as config  # noqa: E402
import backend.api.weather as weather_mod  # noqa: E402
import backend.adapters.cap_adapter as cap_adapter  # noqa: E402
import backend.adapters.alert_sources as alert_sources  # noqa: E402
from backend.adapters.registry import AdapterUnavailable  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models.weather import WeatherWarning  # noqa: E402
from backend.services.cache_service import CacheService  # noqa: E402
from backend.services.imd_service import IMDService  # noqa: E402
from backend.utils.time import now_ist  # noqa: E402

VERDICT_KEYS = {"level", "basis", "confirmed", "severity", "hazard",
                "source", "nearby_count", "detail"}


@pytest.fixture(autouse=True)
def _isolate_runtime_stores(tmp_path, monkeypatch):
    """Never read/write the developer's real weathergpt_cache.json."""
    cache_file = str(tmp_path / "weathergpt_cache.json")
    monkeypatch.setattr(config, "CACHE_FILE", cache_file)
    monkeypatch.setattr(weather_mod, "cache", CacheService(cache_file))


def _cap(severity, area="Hyderabad district, Telangana", identifier="cap-1",
         hazard="Thunderstorm"):
    return {
        "source": "NDMA-Sachet-CAP", "identifier": identifier, "hazard": hazard,
        "severity": severity, "area": area, "areaDesc": area,
        "headline": f"{hazard} likely", "polygon": "", "circle": "",
    }


def _install_live(monkeypatch, *, imd_raises=False, imd_warning=None,
                  caps=(), chain=()):
    """Force the live branch with deterministic, offline sources."""
    monkeypatch.setattr(config, "DEMO_MODE", False)

    async def fake_warning(self, district):
        if imd_raises:
            raise AdapterUnavailable("IMD live unreachable")
        return imd_warning

    monkeypatch.setattr(IMDService, "get_district_warning", fake_warning)

    async def fake_fetch():
        return list(caps), "LIVE"

    monkeypatch.setattr(cap_adapter, "fetch_alerts", fake_fetch)

    async def fake_chain(lat, lon, district):
        return list(chain), "UNAVAILABLE"

    monkeypatch.setattr(alert_sources, "get_alerts", fake_chain)


def _get(path="/api/v1/warnings", **params):
    r = TestClient(app).get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _warning(district="Hyderabad", severity="YELLOW"):
    return WeatherWarning(
        source="IMD", hazard="Thunderstorm", severity=severity, district=district,
        message="Thunderstorm with lightning likely.", issued_at=now_ist(),
        valid_until=now_ist() + timedelta(hours=4), verified=False, active=False,
    )


# 1. Official CAP alert relevant to the user outranks an unreachable IMD.
def test_live_cap_orange_imd_down_is_high(monkeypatch):
    _install_live(monkeypatch, imd_raises=True, caps=[_cap("ORANGE")])
    data = _get(district="Hyderabad", lat=17.385, lon=78.4867)
    v = data["verdict"]
    assert v["level"] == "HIGH", v
    assert v["basis"] == "cap_alert", v
    assert v["confirmed"] is True
    assert data["status"] == "ok"


# 2. REGRESSION: nothing found AND we could not check -> UNKNOWN, never LOW.
def test_live_imd_down_nothing_found_is_unknown(monkeypatch):
    _install_live(monkeypatch, imd_raises=True)
    data = _get(district="Hyderabad", lat=17.385, lon=78.4867)
    v = data["verdict"]
    assert v["level"] == "UNKNOWN", v
    assert v["basis"] == "unavailable", v
    assert v["confirmed"] is False
    assert v["level"] != "LOW"          # the "All clear" bug
    assert data["status"] == "unavailable"


# 3. Nearby state-level alerts are context, never this district's calm.
def test_nearby_alerts_never_calm_the_district(monkeypatch):
    nearby = [_cap("ORANGE", area="Warangal district, Telangana",
                   identifier=f"near-{i}") for i in range(5)]
    _install_live(monkeypatch, imd_raises=True, chain=nearby)
    data = _get(district="Hyderabad", lat=17.385, lon=78.4867)
    v = data["verdict"]
    assert v["level"] == "UNKNOWN", v
    assert v["nearby_count"] == 5, v
    assert len(data["nearby_alerts"]) == 5
    assert data["cap_alerts"] == []


# 4. Demo mode always answers: status ok and a verdict is always present.
def test_demo_mode_always_ok_with_verdict(monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", True)
    data = _get(district="Hyderabad")
    assert data["status"] == "ok"
    assert set(data["verdict"]) == VERDICT_KEYS
    assert data["verdict"]["level"] == "MODERATE"
    assert data["verdict"]["basis"] == "verified_warning"


# 5. `status` + `verdict` present on every branch of both twins.
def test_status_key_present_in_every_branch(monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", True)
    for path in ("/api/v1/warnings", "/api/weather/warnings"):
        demo = _get(path, district="Hyderabad")
        assert "status" in demo and "verdict" in demo, (path, demo)

    _install_live(monkeypatch, imd_raises=True)
    for path in ("/api/v1/warnings", "/api/weather/warnings"):
        unreachable = _get(path, district="Hyderabad", lat=17.385, lon=78.4867)
        assert unreachable["status"] == "unavailable"
        assert unreachable["verdict"]["level"] == "UNKNOWN"

    _install_live(monkeypatch, imd_raises=True,
                  chain=[_cap("ORANGE", area="Warangal district, Telangana")])
    reachable = _get(district="Hyderabad", lat=17.385, lon=78.4867)
    assert reachable["status"] == "ok"
    assert "verdict" in reachable


# 6. A verified official YELLOW warning is MODERATE, never re-graded.
def test_verified_yellow_is_moderate(monkeypatch):
    _install_live(monkeypatch, imd_warning=_warning(severity="YELLOW"))
    data = _get(district="Hyderabad", lat=17.385, lon=78.4867)
    v = data["verdict"]
    assert v["level"] == "MODERATE", v
    assert v["basis"] == "verified_warning", v
    assert v["confirmed"] is True
    assert data["status"] == "ok"


# v1 regression: a live CAP feed must not make an unreachable IMD look checked.
def test_advisories_reports_unreachable_when_only_cap_feed_is_live(monkeypatch):
    _install_live(monkeypatch, imd_raises=True,
                  caps=[_cap("ORANGE", area="Warangal district, Telangana")])
    r = TestClient(app).get("/api/v1/advisories",
                            params={"district": "Hyderabad", "lat": 17.385, "lon": 78.4867})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "unreachable" in body["advisory"].lower(), body["advisory"]


# v1 note stays driven by the verdict's nearby_count.
def test_advisories_note_uses_verdict_nearby_count(monkeypatch):
    nearby = [_cap("ORANGE", area="Warangal district, Telangana",
                   identifier=f"n{i}") for i in range(5)]
    # Warning present but for another district -> fails validation -> LOW.
    _install_live(monkeypatch, imd_warning=_warning(district="Warangal"), chain=nearby)
    r = TestClient(app).get("/api/v1/advisories",
                            params={"district": "Hyderabad", "lat": 17.385, "lon": 78.4867})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "Note: 5 official state-level alerts" in body["advisory"], body["advisory"]


# --------------------------------------------------------------------------
# An expired alert is not a current hazard.
#
# The SACHET feed serves a backlog: on the machine this was found, all three
# "relevant" alerts had already closed their validity window — one of them three
# days earlier — yet they drove a confirmed MODERATE verdict, while the Alerts
# page marked every one of them Expired. Home said "Be careful" above a list of
# expired bulletins, i.e. stale official data presented as current.
#
# The rule kept here: expired alerts neither raise the level NOR become a calm.
# --------------------------------------------------------------------------
from datetime import datetime, timedelta, timezone  # noqa: E402

from backend.services.verdict_service import build_verdict, _is_expired  # noqa: E402


def _expiring_cap(severity, expires, identifier="cap-1"):
    return {
        "source": "NDMA-Sachet-CAP", "identifier": identifier, "severity": severity,
        "hazard": "Lightning, Gusty winds", "headline": "Thunderstorm over Hyderabad",
        "area": "Hyderabad", "expires": expires,
    }


def _iso(**delta):
    return (datetime.now(timezone.utc) + timedelta(**delta)).isoformat()


def test_expired_alert_does_not_raise_the_verdict():
    v = build_verdict(cap_alerts=[_expiring_cap("ORANGE", _iso(days=-1))],
                      warning_service_available=True)
    assert v["level"] != "HIGH", v
    assert v["confirmed"] is False, v
    assert v["basis"] == "unavailable", v


def test_expired_alert_is_not_turned_into_a_calm():
    """The dangerous alternative: drop the expired alert and report "no active
    warning". We cannot know that from a feed whose newest entry has lapsed."""
    v = build_verdict(cap_alerts=[_expiring_cap("ORANGE", _iso(days=-1))],
                      warning_service_available=True)
    assert v["level"] != "LOW", v
    assert v["basis"] != "none", v
    assert v["level"] == "UNKNOWN", v
    assert "expired" in v["detail"].lower(), v


def test_active_alert_still_raises_the_verdict():
    """No regression: a live alert must still be authoritative."""
    v = build_verdict(cap_alerts=[_expiring_cap("ORANGE", _iso(hours=6))],
                      warning_service_available=True)
    assert v["level"] == "HIGH", v
    assert v["basis"] == "cap_alert" and v["confirmed"] is True, v


def test_active_alert_wins_over_an_expired_one():
    v = build_verdict(
        cap_alerts=[_expiring_cap("RED", _iso(days=-3), "old"), _expiring_cap("YELLOW", _iso(hours=3), "new")],
        warning_service_available=True,
    )
    assert v["level"] == "MODERATE", v
    assert v["severity"] == "YELLOW", v
    assert v["basis"] == "cap_alert", v


def test_missing_or_unreadable_expiry_counts_as_active():
    """An alert whose window we cannot read is still an alert. Guessing that it
    lapsed would invent a calm out of a parsing failure."""
    assert _is_expired({"expires": ""}) is False
    assert _is_expired({"expires": None}) is False
    assert _is_expired({"expires": "not-a-date"}) is False
    assert _is_expired({}) is False
    v = build_verdict(cap_alerts=[_expiring_cap("ORANGE", "not-a-date")], warning_service_available=True)
    assert v["level"] == "HIGH", v


def test_naive_expiry_is_compared_not_crashed():
    """Feeds sometimes omit the timezone offset; that must not raise."""
    naive_past = (datetime.now() - timedelta(days=2)).replace(microsecond=0).isoformat()
    naive_future = (datetime.now() + timedelta(days=2)).replace(microsecond=0).isoformat()
    assert _is_expired({"expires": naive_past}) is True
    assert _is_expired({"expires": naive_future}) is False
