"""Pydantic models — language-neutral, machine-readable severity."""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


class Location(BaseModel):
    latitude: float
    longitude: float
    city: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None


class WeatherObservation(BaseModel):
    source: str = "IMD"
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    rainfall: Optional[float] = None
    wind_speed: Optional[float] = None
    condition: Optional[str] = None
    observed_at: datetime


class ForecastDay(BaseModel):
    date: Optional[str] = None
    condition: Optional[str] = None
    min_temperature: Optional[float] = None
    max_temperature: Optional[float] = None
    rainfall: Optional[float] = None


class WeatherForecast(BaseModel):
    source: str = "IMD"
    location: Optional[str] = None
    issued_at: datetime
    days: list[ForecastDay] = Field(default_factory=list)


class WeatherWarning(BaseModel):
    source: str = "IMD"
    hazard: str
    severity: str  # GREEN|YELLOW|ORANGE|RED — never translated in storage
    district: str
    message: str = ""
    issued_at: datetime
    valid_until: Optional[datetime] = None
    verified: bool = False
    active: bool = False


class VerifiedEvent(BaseModel):
    verified: bool
    hazard: str = ""
    severity: str = ""
    location: str = ""
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    source: str = "IMD"
    source_timestamp: Optional[datetime] = None
    message: str = ""
    validation: dict[str, str] = Field(default_factory=dict)
    recommended_action: Optional[str] = None


class NormalizedWeather(BaseModel):
    source: str = "IMD"
    location: Location
    observed_at: datetime
    current: dict[str, Any] = Field(default_factory=dict)
    forecast: dict[str, Any] = Field(default_factory=dict)
    warning: dict[str, Any] = Field(default_factory=dict)
