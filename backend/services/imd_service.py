"""IMD adapter — the ONLY place that talks to IMD. Everything else uses normalized models."""
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx

from .. import config
from ..adapters.registry import OFFLINE, UNCONFIGURED, AdapterUnavailable, report
from ..models.weather import WeatherObservation, WeatherForecast, WeatherWarning
from ..utils.time import IST, now_ist
from . import district_demo

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
    elif not config.IMD_JWT and not (config.IMD_API_EMAIL and config.IMD_API_PASSWORD):
        report("imd", UNCONFIGURED,
               "IMD_API_KEY present but no usable JWT — paste IMD_JWT or set "
               "IMD_API_EMAIL/PASSWORD for auto-mint")
    else:
        # A real rejection (wrong IP, expired token, outage): surface the
        # gateway's own reason — e.g. "IP address X not authorized" — so
        # /api/sources names the fix instead of a bare exception type.
        detail = f"live {what} failed: {type(exc).__name__}"
        try:
            body = (getattr(getattr(exc, "response", None), "text", "") or "").strip()
        except Exception:  # noqa: BLE001 - error body is best-effort
            body = ""
        if body:
            detail += f" — {body[:100]}"
        report("imd", OFFLINE, detail)


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


# --- Real api.imd.gov.in response handling -----------------------------------
# Reference: https://api.imd.gov.in/public/api_reference.html. Field casing
# varies by endpoint ("District" vs "DISTRICT"), so every lookup is
# case-insensitive. IMD_FIELD_MAP (config) is applied first so a renamed
# field on key day is a .env line, not a code edit.

def _norm_row(row: dict) -> dict:
    """Lower-cased key view of one response row (values untouched)."""
    out = {}
    for k, v in (row or {}).items():
        out[str(k).strip().lower()] = v
    if config.IMD_FIELD_MAP:
        for ours, theirs in config.IMD_FIELD_MAP.items():
            if theirs in row:
                out[str(ours).strip().lower()] = row[theirs]
    return out


_ROW_KEYS = frozenset({
    "district", "station", "station_name", "obj_id", "objid", "id",
    "temperature", "todays_forecast_max_temp", "day_1", "day1_color",
    "message", "date of observation", "date",
})


def _as_rows(payload) -> list[dict]:
    """The list endpoints return a bare JSON list; some wrap it in {"data": [...]}.

    A bare single-row dict (no "data", no legacy envelope) is wrapped as one
    row instead of being misread as "unreadable".
    """
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        data = payload.get("data", payload.get("Data"))
        if isinstance(data, list):
            return [r for r in data if isinstance(r, dict)]
        lowered = {str(k).strip().lower() for k in payload}
        if lowered & _ROW_KEYS:
            return [payload]
    return []


def _match_row(rows: list[dict], district: str, *fields: str) -> Optional[dict]:
    """Find the row naming this district (exact, case-insensitive, via aliases)."""
    from .district_service import aliases_for
    wanted = {district.strip().lower()}
    try:
        wanted |= {a.strip().lower() for a in aliases_for(district)}
    except Exception:  # noqa: BLE001 - gazetteer must never break a live call
        pass
    for row in rows:
        norm = _norm_row(row)
        for f in fields:
            if str(norm.get(f) or "").strip().lower() in wanted:
                return row
    return None


def _num(value) -> Optional[float]:
    try:
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


# districtwarning warning-code → hazard wording (official reference table).
_WARNING_CODE_TEXT = {
    "1": "No Warning", "2": "Heavy Rain", "3": "Heavy Snow",
    "4": "Thunderstorm & Lightning, Squall etc", "5": "Hailstorm",
    "6": "Dust Storm", "7": "Dust Raising Winds", "8": "Strong Surface Winds",
    "9": "Heat Wave", "10": "Hot Day", "11": "Warm Night", "12": "Cold Wave",
    "13": "Cold Day", "14": "Ground Frost", "15": "Fog",
    "16": "Very Heavy Rain", "17": "Extremely Heavy Rain",
}

# districtwarning DayN_Color → severity (reference: 1 Red, 2 Orange, 3 Yellow, 4 Green).
_WARNING_COLOR_SEV = {"1": "RED", "2": "ORANGE", "3": "YELLOW", "4": "GREEN"}

