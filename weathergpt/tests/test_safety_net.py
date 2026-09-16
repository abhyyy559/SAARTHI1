"""Response-validator, reports and RAG tests (§43 rules, §34 labelling, §37 retrieval)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.services import response_validator as rv  # noqa: E402
from backend.services import report_service, rag_service  # noqa: E402

YELLOW = {"verified": True, "severity": "YELLOW", "hazard": "Thunderstorm", "valid_until": "2030-01-01"}


import re as _re


def test_no_escalation():
    ans, findings = rv.validate("YELLOW thunderstorm warning is active.", YELLOW, [15.0])
    assert findings == [], findings
    ans2, f2 = rv.validate("RED alert issued for your area!", YELLOW, [15.0])
    assert f2 and "escalation" in f2[0] and not _re.search(r"\bRED\b", ans2), (ans2, f2)
    print("PASS: test_no_escalation")


def test_no_invented_probability_or_claim():
    _, f = rv.validate("There is a 72% chance of rain.", {"verified": False, "severity": "GREEN"}, [15.0, 28.0])
    assert any("probability" in x for x in f), f
    _, f2 = rv.validate("IMD has issued a cyclone warning.", {"verified": False, "severity": "GREEN"}, [])
    assert any("unverified" in x for x in f2), f2
    print("PASS: test_no_invented_probability_or_claim")


def test_reports_never_official():
    rep = report_service.submit("flooding", 17.4, 78.5, "Hyderabad", "waterlogging")
    assert rep.status == "COMMUNITY" and rep.provenance == "USER-REPORT"
    try:
        report_service.submit("alien_invasion", 0, 0)
        raise SystemExit("FAIL: invalid type accepted")
    except ValueError:
        pass
    print("PASS: test_reports_never_official")


def test_rag_retrieval():
    hits = rag_service.retrieve("thunderstorm safety lightning", "en")
    assert hits and hits[0]["id"] == "thunder-en", hits
    hits_te = rag_service.retrieve("వరద సహాయం", "te")
    assert hits_te and hits_te[0]["hazard"] == "flood", hits_te
    assert rag_service.retrieve("quantum chromodynamics", "en") == []
    print("PASS: test_rag_retrieval")


if __name__ == "__main__":
    test_no_escalation()
    test_no_invented_probability_or_claim()
    test_reports_never_official()
    test_rag_retrieval()
    print("\nAll validator/report/RAG tests passed.")
