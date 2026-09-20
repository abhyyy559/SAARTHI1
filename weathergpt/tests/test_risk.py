"""Risk engine tests (§14)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from backend.services.risk_service import RiskService

svc = RiskService()


def test_no_warning():
    r = svc.risk({"severity": "GREEN", "hazard": None}, "general")
    assert r["level"] == "LOW", f"FAIL: {r}"
    print("PASS: test_no_warning")


def test_yellow_general():
    r = svc.risk({"severity": "YELLOW", "hazard": "Thunderstorm"}, "general")
    assert r["level"] == "MODERATE", f"FAIL: {r}"
    print("PASS: test_yellow_general")


def test_orange_farmer():
    r = svc.risk({"severity": "ORANGE", "hazard": "Heavy Rain"}, "farmer")
    assert r["level"] == "HIGH", f"FAIL: {r}"
    print("PASS: test_orange_farmer")


def test_red_fisherman():
    r = svc.risk({"severity": "RED", "hazard": "Cyclone"}, "fisherman")
    assert r["level"] == "CRITICAL", f"FAIL: {r}"
    print("PASS: test_red_fisherman")


def test_orange_general_minimum_high():
    r = svc.risk({"severity": "ORANGE", "hazard": "Heavy Rain"}, "general")
    assert r["level"] == "HIGH", f"FAIL: {r}"
    print("PASS: test_orange_general_minimum_high")


def test_red_any_persona_is_critical():
    r = svc.risk({"severity": "RED", "hazard": "Cyclone"}, "general")
    assert r["level"] == "CRITICAL", f"FAIL: {r}"
    print("PASS: test_red_any_persona_is_critical")


def test_official_severity_never_mutated():
    r = svc.risk({"severity": "YELLOW", "hazard": "Rain"}, "driver")
    assert r["official_severity"] == "YELLOW"
    assert r["source"] == "WEATHERGPT"
    print("PASS: test_official_severity_never_mutated")


def main():
    test_no_warning()
    test_yellow_general()
    test_orange_farmer()
    test_red_fisherman()
    test_orange_general_minimum_high()
    test_red_any_persona_is_critical()
    test_official_severity_never_mutated()
    print("\nAll risk tests passed.")


if __name__ == "__main__":
    main()
