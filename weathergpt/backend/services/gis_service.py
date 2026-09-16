"""GIS service — point-in-polygon / circle intersection for warning relevance (§35).

Pure functions, no external deps: CAP polygon strings ("lat,lon lat,lon ...") and
CAP circles ("lat,lon radiusKm") are tested against user coordinates. District
name match remains a fallback; geometry wins when present.
"""
from __future__ import annotations

import math


def parse_polygon(text: str | None) -> list[tuple[float, float]]:
    """CAP polygon: space/comma separated 'lat,lon' pairs -> [(lat, lon)]."""
    pts: list[tuple[float, float]] = []
    if not text:
        return pts
    # CAP polygon is "lat,lon lat,lon ..." — split on whitespace first
    for pair in str(text).split():
        parts = pair.split(",")
        if len(parts) != 2:
            continue
        try:
            pts.append((float(parts[0]), float(parts[1])))
        except ValueError:
            continue
    return pts


def point_in_polygon(lat: float, lon: float, polygon: list[tuple[float, float]]) -> bool:
    """Ray-casting on (lat=y, lon=x). Closed implicitly. Degenerate -> False."""
    if len(polygon) < 3:
        return False
    inside = False
    n = len(polygon)
    x, y = lon, lat
    for i in range(n):
        y1, x1 = polygon[i][0], polygon[i][1]
        y2, x2 = polygon[(i + 1) % n][0], polygon[(i + 1) % n][1]
        if (y1 > y) != (y2 > y):
            xinters = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < xinters:
                inside = not inside
    return inside


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def parse_circle(text: str | None) -> tuple[float, float, float] | None:
    """CAP circle: 'lat,lon radiusKm' -> (lat, lon, radius_km)."""
    if not text:
        return None
    parts = str(text).strip().split()
    if len(parts) != 2:
        return None
    try:
        lat_s, lon_s = parts[0].split(",")
        return float(lat_s), float(lon_s), float(parts[1])
    except ValueError:
        return None


def warning_relevant(alert: dict, latitude: float | None, longitude: float | None, district: str) -> dict:
    """Decide relevance: geometry intersection first, district-name fallback.

    Returns {relevant: bool, method: 'polygon'|'circle'|'district'|'none'}.
    """
    district_hit = bool(district) and district.lower() in str(alert.get("area", "")).lower()
    if latitude is None or longitude is None:
        return {"relevant": district_hit, "method": "district" if district_hit else "none"}
    poly = parse_polygon(alert.get("polygon"))
    if poly and point_in_polygon(latitude, longitude, poly):
        return {"relevant": True, "method": "polygon"}
    circ = parse_circle(alert.get("circle"))
    if circ and haversine_km(latitude, longitude, circ[0], circ[1]) <= circ[2]:
        return {"relevant": True, "method": "circle"}
    if poly or circ:
        return {"relevant": False, "method": "polygon" if poly else "circle"}
    return {"relevant": district_hit, "method": "district" if district_hit else "none"}
