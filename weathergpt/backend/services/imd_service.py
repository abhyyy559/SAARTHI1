"""IMD adapter — the ONLY place that talks to IMD. Everything else uses normalized models."""
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx

from .. import config
from ..models.weather import WeatherObservation, WeatherForecast, WeatherWarning

_FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent / "demo" / "fixtures"


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
                raw = await self._get("current_wx", {"lat": latitude, "lng": longitude, "station": "Hyderabad"})
            except Exception:
                raw = _load_fixture("current_hyderabad.json")["raw"]
        return WeatherObservation(
            source="IMD",
            temperature=float(raw.get("temp") or 0),
            humidity=float(raw.get("humidity") or 0),
            rainfall=float(raw.get("rainfall") or 0),
            wind_speed=float(raw.get("windspeed") or 0),
            condition=raw.get("condition"),
            observed_at=_parse_ts(raw.get("obs_time")) or datetime.now(),
        )

    async def get_forecast(self, latitude: float, longitude: float) -> WeatherForecast:
        if self.adapter == "demo":
            raw = _load_fixture("forecast_hyderabad.json")["raw"]
        else:
            try:
                raw = await self._get("cityforecastloc", {"lat": latitude, "lng": longitude, "city": "Hyderabad"})
            except Exception:
                raw = _load_fixture("forecast_hyderabad.json")["raw"]
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
        return WeatherForecast(source="IMD", location=raw.get("city"), issued_at=_parse_ts(raw.get("issued_at")) or datetime.now(), days=days)

    async def get_district_warning(self, district: str) -> WeatherWarning | None:
        if self.adapter == "demo":
            raw = _load_fixture("warning_hyderabad.json")["raw"]
        else:
            try:
                raw = await self._get("districtwarning", {"district": district})
            except Exception:
                raw = _load_fixture("warning_hyderabad.json")["raw"]
        warnings = raw.get("warnings") or []
        if not warnings:
            return None
        w = warnings[0]
        return WeatherWarning(
            source="IMD",
            hazard=w.get("type") or "Unknown",
            severity=(w.get("severity") or "GREEN").upper(),
            district=raw.get("district") or district,
            message=w.get("message") or "",
            issued_at=_parse_ts(w.get("issued_at")) or datetime.now(),
            valid_until=_parse_ts(w.get("valid_until")),
            verified=False,
            active=False,
        )

    async def get_district_nowcast(self, district: str) -> str:
        if self.adapter == "demo":
            raw = _load_fixture("nowcast_hyderabad.json")["raw"]
        else:
            try:
                raw = await self._get("districtnowcast", {"district": district})
            except Exception:
                raw = _load_fixture("nowcast_hyderabad.json")["raw"]
        return raw.get("nowcast", {}).get("phenomenon", "")