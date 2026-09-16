"""Validation engine — source / freshness / location / time / completeness."""
from datetime import datetime, timedelta, timezone
from .imd_service import IMDService
from ..models.weather import WeatherObservation, WeatherForecast, WeatherWarning, VerifiedEvent
from ..utils.time import IST

TRUSTED_SOURCES = {"IMD"}

# Freshness: different products, different thresholds (§12)
FRESHNESS_LIMITS = {
    "current": timedelta(minutes=30),
    "forecast": timedelta(hours=6),
    "warning": timedelta(hours=12),
}


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class ValidationService:
    def __init__(self, imd: IMDService, now: datetime | None = None) -> None:
        self.imd = imd
        self.now = now if now is not None and now.tzinfo is not None else datetime.now(IST)

    def _source(self, src: str) -> str:
        return "PASS" if src in TRUSTED_SOURCES else "FAIL"

    def _freshness(self, observed_at: datetime, kind: str) -> str:
        observed = _aware(observed_at)
        return "PASS" if observed and (self.now - observed) <= FRESHNESS_LIMITS[kind] else "FAIL"

    def _location(self, warning_district: str, requested_district: str) -> str:
        return "PASS" if warning_district.lower() == requested_district.lower() else "FAIL"

    def _validity(self, warning: WeatherWarning) -> str:
        issued = _aware(warning.issued_at)
        until = _aware(warning.valid_until)
        if until is None:
            return "UNKNOWN"
        return "PASS" if issued and issued <= self.now <= until else "FAIL"

    def _completeness(self, warning: WeatherWarning) -> str:
        required = [warning.hazard, warning.severity, warning.district]
        return "PASS" if all(required) else "FAIL"

    def validate_warning(self, warning: WeatherWarning, requested_district: str) -> VerifiedEvent:
        source = self._source(warning.source)
        freshness = self._freshness(warning.issued_at, "warning")
        location = self._location(warning.district, requested_district)
        validity = self._validity(warning)
        completeness = self._completeness(warning)

        active = (
            source == "PASS"
            and freshness == "PASS"
            and location == "PASS"
            and validity == "PASS"
            and completeness == "PASS"
        )
        verified = active

        return VerifiedEvent(
            verified=verified,
            hazard=warning.hazard,
            severity=warning.severity,
            location=warning.district,
            valid_from=warning.issued_at,
            valid_until=warning.valid_until,
            source=warning.source,
            source_timestamp=warning.issued_at,
            message=warning.message,
            validation={
                "source": source,
                "freshness": freshness,
                "location": location,
                "validity": validity,
                "completeness": completeness,
            },
        )