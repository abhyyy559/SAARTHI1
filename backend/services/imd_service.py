"""IMD adapter — the ONLY place that talks to IMD. Everything else uses normalized models."""
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx

from .. import config
from ..adapters.registry import OFFLINE, UNCONFIGURED, AdapterUnavailable, report
from ..models.weather import WeatherObservation, WeatherForecast, WeatherWarning
from ..utils.time import IST

_FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent / "demo" / "fixtures"


def _report_failure(what: str, exc: Exception) -> None:
    """Report an IMD call failure with its true cause.

    Without IMD_API_KEY the IMD platform is credential-gated: it answers 401/400
    however healthy the network is. Reporting OFFLINE there told the sources
    panel "IMD is down" when the truth is "IMD was never keyed" — and because
    runtime reports take precedence over the registry's baseline, it also
    overwrote the registry's own correct UNCONFIGURED entry. A missing credential
    is not an outage, and the two need different fixes.
    """
    if not config.IMD_API_KEY:
        report("imd", UNCONFIGURED,
               "no IMD_API_KEY — IMD is credential-gated; set IMD_ADAPTER=demo for fixture warnings")
    else:
        report("imd", OFFLINE, f"live {what} failed: {type(exc).__name__}")


def _load_fixture(name: str) -> dict:
    with open(_FIXTURE_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    """Naive datetimes are IMD-local (IST); make everything comparable."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=IST)


def _relative_ts(hours_ago: int = 1, hours_ahead: int | None = None) -> Optional[datetime]:
    """Demo-mode timestamps relative to now → warnings always appear active (§51)."""
    base = datetime.now(IST) - timedelta(hours=hours_ago)
    if hours_ahead is not None:
        return base + timedelta(hours=hours_ago + hours_ahead)
    return base


class IMDService:
    def __init__(self, adapter: Optional[str] = None) -> None:
        self.adapter = adapter or config.IMD_ADAPTER

    @property
    def capability(self) -> str:
        return "live" if self.adapter == "live" else "degraded"

    async def _get(self, path: str, params: dict | None = None) -> dict:
        headers = {"Authorization": f"Bearer {config.IMD_API_KEY}"} if config.IMD_API_KEY else {}
        url = f"{config.IMD_BASE_URL}/{path}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            return resp.json()

    async def get_current_weather(self, latitude: float, longitude: float) -> WeatherObservation:
        if self.adapter == "demo":
            raw = _load_fixture("current_hyderabad.json")["raw"]
        else:
            try:
                raw = await self._get(config.IMD_PATH_CURRENT, {"lat": latitude, "lng": longitude, "station": "Hyderabad"})
            except Exception as exc:
                _report_failure("current_wx", exc)
                raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
        return WeatherObservation(
            source="IMD",
            temperature=float(raw.get("temp") or 0),
            humidity=float(raw.get("humidity") or 0),
            rainfall=float(raw.get("rainfall") or 0),
            wind_speed=float(raw.get("windspeed") or 0),
            condition=raw.get("condition"),
            observed_at=_parse_ts(raw.get("obs_time")) if self.adapter == "live" else _relative_ts(),
        )

    async def get_forecast(self, latitude: float, longitude: float) -> WeatherForecast:
        if self.adapter == "demo":
            raw = _load_fixture("forecast_hyderabad.json")["raw"]
        else:
            try:
                raw = await self._get(config.IMD_PATH_FORECAST, {"lat": latitude, "lng": longitude, "city": "Hyderabad"})
            except Exception as exc:
                _report_failure("cityforecast", exc)
                raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
        days = [
            {
                "date": d.get("date"),
                "condition": d.get("condition"),
                "min_temperature": d.get("min"),
                "max_temperature": d.get("max"),
                "rainfall": d.get("rain"),
            }
            for d in raw.get("forecast", [])
        ]
        return WeatherForecast(source="IMD", location=raw.get("city"), issued_at=_parse_ts(raw.get("issued_at")) if self.adapter == "live" else _relative_ts(), days=days)

    async def get_district_warning(self, district: str) -> WeatherWarning | None:
        if self.adapter == "demo":
            raw = _load_fixture("warning_hyderabad.json")["raw"]
            # Demo fixtures are single-district samples: retarget the fixture to
            # the requested district so prototype testing works anywhere.
            # Provenance stays DEMO — never presented as a live IMD warning.
            raw = {**raw, "district": district}
        else:
            try:
                raw = await self._get(config.IMD_PATH_WARNING, {"district": district})
            except Exception as exc:
                _report_failure("districtwarning", exc)
                raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
        warnings = raw.get("warnings") or []
        if not warnings:
            return None
        w = warnings[0]
        if self.adapter == "demo":
            issued = _relative_ts(hours_ago=1)
            valid_until = _relative_ts(hours_ago=1, hours_ahead=4)
        else:
            issued = _parse_ts(w.get("issued_at"))
            valid_until = _parse_ts(w.get("valid_until"))
        now = datetime.now(IST)
        issued_at = _aware(issued) or now
        valid_until = _aware(valid_until)
        # Validity-window based, like the chat path: the same fixture must not
        # report active=false here while /api/chat reports active=true from its
        # verified flag (validation_service._validity uses this same window).
        active = bool(valid_until) and issued_at <= now <= valid_until
        return WeatherWarning(
            source="IMD",
            hazard=w.get("type") or "Unknown",
            severity=(w.get("severity") or "UNKNOWN").upper(),
            district=raw.get("district") or district,
            message=w.get("message") or "",
            issued_at=issued_at,
            valid_until=valid_until,
            verified=False,
            active=active,
        )

    async def get_district_nowcast(self, district: str) -> str:
        if self.adapter == "demo":
            raw = _load_fixture("nowcast_hyderabad.json")["raw"]
        else:
            try:
                raw = await self._get(config.IMD_PATH_NOWCAST, {"district": district})
            except Exception as exc:
                _report_failure("districtnowcast", exc)
                raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
        return raw.get("nowcast", {}).get("phenomenon", "")