def _nearest_row(rows: list[dict], latitude: float, longitude: float) -> Optional[dict]:
    """Nearest response row by degree distance, when rows carry coordinates."""
    import math
    best, best_d = None, None
    for row in rows:
        norm = _norm_row(row)
        lat = _num(norm.get("latitude", norm.get("lat")))
        lon = _num(norm.get("longitude", norm.get("lon", norm.get("lng"))))
        if lat is None or lon is None:
            continue
        d = math.hypot(lat - latitude, lon - longitude)
        if best_d is None or d < best_d:
            best, best_d = row, d
    return best


def _live_current_row(payload, latitude: float, longitude: float) -> dict:
    """Normalize one real current_wx row to the observation vocabulary.

    Row shape (official reference): {Station, Date of Observation, Time of
    Observation (UTC), Temperature, Humidity, Wind Speed (KMPH), Last 24 hrs
    Rainfall, Weather Code, ...}. Raises AdapterUnavailable when no row can
    be matched — the hybrid chain then falls through to Open-Meteo, and imd
    mode honestly reports UNAVAILABLE.
    """
    rows = _as_rows(payload)
    if not rows:
        raise AdapterUnavailable("IMD current_wx: unreadable response shape")
    row = _nearest_row(rows, latitude, longitude)
    if row is None:
        raise AdapterUnavailable("IMD current_wx: no station coordinates to match")
    norm = _norm_row(row)
    date = str(norm.get("date of observation", norm.get("date")) or "").strip()
    hhmm = "".join(ch for ch in str(norm.get("time of observation", norm.get("time")) or "") if ch.isdigit())
    if len(hhmm) >= 4:
        obs_time = f"{date}T{hhmm[:2]}:{hhmm[2:4]}:00+00:00" if date else None
    else:
        obs_time = f"{date}T00:00:00+00:00" if date else None
    if obs_time is None:
        # observed_at is required — a row without any timestamp still
        # describes the latest observation, so stamp the fetch time.
        obs_time = now_ist().isoformat()
    return {
        "temp": _num(norm.get("temperature", norm.get("temp"))) or 0,
        "humidity": _num(norm.get("humidity")) or 0,
        "rainfall": _num(norm.get("last 24 hrs rainfall", norm.get("rainfall"))) or 0,
        "windspeed": _num(norm.get("wind speed", norm.get("windspeed"))) or 0,
        "condition": _condition_for_wx(norm.get("weather code", norm.get("weather_code"))) or norm.get("condition"),
        "district": str(norm.get("station") or ""),
        "station": str(norm.get("station") or ""),
        "obs_time": obs_time,
    }


def _live_forecast_doc(payload, latitude: float, longitude: float) -> dict:
    """Normalize one real cityforecastloc row to the forecast vocabulary.

    Row shape (official reference): {Station_Name, Date, Todays_Forecast…,
    Day_2_… … Day_7_…, Latitude, Longitude}. Raises AdapterUnavailable when
    no station can be matched.
    """
    rows = _as_rows(payload)
    if not rows:
        raise AdapterUnavailable("IMD cityforecastloc: unreadable response shape")
    row = _nearest_row(rows, latitude, longitude)
    if row is None:
        raise AdapterUnavailable("IMD cityforecastloc: no station coordinates to match")
    norm = _norm_row(row)
    today = now_ist().date()
    days = []

    def _day(i: int, max_k: str, min_k: str, cond_k: str) -> dict:
        return {
            "date": (today + timedelta(days=i)).isoformat(),
            "condition": str(norm.get(cond_k) or "").strip() or None,
            "min": _num(norm.get(min_k)),
            "max": _num(norm.get(max_k)),
            "rain": None,
        }

    days.append(_day(0, "todays_forecast_max_temp", "todays_forecast_min_temp", "todays_forecast"))
    for i in range(2, 8):
        days.append(_day(i - 1, f"day_{i}_max_temp", f"day_{i}_min_temp", f"day_{i}_forecast"))
    rain = _num(norm.get("past_24_hrs_rainfall"))
    return {
        "city": str(norm.get("station_name", norm.get("station")) or ""),
        # The feed carries no issue timestamp: the honest value is when WE
        # fetched it (required field — None would crash validation).
        "issued_at": now_ist().isoformat(),
        "forecast": days,
        "past_rain": rain,
    }


