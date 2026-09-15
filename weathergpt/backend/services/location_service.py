"""Location resolution — nearest known district; manual search fallback."""
from .. import config as cfg

# Minimal local gazetteer for demo; extend with real service later.
GAZETTEER = [
    {"city": "Hyderabad", "district": "Hyderabad", "state": "Telangana", "latitude": 17.385, "longitude": 78.4867},
    {"city": "Warangal", "district": "Warangal", "state": "Telangana", "latitude": 18.0, "longitude": 79.58},
    {"city": "Nizamabad", "district": "Nizamabad", "state": "Telangana", "latitude": 18.67, "longitude": 78.09},
    {"city": "Mumbai", "district": "Mumbai", "state": "Maharashtra", "latitude": 19.076, "longitude": 72.8777},
    {"city": "Delhi", "district": "New Delhi", "state": "Delhi", "latitude": 28.6139, "longitude": 77.209},
    {"city": "Bengaluru", "district": "Bengaluru Urban", "state": "Karnataka", "latitude": 12.9716, "longitude": 77.5946},
    {"city": "Chennai", "district": "Chennai", "state": "Tamil Nadu", "latitude": 13.0827, "longitude": 80.2707},
]


class LocationService:
    def resolve(self, latitude: float | None, longitude: float | None, query: str = "") -> dict:
        if query:
            q = query.strip().lower()
            for entry in GAZETTEER:
                if q in entry["city"].lower() or q in entry["district"].lower():
                    return dict(entry)
        lat = latitude if latitude is not None else cfg.DEFAULT_LAT
        lon = longitude if longitude is not None else cfg.DEFAULT_LON
        entry = min(GAZETTEER, key=lambda e: ((e["latitude"] - lat) ** 2 + (e["longitude"] - lon) ** 2))
        return dict(entry)

    def search(self, query: str) -> list[dict]:
        q = query.strip().lower()
        matched = [dict(e) for e in GAZETTEER if q in e["city"].lower() or q in e["district"].lower() or q in e["state"].lower()]
        return matched[:8]