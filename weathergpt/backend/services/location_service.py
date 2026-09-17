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
    {"city": "Visakhapatnam", "district": "Visakhapatnam", "state": "Andhra Pradesh", "latitude": 17.6868, "longitude": 83.2185},
    {"city": "Kakinada", "district": "Kakinada", "state": "Andhra Pradesh", "latitude": 16.9891, "longitude": 82.2475},
    {"city": "Machilipatnam", "district": "Krishna", "state": "Andhra Pradesh", "latitude": 16.1873, "longitude": 81.1389},
    {"city": "Nellore", "district": "Nellore", "state": "Andhra Pradesh", "latitude": 14.4426, "longitude": 79.9865},
    {"city": "Kochi", "district": "Kerala", "state": "Kerala", "latitude": 9.9312, "longitude": 76.2673},
    {"city": "Panaji", "district": "North Goa", "state": "Goa", "latitude": 15.4909, "longitude": 73.8278},
    {"city": "Veraval", "district": "Gir Somnath", "state": "Gujarat", "latitude": 20.9067, "longitude": 70.3683},
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