# WMO weather-code → plain condition for current_wx.
def _condition_for_wx(code) -> Optional[str]:
    try:
        n = int(float(str(code)))
    except (TypeError, ValueError):
        return None
    if n in (17, 29) or 91 <= n <= 99:
        return "Thunderstorm"
    if n in (20, 21, 23, 24, 25, 27, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59,
             60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 80, 81, 82, 83, 84):
        return "Rain"
    if n in (22, 26, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 85, 86, 87, 88, 89, 90):
        return "Snow"
    if n in (10, 11, 12, 28, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49):
        return "Fog"
    if n in (6, 7, 8, 9, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39):
        return "Duststorm"
    if n in (13, 14, 15, 16, 18, 19):
        return "Cloudy"
    return "Clear"


def _live_warning_for_district(payload, district: str) -> Optional["WeatherWarning"]:
    """Build a WeatherWarning from a real districtwarning response.

    Row shape (official reference): {Obj_id, District, Date, UTC, Day_1..Day_5
    (comma-separated warning codes), Day1_Color..Day5_Color (1 Red … 4 Green)}.
    Day_1 is today's warning. All-"1" (No Warning) or no row → None: the
    service answered and has nothing to report — an honest all-clear input,
    never a guess. Raises AdapterUnavailable only when the payload itself is
    unreadable (a shape change), so the caller reports UNAVAILABLE, not calm.
    """
    rows = _as_rows(payload)
    if not rows:
        raise AdapterUnavailable("IMD districtwarning: unreadable response shape")
    row = _match_row(rows, district, "district")
    if row is None:
        return None
    norm = _norm_row(row)
    codes = [c.strip() for c in str(norm.get("day_1") or "").split(",") if c.strip()]
    live_codes = [c for c in codes if c != "1"]
    if not live_codes:
        return None
    severity = _WARNING_COLOR_SEV.get(str(norm.get("day1_color") or "").strip(), "UNKNOWN")
    hazards = [_WARNING_CODE_TEXT.get(c, f"Warning {c}") for c in live_codes]
    # First code names the hazard; Thunderstorm wording matches the verdict
    # engine's hazard vocabulary, the rest ride along in the message.
    hazard = hazards[0]
    for keyword in ("Thunderstorm", "Rain", "Heat Wave", "Cold Wave", "Fog",
                    "Hailstorm", "Dust Storm", "Snow", "Frost", "Winds"):
        if any(keyword.lower() in h.lower() for h in hazards):
            hazard = keyword
            break
    issued_raw = str(norm.get("date") or "").strip()
    utc_raw = "".join(ch for ch in str(norm.get("utc") or "") if ch.isdigit())
    issued = None
    if issued_raw and len(utc_raw) >= 4:
        # The feed stamps issue time in UTC ("Time of Issue in UTC", HHmm):
        # keep it UTC-aware so freshness math downstream is exact. (The
        # validator reads naive stamps as UTC but this service reads them as
        # IST — a 5.5h skew that could flunk a same-day warning.)
        try:
            from datetime import timezone as _tz
            issued = datetime.strptime(
                f"{issued_raw} {utc_raw[:2]}:{utc_raw[2:4]}", "%Y-%m-%d %H:%M"
            ).replace(tzinfo=_tz.utc)
        except ValueError:
            issued = None
    if issued is None:
        issued = _parse_ts(issued_raw) if issued_raw else None
    now = datetime.now(IST)
    issued_at = _aware(issued) or now
    # Day_1 covers the issue date: valid until the same time next day.
    valid_until = issued_at + timedelta(days=1)
    active = issued_at <= now <= valid_until
    message = "; ".join(hazards) + f" — IMD district warning for {norm.get('district') or district} (Day 1, issued {issued_raw or 'today'})."
    return WeatherWarning(
        source="IMD",
        hazard=hazard,
        severity=severity,
        district=str(norm.get("district") or district),
        message=message,
        issued_at=issued_at,
        valid_until=valid_until,
        verified=False,
        active=active,
    )


# --- JWT lifecycle (official portal flow) ------------------------------------
# The JWT expires hourly, so a pasted IMD_JWT dies mid-demo. With portal
# credentials configured the adapter mints its own token (55-min TTL) and
# re-mints once on an "invalid/expired JWT" 401 before giving up. Explicit
# IMD_JWT always wins (a fresh paste beats the cache, no restart needed).
_JWT_TTL = 55 * 60
_jwt_cache: dict = {"token": None, "at": 0.0}


def _jwt_cached() -> Optional[str]:
    import time
    tok, at = _jwt_cache.get("token"), _jwt_cache.get("at", 0.0)
    if tok and (time.monotonic() - at) < _JWT_TTL:
        return tok
    return None


