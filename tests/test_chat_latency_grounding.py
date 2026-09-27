"""Chat latency + LLM grounding: the commercial alert chain must not cost ~1.4s
on every chat turn, and answers must cite their sources.

Latency contract (backend/services/alert_service.py::_fetch_chain):
- A LIVE-with-alerts chain answer is served from a 5-minute TTL cache.
- The served copy is labelled CACHED (honest provenance, like the CAP
  serve-fresh cache); failures and empty answers are never cached.
- A cached chain still counts as an answered feed for the verdict.

Grounding contract (backend/services/llm_service.py):
- The system prompt requires inline source citation from the evidence fields.
- The no-LLM template path cites sources too: warning source on the warning
  line, weather source on temp/rain/wind lines, in en/hi/te.
- An unreachable warning service names NO warning source.
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.adapters import alert_sources
from backend.services import alert_service
from backend.services import llm_service
from backend.services.llm_service import _template_answer


def _alert(identifier):
    return {"identifier": identifier,
            "headline": "Thunderstorm warning for Hyderabad district, Telangana",
            "area": "Hyderabad", "severity": "Yellow",
            "sent": "2026-09-27T10:00:00+05:30",
            "expires": "2026-09-28T10:00:00+05:30"}


def _evidence(lang="en", warning_service="available", warn=False, wsrc="IMD"):
    verified = {"verified": warn, "severity": "Yellow", "hazard": "Thunderstorm",
                "source": wsrc, "valid_until": "2026-09-28"}
    if warning_service == "unavailable":
        verified = {"verified": False, "warning_service": "unavailable"}
    return {
        "source": "Open-Meteo",
        "source_name": "Open-Meteo",
        "location": {"city": "Hyderabad", "district": "Hyderabad", "state": "Telangana"},
        "current_weather": {"temperature": 31.5, "wind_speed": 8.9},
        "forecast": {"days": [
            {"date": "2026-09-27", "rainfall": 0.0, "min_temperature": 23.0, "max_temperature": 31.5},
            {"date": "2026-09-28", "rainfall": 1.4, "min_temperature": 22.5, "max_temperature": 32.0},
        ]},
        "verified_warning": verified,
        "weathergpt_risk": "LOW",
        "user_type": "general",
    }


# ---------------- chain cache ----------------

def _run(coro):
    return asyncio.run(coro)


def test_chain_cache_serves_without_network():
    alert_service._CHAIN_CACHE.clear()
    calls = []

    async def fake_get_alerts(lat, lon, district):
        calls.append((lat, lon, district))
        return [_alert("a1")], "LIVE"

    orig = alert_sources.get_alerts
    alert_sources.get_alerts = fake_get_alerts
    try:
        a1, p1 = _run(alert_service._fetch_chain(17.385, 78.4867, "Hyderabad"))
        a2, p2 = _run(alert_service._fetch_chain(17.385, 78.4867, "Hyderabad"))
    finally:
        alert_sources.get_alerts = orig
        alert_service._CHAIN_CACHE.clear()
    assert p1 == "LIVE" and len(a1) == 1
    assert p2 == "CACHED" and len(a2) == 1
    assert [x["identifier"] for x in a1] == [x["identifier"] for x in a2]
    assert len(calls) == 1, "second call must not touch the network"


def test_chain_cache_ttl_expiry_refetches():
    alert_service._CHAIN_CACHE.clear()
    calls = []

    async def fake_get_alerts(lat, lon, district):
        calls.append(1)
        return [_alert("a1")], "LIVE"

    orig = alert_sources.get_alerts
    alert_sources.get_alerts = fake_get_alerts
    try:
        _run(alert_service._fetch_chain(17.385, 78.4867, "Hyderabad"))
        # Backdate the entry beyond the TTL.
        key = next(iter(alert_service._CHAIN_CACHE))
        alerts, prov, _ = alert_service._CHAIN_CACHE[key]
        alert_service._CHAIN_CACHE[key] = (alerts, prov,
                                           time.monotonic() - alert_service._CHAIN_TTL_S - 1)
        a2, p2 = _run(alert_service._fetch_chain(17.385, 78.4867, "Hyderabad"))
    finally:
        alert_sources.get_alerts = orig
        alert_service._CHAIN_CACHE.clear()
    assert p2 == "LIVE"
    assert len(calls) == 2, "expired entry must trigger a live refetch"


def test_chain_cache_ignores_negative_answers():
    alert_service._CHAIN_CACHE.clear()
    calls = []

    async def fake_get_alerts(lat, lon, district):
        calls.append(1)
        return [], "UNAVAILABLE"

    orig = alert_sources.get_alerts
    alert_sources.get_alerts = fake_get_alerts
    try:
        _run(alert_service._fetch_chain(17.385, 78.4867, "Hyderabad"))
        _run(alert_service._fetch_chain(17.385, 78.4867, "Hyderabad"))
    finally:
        alert_sources.get_alerts = orig
        alert_service._CHAIN_CACHE.clear()
    assert alert_service._CHAIN_CACHE == {}, "failures/empty answers must never be cached"
    assert len(calls) == 2, "recovery must never be delayed by a cached failure"


def test_chain_cached_counts_as_answered_feed():
    # Seed the cache directly, then gather with the official feeds silent:
    # the verdict inputs must still treat the chain as an answered feed.
    alert_service._CHAIN_CACHE.clear()
    key = (17.385, 78.487, "hyderabad")
    alert_service._CHAIN_CACHE[key] = ([_alert("a9")], "LIVE", time.monotonic())

    async def fake_cap():
        return [], "UNCONFIGURED"

    orig_cap = alert_service._fetch_cap
    alert_service._fetch_cap = fake_cap
    try:
        out = _run(alert_service._gather_uncached(
            lat=17.385, lon=78.4867, district="Hyderabad", state="Telangana"))
    finally:
        alert_service._fetch_cap = orig_cap
        alert_service._CHAIN_CACHE.clear()
    assert out["available"] is True
    assert [a["identifier"] for a in out["relevant"]] == ["a9"]
    assert out["relevant"][0]["provenance"] == "CACHED"


# ---------------- template grounding ----------------

def test_template_cites_warning_source():
    ans = _template_answer(_evidence(warn=True, wsrc="NDMA-Sachet-CAP"), "en", "Any warnings?")
    assert "(source: NDMA-Sachet-CAP)" in ans


def test_template_weather_lines_carry_source():
    ans = _template_answer(_evidence(), "en", "How is the wind today?")
    assert "(source: Open-Meteo)" in ans  # temp line
    assert "Wind in Hyderabad is currently 8.9 km/h (source: Open-Meteo)" in ans


def test_template_unreachable_names_no_warning_source():
    ans = _template_answer(_evidence(warning_service="unavailable"), "en", "Any warnings?")
    assert "could not be reached" in ans
    # The warning sentence must not invent a warning source. Weather lines may
    # still cite their (real) data source.
    warn_sentence = next(s for s in ans.split(". ") if "could not be reached" in s)
    assert "(source:" not in warn_sentence


def test_template_citations_multilingual():
    hi = _template_answer(_evidence(warn=True, wsrc="IMD"), "hi", "चेतावनी?")
    te = _template_answer(_evidence(warn=True, wsrc="IMD"), "te", "హెచ్చరిక?")
    assert "(स्रोत: IMD)" in hi and "(स्रोत: Open-Meteo)" in hi
    assert "(మూలం: IMD)" in te and "(మూలం: Open-Meteo)" in te


def test_system_prompt_requires_source_citation():
    prompt = llm_service.SYSTEM_RULES
    assert "CITE YOUR SOURCES" in prompt
    assert "source_name" in prompt and "verified_warning" in prompt
    assert "NEVER invent a source name" in prompt
    # The pre-existing safety pins still hold.
    assert prompt.startswith("You are SAARTHI,")
    assert "WeatherGPT" not in prompt
    assert "Do not create emergency warnings" in prompt
    assert "Silence from a broken service is not an all-clear" in prompt
