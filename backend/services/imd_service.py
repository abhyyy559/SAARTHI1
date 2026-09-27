"""IMD adapter — the ONLY place that talks to IMD. Everything else uses normalized models.

Live contract (verified 2026-09-27 against IMD's logged-in API docs,
api.imd.gov.in/public/api_docs.php):
  base   https://api.imd.gov.in/api/v1
  auth   X-API-KEY: <key> + Authorization: Bearer <JWT> on EVERY call
  token  POST https://api.imd.gov.in/api/oauth/token.php {"email","password"}
         -> {"access_token": ..., "token_type": "Bearer", "expires_in": 3600}
  ids    every endpoint takes ?id=<IMD numeric station/district ID>
The API key is bound to the server IP registered on the portal: a dev key
bound to a laptop IP only answers from that IP. Field names below follow the
documented schema ("Temperature", "Day1_Color", ...); the old assumed names
("temp", ...) survive only as defensive fallbacks.
"""
import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx

from .. import config
from ..adapters.registry import OFFLINE, UNCONFIGURED, AdapterUnavailable, report
from ..models.weather import WeatherObservation, WeatherForecast, WeatherWarning
from ..utils.time import IST, now_ist
from . import district_demo
from .imd_mapping import get_resolver

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
               "no IMD_API_KEY — IMD is credential-gated; set IMD_API_KEY, "
               "IMD_API_EMAIL and IMD_API_PASSWORD to enable official data")
    else:
        report("imd", OFFLINE, f"live {what} failed: {type(exc).__name__}")


def _pick(raw: dict, *names):
    """First non-None value under any of the given field names. IMD's
    documented names come first; older assumed names trail as fallbacks."""
    for name in names:
        value = raw.get(name)
        if value is not None:
            return value
    return None


