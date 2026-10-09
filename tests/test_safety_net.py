"""Response-validator tests (§43 rules)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest  # noqa: E402

from backend.services import response_validator as rv  # noqa: E402


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
