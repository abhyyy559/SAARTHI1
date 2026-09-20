"""Validation engine tests (§12 / §50)."""
import sys, os, asyncio
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.services.imd_service import IMDService
from backend.services.validation_service import ValidationService
from backend.models.weather import WeatherWarning
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
imd = IMDService(adapter="demo")


def _warning(severity="YELLOW", hours_ago=1, valid_hours=4) -> WeatherWarning:
    now = datetime.now(IST)
    return WeatherWarning(source="IMD", hazard="Thunderstorm", severity=severity, district="Hyderabad",
                          message="Test.", issued_at=now - timedelta(hours=hours_ago),
                          valid_until=now + timedelta(hours=valid_hours) if valid_hours else None,
                          verified=False, active=False)


def test_valid_warning():
    w = _warning()
    v = ValidationService(imd)
    result = v.validate_warning(w, "Hyderabad")
    assert result.verified, f"FAIL: {result.validation}"
    assert result.severity == "YELLOW"
    print("PASS: test_valid_warning")


def test_expired_warning():
    w = _warning(hours_ago=10, valid_hours=-1)
    v = ValidationService(imd)
    result = v.validate_warning(w, "Hyderabad")
    assert not result.verified
    assert result.validation["validity"] == "FAIL"
    print("PASS: test_expired_warning")


def test_wrong_district():
    w = _warning()
    w.district = "Mumbai"
    v = ValidationService(imd)
    result = v.validate_warning(w, "Hyderabad")
    assert not result.verified
    assert result.validation["location"] == "FAIL"
    print("PASS: test_wrong_district")


def test_missing_timestamp():
    w = _warning()
    w.issued_at = None
    v = ValidationService(imd)
    result = v.validate_warning(w, "Hyderabad")
    assert result.validation["completeness"] == "FAIL" or not result.verified
    print("PASS: test_missing_timestamp")


def test_no_valid_until():
    w = _warning(valid_hours=None)
    v = ValidationService(imd)
    result = v.validate_warning(w, "Hyderabad")
    assert result.validation["validity"] == "UNKNOWN"
    print("PASS: test_no_valid_until")


def test_untrusted_source():
    w = _warning()
    w.source = "UNTRUSTED"
    v = ValidationService(imd)
    result = v.validate_warning(w, "Hyderabad")
    assert result.validation["source"] == "FAIL"
    print("PASS: test_untrusted_source")


def main():
    test_valid_warning()
    test_expired_warning()
    test_wrong_district()
    test_missing_timestamp()
    test_no_valid_until()
    test_untrusted_source()
    print("\nAll validation tests passed.")


if __name__ == "__main__":
    main()
