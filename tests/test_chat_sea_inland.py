"""Sea-question inland lead: a sea/sailing question asked from an inland
district must lead with the no-coast fact, not an unrelated warning."""
from backend.api.chat import _ensure_sea_lead

_HYD = {"city": "Hyderabad", "district": "Hyderabad", "state": "Telangana", "coastal": False}
_MUM = {"city": "Mumbai", "district": "Mumbai", "state": "Maharashtra", "coastal": True}
_BASE = "There is an active official warning for Hyderabad: YELLOW — Thunderstorm."


def test_sea_question_inland_gets_lead():
    out = _ensure_sea_lead("is it safe to go to sea", _HYD, _BASE, "en")
    assert out.startswith("Hyderabad is not a coastal district")


def test_sea_question_coastal_no_lead():
    out = _ensure_sea_lead("is it safe to go to sea", _MUM, _BASE, "en")
    assert out == _BASE


def test_sea_question_unknown_coastal_no_lead():
    out = _ensure_sea_lead("is it safe to go to sea", {"district": "X"}, _BASE, "en")
    assert out == _BASE


def test_non_sea_question_no_lead():
    out = _ensure_sea_lead("will it rain tomorrow", _HYD, _BASE, "en")
    assert out == _BASE


def test_sea_lead_hindi():
    out = _ensure_sea_lead("samudra me jana surakshit hai", _HYD, _BASE, "hi")
    assert "तटीय जिला नहीं" in out


def test_sea_lead_telugu():
    out = _ensure_sea_lead("is it safe to go to sea", _HYD, _BASE, "te")
    assert "తీర ప్రాంత జిల్లా కాదు" in out


def test_sea_lead_exactly_once():
    once = _ensure_sea_lead("is it safe to go to sea", _HYD, _BASE, "en")
    twice = _ensure_sea_lead("is it safe to go to sea", _HYD, once, "en")
    assert twice == once
