"""Dynamic advisory re-evaluation tests: diff_cards / evaluate_change /
snapshot_inputs.

Pinned behaviours (extends test_advisory_cards.py; same honesty rules):

1. Forecast flipping 20mm -> >=50mm rain yields NEW heavy-rain cards that
   notify, with the >=50mm value cited in the basis.
2. Calm -> calm re-evaluation notifies nothing.
3. Official-grade escalation (YELLOW -> RED) is detected on a stable card id;
   UNKNOWN severity never escalates; downgrades neither escalate nor notify.
4. Missing-data snapshots never crash.
5. diff summary lines exist in en/hi/te.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.services import advisory_cards_service as acs  # noqa: E402


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


def _snap(rains, **kw):
    return acs.snapshot_inputs(_current(), _forecast(rains=rains), [], {},
                               **kw)


def _card(cid, kind="agriculture", title="T", sev="info"):
    return {"id": cid, "kind": kind, "title": title, "body": "b",
            "basis": [], "severity_word": sev, "valid_for": "v"}


# --- the headline scenario: 20mm -> 55mm --------------------------------------
def test_rain_flip_20_to_55_notifies_heavy_cards_with_citation():
    out = acs.evaluate_change(_snap((0, 20, 0)), _snap((0, 55, 0)),
                              persona="general", lang="en")
    notify_ids = {n["card_id"] for n in out["notify"]}
    assert notify_ids == {"agri-rain-heavy", "commute-heavy"}, notify_ids
    added_ids = {c["id"] for c in out["changes"]["added"]}
    assert {"agri-rain-heavy", "commute-heavy"} <= added_ids
    removed_ids = {c["id"] for c in out["changes"]["removed"]}
    assert {"agri-rain-hold", "commute-wet"} <= removed_ids
    for n in out["notify"]:
        assert set(n) == {"card_id", "kind", "title", "body",
                          "severity_word", "basis"}
        # The >=50mm value must be cited in the basis with named provenance.
        joined = " ".join(n["basis"])
        assert "55mm" in joined, joined
        assert "Open-Meteo" in joined, joined
        assert any(p in joined for p in ("LIVE", "CACHED", "DEMO")), joined
        # No invented severity on rule cards.
        assert n["severity_word"] == "info"


def test_rain_flip_notify_is_trilingual_and_honest():
    for lang, script in (("hi", r"[\u0900-\u097F]"), ("te", r"[\u0C00-\u0C7F]")):
        out = acs.evaluate_change(_snap((0, 20, 0)), _snap((0, 55, 0)),
                                  persona="general", lang=lang)
        assert {n["card_id"] for n in out["notify"]} == {
            "agri-rain-heavy", "commute-heavy"}
        for n in out["notify"]:
            assert re.search(script, n["title"]), f"{lang}: {n['title']}"
            # Numbers stay Latin digits; no Tamil script anywhere.
            blob = n["title"] + n["body"] + " ".join(n["basis"])
            assert not re.search(r"[\u0B80-\u0BFF]", blob)


def test_calm_to_calm_reevaluation_notifies_nothing():
    snap = _snap((0, 20, 0))
    out = acs.evaluate_change(snap, _snap((0, 20, 0)),
                              persona="general", lang="en")
    assert out["notify"] == []
    assert out["changes"]["added"] == []
    assert out["changes"]["removed"] == []
    assert out["changes"]["escalated"] == []
    assert len(out["cards"]) <= 4


def test_identical_snapshots_produce_empty_changes():
    snap = _snap((0, 62, 0))
    out = acs.evaluate_change(snap, _snap((0, 62, 0)), persona="farmer")
    assert out["notify"] == []
    for key in ("added", "removed", "escalated"):
        assert out["changes"][key] == [], key


# --- escalation / downgrade / UNKNOWN -----------------------------------------
def test_escalation_yellow_to_red_detected_on_stable_id():
    prev = acs.snapshot_inputs(_current(), _forecast(), [_alert("YELLOW")],
                               _verdict_confirmed("YELLOW"))
    cur = acs.snapshot_inputs(_current(), _forecast(), [_alert("RED", "IN-ID-1")],
                              _verdict_confirmed("RED"))
    out = acs.evaluate_change(prev, cur, persona="general", lang="en")
    esc = out["changes"]["escalated"]
    assert len(esc) == 1
    assert esc[0]["id"] == "alert-0"
    assert esc[0]["signal"] == "severity"
    assert esc[0]["old_severity_word"] == "YELLOW"
    assert esc[0]["new_severity_word"] == "RED"
    # The official grade was carried verbatim, not invented by the diff.
    new_alert = [c for c in out["cards"] if c["id"] == "alert-0"][0]
    assert new_alert["severity_word"] == "RED"
    # Summary line exists in all three languages.
    for lang in ("en", "hi", "te"):
        lines = out["changes"]["summary"][lang]
        assert any("YELLOW" in s and "RED" in s for s in lines), (lang, lines)


def test_downgrade_produces_no_notify_and_no_escalation():
    prev = acs.snapshot_inputs(_current(), _forecast(), [_alert("RED")],
                               _verdict_confirmed("RED"))
    cur = acs.snapshot_inputs(_current(), _forecast(), [_alert("YELLOW")],
                              _verdict_confirmed("YELLOW"))
    out = acs.evaluate_change(prev, cur, persona="general", lang="en")
    assert out["notify"] == []
    assert out["changes"]["escalated"] == []
    assert out["changes"]["added"] == []
    assert out["changes"]["removed"] == []


def test_unknown_severity_never_escalates():
    prev = acs.snapshot_inputs(_current(), _forecast(), [_alert("UNKNOWN")],
                               _verdict_confirmed("UNKNOWN"))
    cur = acs.snapshot_inputs(_current(), _forecast(), [_alert("RED", "IN-ID-1")],
                              _verdict_confirmed("RED"))
    out = acs.evaluate_change(prev, cur, persona="general", lang="en")
    assert out["changes"]["escalated"] == []
    # UNKNOWN -> UNKNOWN is not an escalation either.
    cur2 = acs.snapshot_inputs(_current(), _forecast(), [_alert("UNKNOWN")],
                               _verdict_confirmed("UNKNOWN"))
    out2 = acs.evaluate_change(prev, cur2, persona="general", lang="en")
    assert out2["changes"]["escalated"] == []
    assert out2["notify"] == []


def test_numeric_escalation_same_card_id_no_repeat_notify():
    # 55mm -> 80mm: same heavy-rain card cites a worse number -> escalated,
    # but the 50mm threshold was already crossed, so no second notification.
    out = acs.evaluate_change(_snap((0, 55, 0)), _snap((0, 80, 0)),
                              persona="general", lang="en")
    esc = {e["id"]: e for e in out["changes"]["escalated"]}
    assert esc["agri-rain-heavy"]["signal"] == "rain"
    assert esc["agri-rain-heavy"]["old_rain_mm"] == 55.0
    assert esc["agri-rain-heavy"]["new_rain_mm"] == 80.0
    assert out["notify"] == []


# --- missing data ---------------------------------------------------------------
def test_missing_data_snapshots_dont_crash():
    out = acs.evaluate_change(acs.snapshot_inputs(), acs.snapshot_inputs(),
                              persona="general", lang="en")
    assert out["notify"] == []
    assert out["changes"]["added"] == []
    assert out["cards"], "unavailable cards must still be produced"
    # Raw (unwrapped) input bundles are tolerated too.
    out2 = acs.evaluate_change(None, {"current": None, "forecast": None},
                               persona="general")
    assert out2["notify"] == []


def test_no_data_to_heavy_rain_notifies():
    prev = acs.snapshot_inputs()
    cur = acs.snapshot_inputs(_current(), _forecast(rains=(0, 62, 0)), [], {})
    out = acs.evaluate_change(prev, cur, persona="general", lang="en")
    notify_ids = {n["card_id"] for n in out["notify"]}
    assert {"agri-rain-heavy", "commute-heavy"} <= notify_ids


# --- diff primitives ---------------------------------------------------------------
def test_diff_added_removed():
    d = acs.diff_cards([_card("a", title="Same"), _card("gone", title="Old title")],
                       [_card("a", title="Same"), _card("b", title="New title")])
    assert [c["id"] for c in d["added"]] == ["b"]
    assert [c["id"] for c in d["removed"]] == ["gone"]
    assert d["escalated"] == []
    assert set(d["summary"]) == {"en", "hi", "te"}
    assert any("New title" in s for s in d["summary"]["en"])
    assert any("Old title" in s for s in d["summary"]["en"])


def test_diff_empty_inputs():
    d = acs.diff_cards(None, None)
    assert d["added"] == [] and d["removed"] == [] and d["escalated"] == []
    assert set(d["summary"]) == {"en", "hi", "te"}


def test_new_red_alert_card_notifies():
    prev = acs.snapshot_inputs(_current(), _forecast(), [], {})
    cur = acs.snapshot_inputs(_current(), _forecast(), [_alert("RED")],
                              _verdict_confirmed("RED"))
    out = acs.evaluate_change(prev, cur, persona="general", lang="en")
    notified = {n["card_id"] for n in out["notify"]}
    assert "alert-0" in notified
    item = [n for n in out["notify"] if n["card_id"] == "alert-0"][0]
    assert item["severity_word"] == "RED"
    assert item["kind"] == "alert_safety"
    assert any("RED" in b for b in item["basis"])


# --- snapshot + summary ---------------------------------------------------------------
def test_snapshot_inputs_shape():
    snap = acs.snapshot_inputs(_current(), _forecast(), [_alert()],
                               _verdict_confirmed(),
                               current_prov="LIVE", forecast_prov="CACHED",
                               alerts_prov="DEMO")
    assert snap["ts"]  # timestamp present
    assert snap["provenance"] == {"current": "LIVE", "forecast": "CACHED",
                                  "alerts": "DEMO"}
    assert snap["current"]["temperature"] == 31
    assert len(snap["forecast"]["days"]) == 3


def test_trilingual_summary_keys_and_templates():
    d = acs.diff_cards([_card("old", title="Old title")],
                       [_card("new", title="New title")])
    assert set(d["summary"]) == {"en", "hi", "te"}
    for lang in ("en", "hi", "te"):
        lines = d["summary"][lang]
        assert len(lines) == 2, (lang, lines)  # one added + one removed
        assert all(isinstance(s, str) and s.strip() for s in lines)
        assert "{" not in "".join(lines) and "}" not in "".join(lines)
    # The diff templates themselves keep en/hi/te parity.
    per = acs.template_langs()
    for key in ("diff_added", "diff_removed", "diff_escalated_sev",
                "diff_escalated_rain"):
        assert key in per["en"] and key in per["hi"] and key in per["te"], key
