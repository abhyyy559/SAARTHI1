"""Per-district DEMO fixtures for the location-switcher live demo.

Demo mode used to serve the same Hyderabad thunderstorm sample to every
district, retargeted by name. For the "different places, different alerts"
stage demo, the location-switcher presets each get a distinct, visibly
labelled sample set:

  Visakhapatnam      ORANGE cyclone + heavy rain
  Mumbai Suburban    YELLOW thunderstorm
  Chennai            calm — no sample alerts, an honest all-clear
  Medchal Malkajgiri the existing Hyderabad demo set, retargeted by name

Unknown districts fall back to the pre-existing generic fixture path (the
Hyderabad sample retargeted), exactly as before — no invented severities.

Every value here is SAMPLE DATA. Provenance stays DEMO end to end, and the
frontend's sample-data banner (already shown on every warning-like screen in
demo mode) keeps the fixtures visibly labelled.

Eval-compliance note (saarthi-eval-compliance.md section 5, rules 2-3):
severities come only from the fixed PRESETS table below — the code never
invents one at request time, and an absent alert is reported as absent
(Chennai returns no alerts), never as a guessed all-clear.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from ..utils.time import now_ist


def _ts(hours_ahead: float = 0.0, hours_ago: float = 0.0) -> str:
    """Relative ISO timestamp with IST offset — fixtures stay fresh whatever
    day the demo runs (a fixed 2026-09-15 date would silently expire)."""
    return (now_ist() + timedelta(hours=hours_ahead, minutes=0)
            - timedelta(hours=hours_ago)).isoformat()


def _cap(*, event: str, cap_severity: str, area: str,
         headline: str, description: str, instruction: str) -> dict[str, Any]:
    """One raw CAP-fixture-shaped alert, matching demo/fixtures/cap_alert.json
    so cap_adapter._normalize accepts it unchanged."""
    return {
        "event": event,
        "severity": cap_severity,  # CAP vocabulary: Minor/Moderate/Severe/Extreme
        "areaDesc": area,
        "headline": headline,
        "description": description,
        "instruction": instruction,
        "sent": _ts(hours_ago=1),
        "expires": _ts(hours_ahead=5),
        "demo": True,  # explicit fixture marker, alongside the DEMO provenance
    }


# --------------------------------------------------------------------------
# The fixed preset table. Keys are normalised district names.
# --------------------------------------------------------------------------
PRESETS: dict[str, dict[str, Any]] = {
    "visakhapatnam": {
        "district": "Visakhapatnam",
        "state": "Andhra Pradesh",
        "lat": 17.6868,
        "lon": 83.2185,
        "current": {"temp": 29, "humidity": 90, "rainfall": 58,
                    "windspeed": 48, "condition": "Heavy rain"},
        "forecast": [
            {"condition": "Heavy rain", "min": 26, "max": 30, "rain": 60},
            {"condition": "Very heavy rain", "min": 25, "max": 29, "rain": 110},
            {"condition": "Rain", "min": 26, "max": 30, "rain": 35},
        ],
        "warning": {
            "type": "Cyclone",
            "severity": "ORANGE",
            "message": ("Cyclonic storm over the Bay of Bengal moving towards "
                        "the Andhra Pradesh coast. Heavy to very heavy rainfall "
                        "with gusty winds likely over Visakhapatnam district. "
                        "Fishermen are advised not to venture into the sea."),
        },
        "cap_alerts": [
            _cap(
                event="Cyclone",
                cap_severity="Severe",
                area="Visakhapatnam district, Andhra Pradesh",
                headline="Cyclone alert: heavy rainfall with gusty winds likely along the coast",
                description=("Cyclonic storm over the Bay of Bengal is likely to cross "
                              "the coast near Visakhapatnam. Heavy to very heavy rainfall "
                              "with gusty winds reaching 60-70 kmph likely over "
                              "Visakhapatnam district."),
                instruction=("Fishermen: do not venture into the sea. Coastal residents: "
                             "stay away from the shoreline and follow official evacuation "
                             "instructions if issued."),
            ),
            _cap(
                event="Heavy rain",
                cap_severity="Severe",
                area="Visakhapatnam district, Andhra Pradesh",
                headline="Very heavy rainfall warning for Visakhapatnam district",
                description=("Very heavy rainfall very likely at isolated places over "
                              "Visakhapatnam district. Waterlogging likely on low-lying "
                              "roads."),
                instruction=("Avoid travel through waterlogged areas. Keep away from "
                             "vulnerable structures and follow local authority guidance."),
            ),
        ],
        "nowcast": ("Cyclonic circulation over the Bay of Bengal. Heavy to very "
                    "heavy rainfall with gusty winds likely along the coast during "
                    "the next 6 hours. Fishermen are advised not to venture into "
                    "the sea."),
    },
    "mumbai suburban": {
        "district": "Mumbai Suburban",
        "state": "Maharashtra",
        "lat": 19.09,
        "lon": 72.8656,
        "current": {"temp": 27, "humidity": 92, "rainfall": 22,
                    "windspeed": 18, "condition": "Rain"},
        "forecast": [
            {"condition": "Rain", "min": 25, "max": 29, "rain": 28},
            {"condition": "Thunderstorm", "min": 25, "max": 30, "rain": 15},
            {"condition": "Cloudy", "min": 26, "max": 31, "rain": 5},
        ],
        "warning": {
            "type": "Thunderstorm",
            "severity": "YELLOW",
            "message": ("Thunderstorm with lightning and moderate rainfall likely "
                        "at isolated places over Mumbai Suburban district. "
                        "Commuters: expect waterlogging on low-lying roads."),
        },
        "cap_alerts": [
            _cap(
                event="Thunderstorm",
                cap_severity="Moderate",
                area="Mumbai Suburban district, Maharashtra",
                headline="Thunderstorm with lightning likely at isolated places",
                description=("Thunderstorm with lightning and moderate rainfall likely "
                              "at isolated places over Mumbai Suburban district."),
                instruction=("Avoid exposed areas during the storm. Commuters: allow "
                             "extra travel time; avoid waterlogged underpasses."),
            ),
        ],
        "nowcast": ("Thunderstorm with lightning and moderate rainfall likely at "
                    "isolated places during the next 3 hours."),
    },
    "chennai": {
        "district": "Chennai",
        "state": "Tamil Nadu",
        "lat": 13.0827,
        "lon": 80.2707,
        "current": {"temp": 31, "humidity": 68, "rainfall": 0,
                    "windspeed": 10, "condition": "Clear"},
        "forecast": [
            {"condition": "Clear", "min": 27, "max": 33, "rain": 0},
            {"condition": "Partly cloudy", "min": 27, "max": 33, "rain": 0},
            {"condition": "Clear", "min": 27, "max": 34, "rain": 0},
        ],
        # Calm on purpose: NO sample warning and NO sample alerts. The API
        # reports an answered-but-empty check (honest all-clear), never a
        # guessed one.
        "warning": None,
        "cap_alerts": [],
        "nowcast": ("Mainly clear sky. No significant weather expected over "
                    "Chennai district in the next 6 hours."),
    },
}

# Display names + coordinates for the frontend location switcher. Medchal
# Malkajgiri deliberately has no registry entry: it uses the pre-existing
# generic fixture path (the Hyderabad thunderstorm sample, retargeted by name)
# — "the existing demo set".
PRESET_ORDER = (
    "Hyderabad",
    "Medchal Malkajgiri",
    "Visakhapatnam",
    "Mumbai Suburban",
    "Chennai",
)

PRESET_COORDS: dict[str, dict[str, float]] = {
    "Hyderabad": {"lat": 17.385, "lon": 78.4867},
    "Medchal Malkajgiri": {"lat": 17.52, "lon": 78.53},
    "Visakhapatnam": {"lat": 17.6868, "lon": 83.2185},
    "Mumbai Suburban": {"lat": 19.09, "lon": 72.8656},
    "Chennai": {"lat": 13.0827, "lon": 80.2707},
}


def normalize(district: str | None) -> str:
    """Normalise a district name for registry lookup."""
    return " ".join(str(district or "").strip().lower().split())


def preset_for(district: str | None) -> dict[str, Any] | None:
    """Return the preset entry for a district, or None when the district has
    no registry entry (Hyderabad / Medchal Malkajgiri / unknown names fall back
    to the pre-existing generic fixture path)."""
    return PRESETS.get(normalize(district))


# The sentinel is defined up here so every accessor below can reference it.
FALLBACK = object()
"""Sentinel: no registry entry — use the pre-existing generic fixture path."""


def demo_warning(district: str | None) -> dict[str, Any] | None | object:
    """IMD-demo warning entry for a district.

    Returns the preset's warning dict, None for an explicit calm preset
    (Chennai — the service answered, nothing to report), or the FALLBACK
    sentinel for districts served by the pre-existing generic fixture path.
    """
    entry = preset_for(district)
    if entry is None:
        return FALLBACK
    return entry["warning"]


def demo_current(district: str | None) -> dict[str, Any] | None:
    """Raw current-weather values for a preset district, or None to use the
    pre-existing fixture."""
    entry = preset_for(district)
    return dict(entry["current"]) if entry else None


def demo_forecast(district: str | None) -> list[dict[str, Any]] | None:
    """Raw 3-day forecast rows for a preset district, or None to use the
    pre-existing fixture."""
    entry = preset_for(district)
    return [dict(d) for d in entry["forecast"]] if entry else None


def demo_nowcast(district: str | None) -> str | None:
    """Nowcast text for a preset district, or None to use the pre-existing
    fixture."""
    entry = preset_for(district)
    return entry["nowcast"] if entry else None


def demo_cap_alerts(district: str | None) -> list[dict[str, Any]] | None:
    """Raw CAP-fixture-shaped alerts for a preset district, or None to use
    the pre-existing generic fixture path. An empty list is a real answer
    (Chennai: calm), not a missing one."""
    entry = preset_for(district)
    if entry is None:
        return None
    return [dict(a) for a in entry["cap_alerts"]]