def _jwt_store(token: str) -> None:
    import time
    _jwt_cache["token"] = token
    _jwt_cache["at"] = time.monotonic()


async def _mint_jwt() -> str:
    """POST the portal oauth endpoint with the account credentials."""
    if not config.IMD_API_EMAIL or not config.IMD_API_PASSWORD:
        raise AdapterUnavailable("no portal credentials (IMD_API_EMAIL/PASSWORD) to mint JWT")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                config.IMD_TOKEN_URL or "https://api.imd.gov.in/api/oauth/token.php",
                json={"email": config.IMD_API_EMAIL, "password": config.IMD_API_PASSWORD},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise AdapterUnavailable(f"JWT mint failed: {type(exc).__name__}") from exc
    token = (data or {}).get("access_token") or (data or {}).get("token") or ""
    if not token:
        raise AdapterUnavailable("JWT mint returned no access_token")
    _jwt_store(token)
    return token


async def _resolve_jwt() -> str:
    """Explicit paste wins; else fresh cache; else mint from credentials."""
    if config.IMD_JWT:
        return config.IMD_JWT
    cached = _jwt_cached()
    if cached:
        return cached
    return await _mint_jwt()


class IMDService:
    def __init__(self, adapter: Optional[str] = None) -> None:
        self.adapter = adapter or config.IMD_ADAPTER

    @property
    def capability(self) -> str:
        return "live" if self.adapter == "live" else "degraded"

    async def _get(self, path: str, params: dict | None = None):
        """GET one api.imd.gov.in endpoint with the dual-credential headers.

        The gateway needs BOTH `x-api-key: <IMD_API_KEY>` and
        `Authorization: Bearer <IMD_JWT>` (proven by live probing). Either one
        missing is a certain 401, so fail fast as UNCONFIGURED with a message
        naming the missing piece instead of spending the round trip.
        """
        if not config.IMD_ENABLED:
            raise AdapterUnavailable("IMD disabled (IMD_ENABLED=false) — using other sources")
        if not config.IMD_API_KEY:
            _report_failure(path, AdapterUnavailable("no IMD_API_KEY"))
            raise AdapterUnavailable("IMD live unreachable: no IMD_API_KEY")
        try:
            jwt = await _resolve_jwt()
        except AdapterUnavailable as exc:
            if not config.IMD_JWT and not (config.IMD_API_EMAIL and config.IMD_API_PASSWORD):
                report("imd", UNCONFIGURED,
                       "IMD_API_KEY present but no usable JWT — paste IMD_JWT or "
                       "set IMD_API_EMAIL/PASSWORD for auto-mint")
            else:
                # Credentials exist but minting failed (network down, bad
                # password): that is an outage, not a setup gap.
                _report_failure(path, exc)
            raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
        scheme = (config.IMD_AUTH_SCHEME or "bearer").strip().lower()
        headers: dict = {"Authorization": f"Bearer {jwt}"}
        query = dict(params or {})
        if scheme == "query":
            query[config.IMD_AUTH_PARAM or "api_key"] = config.IMD_API_KEY
        elif scheme == "header":
            headers[config.IMD_AUTH_HEADER or "Authorization"] = config.IMD_API_KEY
        else:  # bearer (default): key rides x-api-key, JWT rides Bearer
            headers["x-api-key"] = config.IMD_API_KEY
        url = f"{config.IMD_BASE_URL}/{path}"
        timeout = config.IMD_TIMEOUT or 10.0
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url, params=query, headers=headers)
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as exc:
            # Expired/revoked JWT mid-hour: one re-mint + one retry, but only
            # when auto-mint is configured (a paste has nothing to refresh
            # from — retrying it would loop the same 401).
            body = ""
            try:
                body = (exc.response.text or "")[:80]
            except Exception:  # noqa: BLE001 - error body is best-effort
                pass
            if ("invalid" in body.lower() or "expired" in body.lower()
                    or exc.response.status_code == 401) and not config.IMD_JWT:
                _jwt_cache["token"] = None
                try:
                    fresh = await _mint_jwt()
                except AdapterUnavailable:
                    raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
                headers["Authorization"] = f"Bearer {fresh}"
                try:
                    async with httpx.AsyncClient(timeout=timeout) as client:
                        resp = await client.get(url, params=query, headers=headers)
                        resp.raise_for_status()
                        return resp.json()
                except Exception as exc2:
                    _report_failure(path, exc2)
                    raise AdapterUnavailable(f"IMD live unreachable: {exc2}") from exc2
            _report_failure(path, exc)
            raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
        except Exception as exc:
            _report_failure(path, exc)
            raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc

    async def get_current_weather(self, latitude: float, longitude: float,
                                district: str | None = None) -> WeatherObservation:
        """`district` is demo-only: the location switcher names the district so
        each preset gets its own sample weather (Visakhapatnam rain, Chennai
        clear). Live mode ignores it — real coords, real station."""
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
                # Bare call: the real endpoint filters by `?id=` (station id);
                # without a station table, match the nearest station locally
                # when the rows carry coordinates.
                raw = await self._get(config.IMD_PATH_CURRENT, None)
            except AdapterUnavailable:
                raise  # _get already reported precisely; don't overwrite it
            except Exception as exc:
                _report_failure("current_wx", exc)
                raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
            if not isinstance(raw, dict) or "temp" not in _norm_row(raw):
                raw = _live_current_row(raw, latitude, longitude)
        return WeatherObservation(
            source="IMD",
            temperature=float(raw.get("temp") or 0),
            humidity=float(raw.get("humidity") or 0),
            rainfall=float(raw.get("rainfall") or 0),
            wind_speed=float(raw.get("windspeed") or 0),
            condition=raw.get("condition"),
            observed_at=_parse_ts(raw.get("obs_time")) if self.adapter == "live" else _relative_ts(),
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
        else:
            try:
                # Bare call, nearest station matched locally (rows carry
                # Latitude/Longitude per the official reference).
                raw = await self._get(config.IMD_PATH_FORECAST, None)
            except AdapterUnavailable:
                raise  # _get already reported precisely; don't overwrite it
            except Exception as exc:
                _report_failure("cityforecast", exc)
                raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
            if not isinstance(raw, dict) or "forecast" not in _norm_row(raw):
                raw = _live_forecast_doc(raw, latitude, longitude)
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
            legacy = raw.get("warnings") or []
        else:
            try:
                # The real endpoint filters by numeric `?id=` (Obj_id), not by
                # name — so fetch the full district list once and match the
                # district locally (no static id table to go stale).
                raw = await self._get(config.IMD_PATH_WARNING, None)
            except AdapterUnavailable:
                raise  # _get already reported precisely; don't overwrite it
            except Exception as exc:
                _report_failure("districtwarning", exc)
                raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
            legacy = raw.get("warnings") if isinstance(raw, dict) else None
            if legacy is None:
                # Real api.imd.gov.in shape (or unreadable → raises, so the
                # caller reports UNAVAILABLE rather than inventing calm).
                return _live_warning_for_district(raw, district)
        warnings = legacy or []
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
            text = district_demo.demo_nowcast(district)
            if text is None:
                raw = _load_fixture("nowcast_hyderabad.json")["raw"]
                text = raw.get("nowcast", {}).get("phenomenon", "")
            return text
        else:
            try:
                # Like districtwarning: the real endpoint filters by numeric
                # `?id=`, so fetch the full list and match the station locally.
                raw = await self._get(config.IMD_PATH_NOWCAST, None)
            except AdapterUnavailable:
                raise  # _get already reported precisely; don't overwrite it
            except Exception as exc:
                _report_failure("districtnowcast", exc)
                raise AdapterUnavailable(f"IMD live unreachable: {exc}") from exc
            if isinstance(raw, dict) and "nowcast" in raw:
                return raw.get("nowcast", {}).get("phenomenon", "")
            rows = _as_rows(raw)
            if not rows:
                raise AdapterUnavailable("IMD districtnowcast: unreadable response shape")
            row = _match_row(rows, district, "station", "district")
            if row is None:
                return ""
            norm = _norm_row(row)
            # The consolidated message is the warning; Cat16 carries a free-text
            # "other warning" that outranks bare category flags.
            message = str(norm.get("message") or "").strip()
            if message:
                return message
            cat16 = str(norm.get("cat16") or "").strip()
            if cat16 and cat16 != "1":
                return cat16
            cats = [k for k, v in norm.items()
                    if k.startswith("cat") and str(v).strip() not in ("", "1")]
            if not cats:
                return ""
            return "Nowcast active: " + ", ".join(sorted(cats))