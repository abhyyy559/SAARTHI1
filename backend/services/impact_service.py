"""Route-aware impact analysis (§49 Phase 3): A -> B travel risk from timing + geography.

Samples origin, midpoint, destination: forecast rain + verified warnings at each,
worst-point-wins with explicit reason. Never declares a route safe — reports risk.
"""
from __future__ import annotations

from ..adapters import openmeteo_adapter
from ..adapters.registry import LIVE, AdapterUnavailable, report
from ..models.emergency import ImpactAssessment
from ..services.gis_service import haversine_km
from ..services.imd_service import IMDService
from ..services.location_service import LocationService
from ..services.risk_service import RiskService
from ..services.validation_service import ValidationService


async def analyze_route(lat1: float, lon1: float, lat2: float, lon2: float,
                        user_type: str = "driver") -> tuple[dict, str]:
    loc = LocationService()
    o, d = loc.resolve(lat1, lon1), loc.resolve(lat2, lon2)
    mid = {"latitude": (lat1 + lat2) / 2, "longitude": (lon1 + lon2) / 2}
    dist_km = round(haversine_km(lat1, lon1, lat2, lon2), 1)
    # GIS Job 3 "Hazard distance" just ran for real — refresh its source status.
    report("gis-hazard", LIVE, f"route distance {dist_km} km")

    points, provenances = [], set()
    for label, p in (("origin", {"latitude": lat1, "longitude": lon1}),
                     ("midpoint", mid), ("destination", {"latitude": lat2, "longitude": lon2})):
        rain, prov = None, "UNAVAILABLE"
        try:
            fc, lp = await openmeteo_adapter.get_forecast(p["latitude"], p["longitude"])
            days = fc.days
            rain = days[1].rainfall if len(days) > 1 else (days[0].rainfall if days else None)
            prov = lp
        except AdapterUnavailable:
            pass
        points.append({"point": label, "rain_day1_mm": rain, "provenance": prov})
        provenances.add(prov)

    worst = max([p["rain_day1_mm"] or 0 for p in points])
    if worst >= 25:
        level, reason = "HIGH", f"heavy rainfall ({worst} mm) on route"
    elif worst >= 5:
        level, reason = "MODERATE", f"rainfall ({worst} mm) on route"
    elif any(p["rain_day1_mm"] is None for p in points):
        level, reason = "UNKNOWN", "incomplete data on route — could not verify"
    else:
        level, reason = "LOW", "no significant rainfall on route"

    # Official warnings at origin/destination districts (best effort, never blocking)
    warn_notes = []
    official = False
    imd = IMDService()
    for label, plc in (("origin", o), ("destination", d)):
        try:
            w = await imd.get_district_warning(plc.get("district", ""))
            if w:
                v = ValidationService(imd).validate_warning(w, plc.get("district", ""))
                if v and v.verified:
                    warn_notes.append(f"{label}: {v.severity} {v.hazard}")
                    # Official severity maps onto the risk scale once, the same
                    # way the verdict does (RED -> CRITICAL ...). Assigning the
                    # colour itself left `level` = "RED", which the checks below
                    # did not recognise: a route with an official RED warning
                    # came back affected=False, "No weather blockers found".
                    # GREEN is not a hazard and never replaces UNKNOWN.
                    mapped = _OFFICIAL_LEVEL.get(str(v.severity or "").upper())
                    if mapped and _RANK(mapped) > _RANK(level):
                        level, reason = mapped, f"official {v.severity} warning at {label}"
                        official = True
        except AdapterUnavailable:
            warn_notes.append(f"{label}: warning data unavailable")

    affected = level in ("CRITICAL", "HIGH", "MODERATE")
    if not affected:
        advisory = "No weather blockers found; still verify before departure."
    elif official:
        advisory = ("An official warning is in force on this route; follow official "
                    "guidance and verify again before departure.")
    else:
        advisory = "Consider travelling before the heavy-rain period; verify again before departure."

    assessment = ImpactAssessment(
        hazard="Route weather", severity=",".join(n for n in warn_notes) or "none-verified",
        affected=affected, method="route",
        risk_level=level, reason=reason,
        advisory=advisory,
        provenance="LIVE" if provenances == {"LIVE"} else ("CACHED" if "LIVE" not in provenances and "CACHED" in provenances else "PARTIAL"),
    )
    return {
        "origin": {"city": o.get("city"), "district": o.get("district")},
        "destination": {"city": d.get("city"), "district": d.get("district")},
        "distance_km": dist_km, "points": points,
        "assessment": assessment.model_dump(mode="json"),
        "disclaimer": "Risk interpretation, not a safety guarantee. Verify before travelling.",
    }, assessment.provenance


# Official severity -> route risk level (same mapping as verdict_service).
_OFFICIAL_LEVEL = {"RED": "CRITICAL", "ORANGE": "HIGH", "YELLOW": "MODERATE"}


def _RANK(level: str) -> int:
    order = {"LOW": 0, "MODERATE": 1, "HIGH": 2, "CRITICAL": 3,
             "GREEN": 0, "YELLOW": 1, "ORANGE": 2, "RED": 3, "UNKNOWN": -1}
    return order.get((level or "").upper(), -1)