def _num(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _num_or_none(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None



# IMD day-color -> severity (documented: 1 Green, 2 Yellow, 3 Orange, 4 Red).
_IMD_COLOR_SEVERITY = {"1": "GREEN", "2": "YELLOW", "3": "ORANGE", "4": "RED"}

# IMD warning codes documented in the API reference; anything else is
# surfaced as its raw code, never invented.
_IMD_WARNING_CODES = {
    "2": "Heavy Rain",
    "4": "Thunderstorm & Lightning",
    "9": "Heat Wave",
}


def _day_window_ist(day) -> tuple[datetime, Optional[datetime]]:
    """Validity window for an IMD day-N warning: that calendar day in IST.
    Unparseable -> issued now, no claimed end (active=False)."""
    now = now_ist()
    if day:
        try:
            d = datetime.fromisoformat(str(day)).date()
            start = datetime(d.year, d.month, d.day, tzinfo=IST)
            return start, start + timedelta(days=1)
        except ValueError:
            pass
    return now, None


def _obs_time(raw: dict) -> Optional[datetime]:
    """Combine IMD's 'Date of Observation' + 'Time of Observation' (UTC)."""
    date = _pick(raw, "Date of Observation", "date", "obs_date")
    clock = _pick(raw, "Time of Observation", "time", "obs_time")
    if date and clock:
        try:
            return datetime.fromisoformat(
                f"{date}T{clock}+00:00").astimezone(IST)
        except ValueError:
            return None
    return _parse_ts(_pick(raw, "obs_time"))


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


def _relative_ts(hours_ago: int = 1, hours_ahead: int | None = None) -> Optional[datetime]:
    """Demo-mode timestamps relative to now → warnings always appear active (§51)."""
    base = datetime.now(IST) - timedelta(hours=hours_ago)
    if hours_ahead is not None:
        return base + timedelta(hours=hours_ago + hours_ahead)
    return base


class IMDService:
    def __init__(self, adapter: Optional[str] = None) -> None:
        # Single mode: the live adapter is the only one. Demo mode was removed.
        self.adapter = adapter or "live"
        self._jwt: Optional[str] = None
        self._jwt_expires_at: float = 0.0

    @property
    def capability(self) -> str:
        return "live" if self.adapter == "live" else "degraded"

    async def _jwt_token(self) -> str:
        """Mint (and cache) the IMD JWT.

        Cached until ~60s before expiry so a request burst mints once. The
        portal email+password come from IMD_API_EMAIL / IMD_API_PASSWORD.
        """
        if self._jwt and time.time() < self._jwt_expires_at - 60:
            return self._jwt
        if not (config.IMD_API_EMAIL and config.IMD_API_PASSWORD):
            raise AdapterUnavailable(
                "IMD JWT unavailable — set IMD_API_EMAIL and IMD_API_PASSWORD "
                "(the api.imd.gov.in portal login)")
        async with httpx.AsyncClient(timeout=config.IMD_TIMEOUT) as client:
            resp = await client.post(
                config.IMD_TOKEN_URL,
                json={"email": config.IMD_API_EMAIL,
                      "password": config.IMD_API_PASSWORD})
            resp.raise_for_status()
            data = resp.json()
        token = data.get("access_token")
        if not token:
            raise AdapterUnavailable(
                "IMD token endpoint returned no access_token: "
                f"{str(data)[:120]}")
        try:
            ttl = int(data.get("expires_in", 3600))
        except (TypeError, ValueError):
            ttl = 3600
        self._jwt = token
        self._jwt_expires_at = time.time() + ttl
        return token

    async def _live_id(self, kind: str, lat: Optional[float] = None,
                       lng: Optional[float] = None,
                       district: str | None = None) -> str:
        """Resolve an endpoint kind to an IMD numeric ID for any location.

        Order: IMD_STATION_IDS manual override -> IMD mapping tables
        (nearest station / district lookup) -> AdapterUnavailable (fail closed
        to Open-Meteo). IDs are never guessed.
        """
        return await get_resolver(self._jwt_token).resolve(
            kind, lat=lat, lng=lng, district=district)

    async def _get(self, path: str, imd_id: str) -> dict:
        """GET {base}/{path}?id=... with the documented dual-header auth.

        On a 401 the cached JWT is discarded, minted once more, and the
        request retried a single time. Failures propagate to the caller,
        which reports them via _report_failure — this helper never reports.
        """
        if not config.IMD_API_KEY:
            # Fail before any network: without a key the platform 401s however
            # healthy the network is, and the registry must say UNCONFIGURED.
            raise AdapterUnavailable("IMD live unavailable — set IMD_API_KEY")

        async def _once(jwt: str) -> httpx.Response:
            headers = {"X-API-KEY": config.IMD_API_KEY,
                       "Authorization": f"Bearer {jwt}"}
            async with httpx.AsyncClient(timeout=config.IMD_TIMEOUT) as client:
                return await client.get(f"{config.IMD_BASE_URL}/{path}",
                                        params={"id": imd_id}, headers=headers)

        resp = await _once(await self._jwt_token())
        if resp.status_code == 401:
            self._jwt = None  # force a fresh mint, then one retry
            resp = await _once(await self._jwt_token())
        resp.raise_for_status()
        return resp.json()

    async def get_current_weather(self, latitude: float, longitude: float,
                                district: str | None = None) -> WeatherObservation:
        """`district` picks the IMD station via IMD_STATION_IDS override or the
        mapping tables (live) or the demo preset table (demo). Live mode
        resolves the nearest IMD station from lat/lon via the mapping tables,
        so any Indian location works — not just hand-mapped districts."""
        if self.adapter == "demo":
            raw = _load_fixture("current_hyderabad.json")["raw"]
            preset = district_demo.demo_current(district)
            if preset:
                entry = district_demo.preset_for(district) or {}
                name = entry.get("district") or district
                raw = {**raw, "temp": preset["temp"], "humidity": preset["humidity"],
                       "rainfall": preset["rainfall"], "windspeed": preset["windspeed"],
                       "condition": preset["condition"], "district": name,
                       "station": name}
        else:
            try:
                raw = await self._get(config.IMD_PATH_CURRENT,
                                      await self._live_id("current", lat=latitude,
                                                          lng=longitude,
                                                          district=district))
            except Exception as exc:
                _report_failure("current_wx", exc)
                raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
        if self.adapter == "demo":
            observed_at = _relative_ts()
        else:
            observed_at = _obs_time(raw)
        return WeatherObservation(
            source="IMD",
            temperature=_num(_pick(raw, "Temperature", "temp")),
            humidity=_num(_pick(raw, "Humidity", "humidity")),
            rainfall=_num(_pick(raw, "Last 24 hrs Rainfall", "rainfall")),
            wind_speed=_num(_pick(raw, "Wind Speed", "windspeed")),
            condition=_pick(raw, "Weather", "Condition", "Weather Code", "condition"),
            observed_at=observed_at,
        )

    async def get_forecast(self, latitude: float, longitude: float,
                           district: str | None = None) -> WeatherForecast:
        if self.adapter == "demo":
            raw = _load_fixture("forecast_hyderabad.json")["raw"]
            preset_days = district_demo.demo_forecast(district)
            if preset_days:
                # Fresh dates: a fixed 2026-09-15 row would silently expire.
                entry = district_demo.preset_for(district) or {}
                name = entry.get("district") or district or raw.get("city")
                today = now_ist().date()
                raw = {**raw, "city": name, "forecast": [
                    {"date": (today + timedelta(days=i)).isoformat(),
                     "condition": d["condition"], "min": d["min"],
                     "max": d["max"], "rain": d["rain"]}
                    for i, d in enumerate(preset_days)
                ]}
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
            return WeatherForecast(
                source="IMD", location=raw.get("city"),
                issued_at=_relative_ts(), days=days)
        try:
            raw = await self._get(config.IMD_PATH_FORECAST,
                                  await self._live_id("forecast", lat=latitude,
                                                      lng=longitude,
                                                      district=district))
        except Exception as exc:
            _report_failure("cityforecast", exc)
            raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
        # Documented schema: Todays_Forecast_* then Day_2_* .. Day_7_*.
        # Day numbers are relative to fetch time, so dates are anchored today.
        today = now_ist().date()
        days = []
        for i in range(7):
            if i == 0:
                mx = _pick(raw, "Todays_Forecast_Max_Temp")
                mn = _pick(raw, "Todays_Forecast_Min_temp")
                cond = _pick(raw, "Todays_Forecast")
                rain = _pick(raw, "Past_24_hrs_Rainfall")
            else:
                n = i + 1
                mx = _pick(raw, f"Day_{n}_Max_Temp")
                mn = _pick(raw, f"Day_{n}_Min_Temp")
                cond = _pick(raw, f"Day_{n}_Forecast")
                rain = None
            days.append({
                "date": (today + timedelta(days=i)).isoformat(),
                "condition": cond,
                "min_temperature": _num_or_none(mn),
                "max_temperature": _num_or_none(mx),
                "rainfall": _num_or_none(rain),
            })
        return WeatherForecast(
            source="IMD",
            location=_pick(raw, "Station_Name", "city"),
            issued_at=_parse_ts(_pick(raw, "Issued", "issued_at", "Date")) or now_ist(),
            days=days)

    async def get_district_warning(self, district: str) -> WeatherWarning | None:
        if self.adapter == "demo":
            entry = district_demo.demo_warning(district)
            if entry is None:
                # Explicit calm preset (Chennai): the service answered and has
                # nothing to report — an honest all-clear, never a guess.
                return None
            if entry is district_demo.FALLBACK:
                raw = _load_fixture("warning_hyderabad.json")["raw"]
                # Demo fixtures are single-district samples: retarget the fixture to
                # the requested district so prototype testing works anywhere.
                # Provenance stays DEMO — never presented as a live IMD warning.
                raw = {**raw, "district": district}
            else:
                # Location-switcher preset: the district's own sample warning.
                # Severity comes from the fixed district_demo table only.
                raw = {"status": "ok", "district": district, "warnings": [{
                    "type": entry["type"], "severity": entry["severity"],
                    "message": entry["message"]}]}  # type: ignore[index]
        else:
            try:
                raw = await self._get(config.IMD_PATH_WARNING,
                                      await self._live_id("warning",
                                                          district=district))
            except Exception as exc:
                _report_failure("districtwarning", exc)
                raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
            # Documented schema: Day_1..Day_5 warning codes + Day1_Color..Day5_Color
            # (1 Green, 2 Yellow, 3 Orange, 4 Red). Green day-1 = all-clear.
            color = _pick(raw, "Day1_Color")
            code = _pick(raw, "Day_1")
            severity = _IMD_COLOR_SEVERITY.get(str(color)) if color is not None else None
            if severity == "GREEN":
                return None
            code_str = str(code) if code is not None else ""
            hazard = _IMD_WARNING_CODES.get(
                code_str, f"IMD warning code {code_str}" if code_str else "Unknown")
            severity = severity or "UNKNOWN"
            name = _pick(raw, "District") or district
            issued_at, valid_until = _day_window_ist(_pick(raw, "Date"))
            now = datetime.now(IST)
            active = bool(valid_until) and issued_at <= now <= valid_until
            return WeatherWarning(
                source="IMD",
                hazard=hazard,
                severity=severity,
                district=name,
                message=f"{hazard}: {severity} alert for {name} (IMD day-1 district warning)",
                issued_at=issued_at,
                valid_until=valid_until,
                verified=False,
                active=active,
            )
        warnings = raw.get("warnings") or []
        if not warnings:
            return None
        w = warnings[0]
        issued_at = _relative_ts(hours_ago=1)
        valid_until = _relative_ts(hours_ago=1, hours_ahead=4)
        now = datetime.now(IST)
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
            text = district_demo.demo_nowcast(district)
            if text is None:
                raw = _load_fixture("nowcast_hyderabad.json")["raw"]
                text = raw.get("nowcast", {}).get("phenomenon", "")
            return text
        else:
            try:
                raw = await self._get(config.IMD_PATH_NOWCAST,
                                      await self._live_id("nowcast",
                                                          district=district))
            except Exception as exc:
                _report_failure("nowcast", exc)
                raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
        # Documented schema carries a top-level "message" (plus color/Cat*
        # fields); fall back to the old assumed nesting defensively.
        text = _pick(raw, "message", "Message")
        if not text and isinstance(raw.get("nowcast"), dict):
            text = raw["nowcast"].get("phenomenon")
        return text or ""