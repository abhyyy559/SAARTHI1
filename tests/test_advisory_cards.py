"""Advisory-cards rules-engine tests.

Pinned behaviours (eval params 1, 3, 4 · key features 5, 6):

1. Missing data is stated, never fabricated — no measurement number may appear
   in a card body unless it was present in the input.
2. Official severity is never invented or escalated; UNKNOWN stays UNKNOWN;
   rule-derived cards are "info".
3. At most 4 cards; alert-driven cards rank first.
4. Every card carries non-empty basis citations with named provenance.
5. EN/HI/TE template parity: identical key sets, no unfilled placeholders.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from backend.services import advisory_cards_service as acs  # noqa: E402

_MEASURE = re.compile(r"\d+(?:\.\d+)?\s?(?:mm|°C|kph|km/h)")


def _forecast(rains=(0, 0, 0), maxes=(30, 31, 32), mins=(22, 23, 24), src="Open-Meteo"):
    return {
        "source": src,
        "days": [
            {"date": f"2026-09-{20 + i}", "rainfall": rains[i],
             "max_temperature": maxes[i], "min_temperature": mins[i]}
            for i in range(3)
        ],
    }


def _current(temp=31, rain=0, wind=10, src="Open-Meteo"):
    return {"source": src, "temperature": temp, "rainfall": rain, "wind_speed": wind}


def _alert(sev="YELLOW", ident="IN-ID-1", hazard="Thunderstorm"):
    return {"identifier": ident, "severity": sev, "hazard": hazard,
            "source": "NDMA-Sachet-CAP", "expires": "2026-09-21T18:00:00+05:30"}


def _verdict_confirmed(sev="YELLOW"):
    return {"confirmed": True, "level": "MODERATE", "severity": sev,
            "hazard": "Thunderstorm", "basis": "cap_alert",
            "source": "NDMA-Sachet-CAP"}


# --- honesty: never fabricate -------------------------------------------------
def test_missing_data_never_invents_numbers():
    cards = acs.advisory_cards(None, None, [], {}, persona="farmer", lang="en",
                               current_prov="UNAVAILABLE", forecast_prov="UNAVAILABLE")
    assert cards, "empty inputs must still yield honest unavailable cards"
    for c in cards:
        assert not _MEASURE.search(c["title"]), f"invented number in title: {c}"
        assert not _MEASURE.search(c["body"]), f"invented number in body: {c}"
    # ...but the cards must say what is missing, not go silent.
    joined = " ".join(c["body"] for c in cards).lower()
    assert "unavailable" in joined


def test_missing_forecast_agri_card_names_the_gap():
    cards = acs.advisory_cards(_current(), None, [], {}, persona="farmer", lang="en")
    agri = [c for c in cards if c["kind"] == "agriculture"]
    assert len(agri) == 1
    assert agri[0]["id"] == "agri-no-data"
    assert "agriculture officer" in agri[0]["body"]
    assert agri[0]["severity_word"] == "info"


def test_partial_data_only_cites_what_exists():
    # Forecast present, current missing: agri fires on forecast, health uses
    # forecast temps, commute uses forecast rain — no current citations.
    cards = acs.advisory_cards(None, _forecast(rains=(0, 62, 0)), [], {},
                               persona="farmer", lang="en",
                               current_prov="UNAVAILABLE")
    agri = [c for c in cards if c["kind"] == "agriculture"][0]
    assert agri["id"] == "agri-rain-heavy"
    assert "62mm" in agri["body"]
    assert "Current:" not in " ".join(agri["basis"])


# --- severity: never invented or escalated ------------------------------------
def test_alert_card_carries_verdict_severity_verbatim():
    cards = acs.advisory_cards(_current(), _forecast(), [_alert("YELLOW")],
                               _verdict_confirmed("YELLOW"), persona="general")
    ac = [c for c in cards if c["kind"] == "alert_safety"]
    assert len(ac) == 1
    assert ac[0]["severity_word"] == "YELLOW"
    assert "YELLOW" in ac[0]["basis"][0]


def test_unknown_severity_stays_unknown():
    verdict = {"confirmed": False, "level": "UNKNOWN", "severity": None,
               "basis": "unavailable", "unreadable_severity": True,
               "hazard": "Thunderstorm", "source": "NDMA-Sachet-CAP"}
    cards = acs.advisory_cards(_current(), _forecast(), [_alert("UNKNOWN")],
                               verdict, persona="general")
    ac = [c for c in cards if c["kind"] == "alert_safety"]
    assert len(ac) == 1
    assert ac[0]["severity_word"] == "UNKNOWN"
    assert ac[0]["id"] == "alert-unconfirmed"
    # Must not read as a calm, and must not invent an active warning.
    joined = (ac[0]["title"] + " " + ac[0]["body"]).lower()
    assert "could not be confirmed" in joined or "unverified" in joined


def test_rule_cards_are_info_not_severity():
    cards = acs.advisory_cards(_current(temp=44), _forecast(rains=(0, 70, 0)), [],
                               {}, persona="farmer")
    for c in cards:
        assert c["severity_word"] == "info", c


def test_no_alert_no_alert_card():
    cards = acs.advisory_cards(_current(), _forecast(), [], {}, persona="general")
    assert not [c for c in cards if c["kind"] == "alert_safety"]


def test_low_verdict_produces_no_alert_card():
    verdict = {"confirmed": True, "level": "LOW", "severity": "GREEN",
               "basis": "no_warning", "source": "IMD"}
    cards = acs.advisory_cards(_current(), _forecast(), [], verdict, persona="general")
    assert not [c for c in cards if c["kind"] == "alert_safety"]


# --- cap and ranking ----------------------------------------------------------
def test_four_card_cap_with_alerts_first():
    alerts = [_alert("RED", f"IN-ID-{i}") for i in range(6)]
    cards = acs.advisory_cards(_current(temp=44), _forecast(rains=(0, 70, 0)),
                               alerts, _verdict_confirmed("RED"), persona="farmer")
    assert len(cards) <= 4
    assert all(c["kind"] == "alert_safety" for c in cards)
    assert all(c["severity_word"] == "RED" for c in cards)


def test_alert_ranking_red_before_orange():
    alerts = [_alert("YELLOW", "IN-Y"), _alert("RED", "IN-R"), _alert("ORANGE", "IN-O")]
    verdict = _verdict_confirmed("RED")
    cards = acs.advisory_cards(_current(), _forecast(), alerts, verdict,
                               persona="driver")
    got = [c["severity_word"] for c in cards if c["kind"] == "alert_safety"]
    assert got == ["RED", "ORANGE", "YELLOW"]


def test_rules_ranked_after_alerts():
    cards = acs.advisory_cards(_current(temp=44), _forecast(rains=(0, 70, 0)),
                               [_alert("YELLOW")], _verdict_confirmed("YELLOW"),
                               persona="farmer")
    kinds = [c["kind"] for c in cards]
    assert kinds[0] == "alert_safety"
    assert len(cards) <= 4


# --- thresholds ----------------------------------------------------------------
def test_agri_thresholds():
    heavy = acs.advisory_cards(None, _forecast(rains=(0, 62, 5)), [], {},
                               persona="farmer")
    assert [c["id"] for c in heavy if c["kind"] == "agriculture"] == ["agri-rain-heavy"]

    hold = acs.advisory_cards(None, _forecast(rains=(0, 25, 5)), [], {},
                              persona="farmer")
    assert [c["id"] for c in hold if c["kind"] == "agriculture"] == ["agri-rain-hold"]

    dry = acs.advisory_cards(None, _forecast(rains=(0, 5, 2)), [], {},
                             persona="farmer")
    assert [c["id"] for c in dry if c["kind"] == "agriculture"] == ["agri-dry"]
    assert "5mm" in [c for c in dry if c["kind"] == "agriculture"][0]["body"]


def test_health_heat_and_cold_thresholds():
    hot = acs.advisory_cards(_current(temp=39), _forecast(maxes=(40, 43, 41)), [],
                             {}, persona="general")
    heat = [c for c in hot if c["kind"] == "health"][0]
    assert heat["id"] == "health-heat"
    assert "43°C" in heat["body"]

    cold = acs.advisory_cards(_current(temp=8), _forecast(mins=(6, 4, 7)), [],
                              {}, persona="general")
    assert [c["id"] for c in cold if c["kind"] == "health"] == ["health-cold"]


def test_commute_gale_threshold():
    cards = acs.advisory_cards(_current(wind=65), _forecast(), [], {},
                               persona="driver")
    assert [c["id"] for c in cards if c["kind"] == "commute"] == ["commute-wind"]


# --- persona gating -------------------------------------------------------------
def test_persona_gating():
    fisher = acs.advisory_cards(_current(), _forecast(), [], {}, persona="fisherman")
    kinds = {c["kind"] for c in fisher}
    assert "agriculture" not in kinds  # sea-going persona: no farm cards
    assert "health" in kinds

    farmer = acs.advisory_cards(_current(), _forecast(), [], {}, persona="farmer")
    assert "agriculture" in {c["kind"] for c in farmer}

    weird = acs.advisory_cards(_current(), _forecast(), [], {}, persona="astronaut")
    assert weird  # unknown persona degrades to general, never crashes


# --- basis citations --------------------------------------------------------------
def test_every_card_has_basis_citations():
    cards = acs.advisory_cards(_current(temp=44), _forecast(rains=(0, 62, 0)),
                               [_alert("ORANGE")], _verdict_confirmed("ORANGE"),
                               persona="farmer", current_prov="LIVE",
                               forecast_prov="CACHED", alerts_prov="LIVE")
    for c in cards:
        assert c["basis"], f"card without basis: {c['id']}"
        for b in c["basis"]:
            assert isinstance(b, str) and b.strip()
            assert any(p in b for p in ("LIVE", "CACHED", "DEMO", "UNAVAILABLE")), b
        assert c["valid_for"].strip()
        assert set(c) >= {"id", "kind", "title", "body", "basis",
                          "severity_word", "valid_for"}


# --- EN/HI/TE parity ----------------------------------------------------------------
def test_template_key_parity():
    per = acs.template_langs()
    assert set(per) == {"en", "hi", "te"}
    assert per["en"] == per["hi"] == per["te"], "template key mismatch across langs"


def test_no_unfilled_placeholders_in_any_lang():
    for lang in ("en", "hi", "te"):
        cards = acs.advisory_cards(
            _current(temp=44), _forecast(rains=(0, 62, 0), maxes=(40, 43, 41)),
            [_alert("ORANGE")], _verdict_confirmed("ORANGE"),
            persona="farmer", lang=lang)
        assert cards
        for c in cards:
            for field in ("title", "body", "valid_for"):
                text = c[field]
                assert "{" not in text and "}" not in text, f"{lang}/{c['id']}: {text}"
            for b in c["basis"]:
                assert "{" not in b and "}" not in b, f"{lang}/{c['id']}: {b}"
            assert c["title"].strip() and c["body"].strip()


def test_hindi_telugu_bodies_are_not_english():
    # Crude but effective: hi bodies must contain Devanagari, te bodies Telugu.
    cards_hi = acs.advisory_cards(_current(), _forecast(), [], {}, persona="farmer",
                                  lang="hi")
    assert any(re.search(r"[\u0900-\u097F]", c["body"]) for c in cards_hi)
    cards_te = acs.advisory_cards(_current(), _forecast(), [], {}, persona="farmer",
                                  lang="te")
    assert any(re.search(r"[\u0C00-\u0C7F]", c["body"]) for c in cards_te)
    # And no Tamil script anywhere, ever.
    for c in cards_hi + cards_te:
        assert not re.search(r"[\u0B80-\u0BFF]", c["title"] + c["body"])


# --- endpoint -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_cards_endpoint_wires_inputs(monkeypatch):
    import backend.api.advisory as advisory_ep
    import backend.api.weather as weather_mod
    import backend.config as config

    monkeypatch.setattr(config, "DEMO_MODE", False)

    async def fake_current(lat, lon):
        return ({"source": "Open-Meteo", "temperature": 44.0,
                 "rainfall": 0.0, "wind_speed": 12.0}, "LIVE")

    async def fake_forecast(lat, lon):
        return ({"source": "Open-Meteo", "days": [
            {"date": "2026-09-20", "rainfall": 0.0,
             "max_temperature": 44.0, "min_temperature": 28.0}]}, "LIVE")

    async def fake_warnings(district, lat=None, lon=None):
        return {"verdict": _verdict_confirmed("ORANGE"),
                "cap_alerts": [_alert("ORANGE")],
                "cap_provenance": "LIVE"}

    class FakeLoc:
        def resolve(self, lat, lon):
            return {"district": "Hyderabad"}

    monkeypatch.setattr(weather_mod, "_live_current", fake_current)
    monkeypatch.setattr(weather_mod, "_live_forecast", fake_forecast)
    monkeypatch.setattr(weather_mod, "warnings", fake_warnings)
    monkeypatch.setattr(advisory_ep, "LocationService", FakeLoc)

    out = await advisory_ep.advisory_cards_endpoint(lat=17.4, lon=78.5,
                                                    lang="en", persona="farmer")
    assert out["provenance"] == {"current": "LIVE", "forecast": "LIVE",
                                 "alerts": "LIVE"}
    kinds = [c["kind"] for c in out["cards"]]
    assert kinds[0] == "alert_safety"
    assert out["cards"][0]["severity_word"] == "ORANGE"
    assert len(out["cards"]) <= 4
    assert out["official_instruction"] is False
