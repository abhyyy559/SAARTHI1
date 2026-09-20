"""Chat advisory × verdict contract tests.

Two failure classes are pinned here:

  1. "We could not check" must never be rendered as "no warning". The chat
     total-failure branch used to append the all-clear advisory directly under an
     answer that said no data could be retrieved.
  2. Chat and the Alerts page must render ONE severity, decided by
     `verdict_service.build_verdict`. A relevant official CAP alert raises chat's
     risk even when the IMD district feed is down — otherwise the Alerts page
     shows an ORANGE alert while chat says LOW/UNKNOWN for the same user.

Plus a gap audit of the advisory matrices (personas × languages × states).

All external calls are monkeypatched (offline), and runtime stores are isolated
to tmp_path so the developer's real weathergpt_cache.json is never touched.
"""
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import backend.adapters.alert_sources as alert_sources  # noqa: E402
import backend.adapters.cap_adapter as cap_adapter  # noqa: E402
import backend.api.chat as chat  # noqa: E402
import backend.api.weather as weather_mod  # noqa: E402
import backend.config as config  # noqa: E402
from backend.adapters.registry import AdapterUnavailable  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models.weather import WeatherWarning  # noqa: E402
from backend.services import advisory_service as advisory  # noqa: E402
from backend.services.cache_service import CacheService  # noqa: E402
from backend.services.imd_service import IMDService  # noqa: E402
from backend.services.verdict_service import build_verdict  # noqa: E402
from backend.utils.time import now_ist  # noqa: E402

PERSONAS = ["general", "farmer", "driver", "fisherman", "researcher", "disaster_manager"]
LANGS = ["en", "hi", "te"]
VERDICT_KEYS = {"level", "basis", "confirmed", "severity", "hazard",
                "source", "nearby_count", "detail"}

ALL_CLEAR_TEXTS = {text for row in advisory._NO_WARN.values() for text in row.values()}
UNREACHABLE_TEXTS = {text for row in advisory._UNREACHABLE.values() for text in row.values()}

# The three states the chat/advisory layer must distinguish.
VERDICT_STATES = {
    "verified warning": build_verdict(
        verified={"verified": True, "severity": "ORANGE", "hazard": "Thunderstorm"}),
    "no warning": build_verdict(warning_service_available=True),
    "service unreachable": build_verdict(warning_service_available=False),
}


@pytest.fixture(autouse=True)
def _isolate_runtime_stores(tmp_path, monkeypatch):
    """Never read/write the developer's real weathergpt_cache.json."""
    cache_file = str(tmp_path / "weathergpt_cache.json")
    monkeypatch.setattr(config, "CACHE_FILE", cache_file)
    monkeypatch.setattr(weather_mod, "cache", CacheService(cache_file))


def _cap(severity, area="Hyderabad district, Telangana", identifier="cap-1"):
    return {
        "source": "NDMA-Sachet-CAP", "identifier": identifier, "hazard": "Thunderstorm",
        "severity": severity, "area": area, "areaDesc": area,
        "headline": "Thunderstorm likely", "polygon": "", "circle": "",
    }


def _warning(district="Hyderabad", severity="YELLOW"):
    return WeatherWarning(
        source="IMD", hazard="Thunderstorm", severity=severity, district=district,
        message="Thunderstorm with lightning likely.", issued_at=now_ist(),
        valid_until=now_ist() + timedelta(hours=4), verified=False, active=False,
    )


def _install_chat_live(monkeypatch, *, imd_raises=False, imd_warning=None, caps=(), weather=False):
    """Force the chat live branch with deterministic, offline sources."""
    monkeypatch.setattr(config, "DEMO_MODE", False)

    async def fake_warning(self, district):
        if imd_raises:
            raise AdapterUnavailable("IMD live unreachable")
        return imd_warning

    monkeypatch.setattr(IMDService, "get_district_warning", fake_warning)

    async def fake_current(lat, lon):
        if not weather:
            raise AdapterUnavailable("no live observation")
        return {"source": "Open-Meteo", "temperature": 28.0}, "LIVE"

    async def fake_forecast(lat, lon):
        if not weather:
            raise AdapterUnavailable("no live forecast")
        return {"source": "Open-Meteo", "days": []}, "LIVE"

    monkeypatch.setattr(chat, "_live_current", fake_current)
    monkeypatch.setattr(chat, "_live_forecast", fake_forecast)

    async def fake_fetch():
        return [dict(c) for c in caps], "LIVE"

    monkeypatch.setattr(cap_adapter, "fetch_alerts", fake_fetch)

    # The Alerts page merges this chain in; keep it offline and empty so the
    # cross-check below compares like with like.
    async def fake_chain(lat, lon, district):
        return [], "UNAVAILABLE"

    monkeypatch.setattr(alert_sources, "get_alerts", fake_chain)

    async def fake_generate(self, evidence, question, language):
        return ("Grounded answer.", False)

    monkeypatch.setattr(chat.LLMService, "generate", fake_generate)


