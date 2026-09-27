"""Accuracy & Relevance regression tests (2026-09-20 accuracy pass).

Guards the fixes for invented severities and false all-clears:

1. Chain adapters (Weather InTouch / WeatherAPI.com) must normalise an
   unreadable severity to UNKNOWN, never default it to YELLOW — a default
   grade manufactured MODERATE verdicts out of alerts the provider never graded.
2. IMD warnings with a missing severity must not become GREEN (a false calm).
3. An active, relevant CAP alert whose severity is unreadable must make the
   verdict UNKNOWN — it must never fall through to a LOW "no warning".
4. The LLM gate must flag any standard severity named in an answer when the
   official severity is non-standard (e.g. UNKNOWN): the model cannot know the
   level, so naming one is invented.
5. A configured-but-failing CAP feed must be labelled UNAVAILABLE, not
   UNCONFIGURED; and a negative label must not count as "the feed answered".

All external calls are monkeypatched; no network.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

import backend.config as config  # noqa: E402
import backend.adapters.alert_sources as alert_sources  # noqa: E402
import backend.adapters.cap_adapter as cap_adapter  # noqa: E402
from backend.adapters.registry import AdapterUnavailable  # noqa: E402
from backend.services import alert_service  # noqa: E402
from backend.services.imd_service import IMDService  # noqa: E402
from backend.services.response_validator import validate  # noqa: E402
from backend.services.verdict_service import build_verdict  # noqa: E402
from backend.utils.time import now_ist  # noqa: E402


# 1. Chain severity normalisation -------------------------------------------
def test_intouch_unreadable_severity_is_unknown_not_yellow():
    assert alert_sources._intouch_severity("ORANGE") == "ORANGE"
    assert alert_sources._intouch_severity("orange") == "ORANGE"
    assert alert_sources._intouch_severity("") == "UNKNOWN"
    assert alert_sources._intouch_severity(None) == "UNKNOWN"
    assert alert_sources._intouch_severity("Critical") == "UNKNOWN"


def test_weatherapi_unreadable_severity_is_unknown_not_yellow():
    assert alert_sources._wapi_severity("Severe") == "ORANGE"
    assert alert_sources._wapi_severity("Minor") == "GREEN"
    assert alert_sources._wapi_severity("") == "UNKNOWN"
    assert alert_sources._wapi_severity(None) == "UNKNOWN"
    assert alert_sources._wapi_severity("Extreme-ish") == "UNKNOWN"


# 2. IMD warning without a severity ------------------------------------------
def test_imd_warning_missing_severity_is_unknown_not_green(monkeypatch):
    from datetime import timedelta
    raw = {
        "warnings": [{
            "type": "Thunderstorm",
            # no "severity" key at all
            "message": "Thunderstorm likely.",
            "issued_at": now_ist().isoformat(),
            "valid_until": (now_ist() + timedelta(hours=4)).isoformat(),
        }],
    }

    async def fake_get(self, path, params):
        return raw

    monkeypatch.setattr(IMDService, "_get", fake_get)
    w = asyncio.run(IMDService(adapter="live").get_district_warning("Hyderabad"))
    assert w is not None
    assert w.severity == "UNKNOWN", w.severity


# 3. Unreadable-severity CAP alert must not become a calm ---------------------
def _cap_unknown_sev(identifier="cap-u1"):
    from datetime import timedelta
    future = (now_ist() + timedelta(hours=6)).isoformat()
    return {
        "source": "NDMA-Sachet-CAP", "identifier": identifier,
        "hazard": "Thunderstorm", "severity": "UNKNOWN",
        "area": "Hyderabad district, Telangana", "areaDesc": "Hyderabad district, Telangana",
        "headline": "Thunderstorm likely", "expires": future,
    }


def test_active_alert_with_unreadable_severity_is_unknown_not_low():
    v = build_verdict(cap_alerts=[_cap_unknown_sev()],
                      warning_service_available=True)
    assert v["level"] == "UNKNOWN", v
    assert v["level"] != "LOW", v
    assert v["basis"] != "none", v
    assert v.get("unreadable_severity") is True, v
    assert v["confirmed"] is False, v


def test_readable_severity_still_wins_over_unreadable():
    from datetime import timedelta
    future = (now_ist() + timedelta(hours=6)).isoformat()
    readable = dict(_cap_unknown_sev("cap-r1"), severity="ORANGE", expires=future)
    v = build_verdict(cap_alerts=[_cap_unknown_sev(), readable],
                      warning_service_available=True)
    assert v["level"] == "HIGH", v
    assert v["basis"] == "cap_alert", v


# 4. LLM gate: invented severity against a non-standard official one ---------
def test_validator_flags_named_severity_when_official_is_unknown():
    verified = {"verified": True, "severity": "UNKNOWN", "hazard": "Thunderstorm",
                "valid_until": "2026-09-21T00:00:00+05:30"}
    answer = "There is an active RED alert for thunderstorms in your district."
    sent, findings = validate(answer, verified, [], "en")
    assert any(f.startswith("invented-severity:") for f in findings), findings
    assert "UNKNOWN" in sent or "[STRUCTURED]" in sent


def test_validator_still_allows_matching_standard_severity():
    verified = {"verified": True, "severity": "ORANGE", "hazard": "Thunderstorm",
                "valid_until": "2026-09-21T00:00:00+05:30"}
    answer = "There is an active ORANGE alert for thunderstorms, valid until tomorrow."
    sent, findings = validate(answer, verified, [], "en")
    assert not findings, findings
    assert sent == answer


# 5. CAP-down provenance ------------------------------------------------------
def _gather(monkeypatch, cap_exc, cap_configured):
    async def fake_fetch():
        raise cap_exc

    async def fake_chain(lat, lon, district):
        from backend.adapters.alert_sources import UNAVAILABLE
        return [], UNAVAILABLE

    monkeypatch.setattr(cap_adapter, "fetch_alerts", fake_fetch)
    monkeypatch.setattr(alert_sources, "get_alerts", fake_chain)
    if cap_configured:
        monkeypatch.setattr(config, "CAP_FEED_URL", "https://example.invalid/cap.xml")
        monkeypatch.setattr(config, "CAP_FEED_URLS", ["https://example.invalid/cap.xml"])
    else:
        monkeypatch.setattr(config, "CAP_FEED_URL", "")
        monkeypatch.setattr(config, "CAP_FEED_URLS", [])


def test_configured_but_failing_cap_feed_is_unavailable(monkeypatch):
    _gather(monkeypatch, AdapterUnavailable("CAP feeds unreachable and no cached alerts"),
            cap_configured=True)
    got = asyncio.run(alert_service.gather_alerts(
        lat=17.385, lon=78.4867, district="Hyderabad", state="Telangana"))
    assert got["provenance"] == "UNAVAILABLE", got["provenance"]
    assert got["available"] is False, got
    assert got["relevant"] == [] and got["nearby"] == []


def test_unconfigured_cap_feed_stays_unconfigured(monkeypatch):
    _gather(monkeypatch, AdapterUnavailable("CAP feed unconfigured (needs CAP_FEED_URL)"),
            cap_configured=False)
    got = asyncio.run(alert_service.gather_alerts(
        lat=17.385, lon=78.4867, district="Hyderabad", state="Telangana"))
    assert got["provenance"] == "UNCONFIGURED", got["provenance"]
    assert got["available"] is False, got


def test_fetch_cap_negative_labels_are_not_answers(monkeypatch):
    # A live CAP answer keeps available=True; a negative label never does.
    async def fake_live():
        return [], "LIVE"

    async def fake_chain(lat, lon, district):
        return [], "UNAVAILABLE"

    monkeypatch.setattr(cap_adapter, "fetch_alerts", fake_live)
    monkeypatch.setattr(alert_sources, "get_alerts", fake_chain)
    got = asyncio.run(alert_service.gather_alerts(
        lat=17.385, lon=78.4867, district="Hyderabad", state="Telangana"))
    assert got["available"] is True, got
    assert got["provenance"] == "UNCONFIGURED", got["provenance"]