def _ask(**payload):
    body = {"message": "Will it rain?", "latitude": 17.385, "longitude": 78.4867}
    body.update(payload)
    r = TestClient(app).post("/api/chat", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------
# 1. REGRESSION (Bug 1): total failure must read "we could not check",
#    never "no active official warning".
# --------------------------------------------------------------------------
@pytest.mark.parametrize("user_type,language", [("general", "en"), ("farmer", "hi"), ("fisherman", "te")])
def test_total_failure_never_reads_as_all_clear(monkeypatch, user_type, language):
    _install_chat_live(monkeypatch, imd_raises=True)  # no weather, no CAP
    body = _ask(user_type=user_type, language=language)

    key = user_type if user_type in advisory._UNREACHABLE else "general"
    print(f"\n[BUG 1] {user_type}/{language} advisory -> {body['advisory']!r}")
    # The advisory may carry a true lead sentence before the notice — e.g. an
    # inland district is told it is inland, which applies to the place and not to
    # the warning state. What must hold is that the "we could not check" notice is
    # present verbatim and is the LAST thing said: nothing all-clear, and no
    # advice, may be appended after an unverified warning state.
    assert advisory._UNREACHABLE[key][language] in body["advisory"], body["advisory"]
    assert body["advisory"].endswith(advisory._UNREACHABLE[key][language]), body["advisory"]
    assert body["advisory"] not in ALL_CLEAR_TEXTS, body["advisory"]
    if language == "en":
        assert "we cannot confirm" in body["advisory"].lower(), body["advisory"]
        assert "no active official warning" not in body["advisory"].lower(), body["advisory"]
        assert body["answer"].lower().count("no active official warning") == 0, body["answer"]

    assert body["verdict"]["basis"] == "unavailable", body["verdict"]
    assert body["verdict"]["confirmed"] is False, body["verdict"]
    assert body["verdict"]["level"] == "UNKNOWN", body["verdict"]
    assert body["risk"]["level"] == "UNKNOWN", body["risk"]
    assert body["risk"]["source"] == "WEATHERGPT", body["risk"]


# --------------------------------------------------------------------------
# 2. Bug 2: an official CAP alert outranks an unreachable IMD — in chat too.
# --------------------------------------------------------------------------
@pytest.mark.parametrize("weather", [False, True])
def test_cap_orange_with_imd_down_is_high_in_chat(monkeypatch, weather):
    _install_chat_live(monkeypatch, imd_raises=True, caps=[_cap("ORANGE")], weather=weather)
    body = _ask(user_type="farmer")

    print(f"\n[BUG 2] weather_available={weather} verdict -> {body['verdict']!r}"
          f"\n[BUG 2] advisory -> {body['advisory']!r}")
    assert body["verdict"]["level"] == "HIGH", body["verdict"]
    assert body["verdict"]["basis"] == "cap_alert", body["verdict"]
    assert body["verdict"]["confirmed"] is True, body["verdict"]
    assert body["risk"]["level"] == "HIGH", body["risk"]
    assert body["risk"]["source"] == "WEATHERGPT", body["risk"]

    expected = (f"{advisory._ACTIVE['en'].format(sev='ORANGE', haz='Thunderstorm')} "
                f"{advisory._ACTION['farmer']['en']}")
    assert body["advisory"] == expected, body["advisory"]
    assert body["advisory"] not in ALL_CLEAR_TEXTS, body["advisory"]
    assert body["advisory"] not in UNREACHABLE_TEXTS, body["advisory"]


# --------------------------------------------------------------------------
# Chat and the Alerts page must never render two verdicts for one payload.
# --------------------------------------------------------------------------
def test_chat_and_alerts_page_agree_on_one_severity(monkeypatch):
    _install_chat_live(monkeypatch, imd_raises=True, caps=[_cap("ORANGE")], weather=True)
    chat_body = _ask()
    r = TestClient(app).get("/api/weather/warnings",
                            params={"district": "Hyderabad", "lat": 17.385, "lon": 78.4867})
    assert r.status_code == 200, r.text
    page_verdict = r.json()["verdict"]
    assert chat_body["verdict"] == page_verdict, (chat_body["verdict"], page_verdict)
    assert chat_body["risk"]["level"] == page_verdict["level"] == "HIGH"


# --------------------------------------------------------------------------
# 3. A verified official YELLOW warning is MODERATE in chat, never re-graded.
# --------------------------------------------------------------------------
def test_verified_yellow_is_moderate_in_chat(monkeypatch):
    _install_chat_live(monkeypatch, imd_warning=_warning(severity="YELLOW"), weather=True)
    body = _ask()
    assert body["verdict"]["level"] == "MODERATE", body["verdict"]
    assert body["verdict"]["basis"] == "verified_warning", body["verdict"]
    assert body["risk"]["level"] == "MODERATE", body["risk"]
    assert "warning is active" in body["advisory"], body["advisory"]


# --------------------------------------------------------------------------
# 4. Bug 3: every persona × language × state yields real text.
# --------------------------------------------------------------------------
def test_advisory_matrix_has_no_gaps():
    texts = set()
    for user_type in PERSONAS:
        for language in LANGS:
            for state, verdict in VERDICT_STATES.items():
                for v in (verdict, None):  # verdict-driven and legacy callers
                    text = advisory.advisory_for({"verified": False}, user_type, language, verdict=v)
                    assert isinstance(text, str) and text.strip(), (user_type, language, state, v)
                    assert text not in ("en", "hi", "te"), (user_type, language, state, v)
                    texts.add(text)
    assert len(texts) >= 3  # distinct states must produce distinct messages
    assert advisory._UNREACHABLE["general"]["en"] in texts
    assert advisory._NO_WARN["general"]["en"] in texts


def test_persona_matrices_are_parallel():
    """Every _NO_WARN persona must exist in _UNREACHABLE and _ACTION, in all 3 languages."""
    for name, table in (("_UNREACHABLE", advisory._UNREACHABLE), ("_ACTION", advisory._ACTION)):
        assert set(advisory._NO_WARN) <= set(table), (name, set(advisory._NO_WARN) - set(table))
        for persona in advisory._NO_WARN:
            for lang in LANGS:
                value = table[persona].get(lang)
                assert isinstance(value, str) and value.strip(), (name, persona, lang)
    for persona, row in advisory._NO_WARN.items():
        for lang in LANGS:
            assert row.get(lang, "").strip(), ("_NO_WARN", persona, lang)


# --------------------------------------------------------------------------
# 5. An unknown persona falls back to `general` instead of raising.
# --------------------------------------------------------------------------
def test_unknown_persona_falls_back_to_general():
    unreachable = build_verdict(warning_service_available=False)
    assert advisory.advisory_for({"verified": False}, "astronaut", "en",
                                 verdict=unreachable) == advisory._UNREACHABLE["general"]["en"]
    assert advisory.advisory_for({"verified": False}, "astronaut", "en") == advisory._NO_WARN["general"]["en"]
    assert advisory.advisory_for({"verified": False}, "", "en") == advisory._NO_WARN["general"]["en"]
    assert advisory.advisory_for({"verified": False}, None, "en") == advisory._NO_WARN["general"]["en"]
    # Unknown language falls back to English, never to an empty string.
    assert advisory.advisory_for({"verified": False}, "farmer", "fr") == advisory._NO_WARN["farmer"]["en"]
    assert advisory.advisory_for({}, "farmer", "en").strip()


# --------------------------------------------------------------------------
# 6. `warning_status="unavailable"` still forces the unreachable text
#    (the contract backend/api/v1.py depends on).
# --------------------------------------------------------------------------
def test_warning_status_unavailable_forces_unreachable_text():
    assert advisory.advisory_for({"verified": False}, "general", "en",
                                 warning_status="unavailable") == advisory._UNREACHABLE["general"]["en"]
    assert advisory.advisory_for({"verified": False, "warning_service": "unavailable"},
                                 "general", "en") == advisory._UNREACHABLE["general"]["en"]
    # A reachable service with nothing to report is still a legitimate all-clear.
    assert advisory.advisory_for({"verified": False}, "general", "en") == advisory._NO_WARN["general"]["en"]


# --------------------------------------------------------------------------
# The ChatResponse verdict field is populated on every branch, demo included.
# --------------------------------------------------------------------------
def test_chat_response_always_carries_a_verdict(monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", True)
    body = _ask()
    assert set(body["verdict"]) == VERDICT_KEYS, body["verdict"]
    assert body["verdict"]["level"] == "MODERATE", body["verdict"]
    assert body["verdict"]["basis"] == "verified_warning", body["verdict"]


# --------------------------------------------------------------------------
# Coastal flag: a sea-going persona in an inland district must be told so.
#
# `coastal` lived in the gazetteer with a comment promising the answer layer
# would state plainly when a sea-going occupation is used from a landlocked
# district — but nothing read it, so a fisherman in Hyderabad was told to
# "return to shore". An advisory that does not apply to the reader is worse than
# no advisory: it teaches people to ignore the ones that do.
# --------------------------------------------------------------------------
def test_inland_fisherman_is_told_there_is_no_sea():
    out = advisory.advisory_for(
        {"verified": False}, "fisherman", "en",
        verdict={"confirmed": True, "basis": "cap_alert", "level": "MODERATE",
                 "severity": "YELLOW", "hazard": "Lightning"},
        coastal=False, district="Hyderabad",
    )
    assert "not a coastal district" in out, out
    assert "tanks, reservoirs or rivers" in out, out
    # The sea-specific instruction must be gone, not merely prefixed.
    assert "venture into the sea" not in out, out
    assert "YELLOW" in out and "Lightning" in out, out


def test_coastal_fisherman_keeps_sea_advice():
    out = advisory.advisory_for(
        {"verified": False}, "fisherman", "en",
        verdict={"confirmed": True, "basis": "cap_alert", "level": "MODERATE",
                 "severity": "YELLOW", "hazard": "Lightning"},
        coastal=True, district="Visakhapatnam",
    )
    assert "not a coastal district" not in out, out
    assert "venture into the sea" in out, out


def test_unknown_coastal_flag_is_not_called_inland():
    """None means we do not know. Saying "inland" would be a guess about the
    user's geography, and a wrong one for anyone outside our coverage."""
    out = advisory.advisory_for(
        {"verified": False}, "fisherman", "en",
        verdict={"confirmed": True, "basis": "cap_alert", "level": "MODERATE",
                 "severity": "YELLOW", "hazard": "Lightning"},
        coastal=None, district="Somewhere",
    )
    assert "not a coastal district" not in out, out


def test_inland_lead_applies_to_every_state_not_just_warnings():
    """Inland is a fact about the place, so it must survive the all-clear and
    the unreachable branches too — those are exactly where a wrong "for the
    coast" sentence reads as a real coastal forecast."""
    calm = advisory.advisory_for(
        {"verified": True, "severity": "GREEN"}, "fisherman", "en",
        verdict={"confirmed": True, "basis": "verified_warning", "level": "LOW",
                 "severity": "GREEN", "hazard": "None"},
        coastal=False, district="Hyderabad",
    )
    assert "not a coastal district" in calm, calm
    unreachable = advisory.advisory_for(
        {"verified": False, "warning_service": "unavailable"}, "fisherman", "en",
        verdict={"confirmed": False, "basis": "unavailable", "level": "UNKNOWN"},
        coastal=False, district="Hyderabad",
    )
    assert "not a coastal district" in unreachable, unreachable


def test_inland_lead_does_not_touch_other_personas():
    for persona in ("farmer", "driver", "general", "researcher", "disaster_manager"):
        out = advisory.advisory_for({"verified": False}, persona, "en",
                                    verdict={"confirmed": True, "basis": "cap_alert",
                                             "level": "MODERATE", "severity": "YELLOW",
                                             "hazard": "Lightning"},
                                    coastal=False, district="Hyderabad")
        assert "not a coastal district" not in out, (persona, out)


def test_inland_lead_is_translated():
    for lang, marker in (("hi", "तटीय"), ("te", "తీర")):
        out = advisory.advisory_for({"verified": False}, "fisherman", lang,
                                    verdict={"confirmed": True, "basis": "cap_alert",
                                             "level": "MODERATE", "severity": "YELLOW",
                                             "hazard": "Lightning"},
                                    coastal=False, district="Hyderabad")
        assert marker in out, (lang, out)
