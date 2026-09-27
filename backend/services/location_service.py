"""Location resolution — nearest known district via GIS haversine; manual search
fallback with typo tolerance. Users mistype district names constantly (voice
transcription garbles them even more), so the resolver treats "vizag", "Mumbay"
or "Hydrbadd" as what they are: Visakhapatnam, Mumbai, Hyderabad.
"""
import math
from difflib import SequenceMatcher

from .. import config as cfg
from ..adapters.registry import LIVE, report
from . import district_service
from .district_service import norm_name
from .gis_service import haversine_km

# One normalizer for the whole system (see `district_service.norm_name`): the
# resolver and the alert matcher must agree on what counts as the same place, or
# a user in "Rangareddy" misses an alert addressed to "Ranga Reddy".
_norm = norm_name

# City-level entries. These name an actual town, which is what the answer layer
# and the LLM prompt want to say ("Machilipatnam", not "Krishna").
# `coastal` lets the answer layer state plainly when a sea-going occupation
# is used from a landlocked district (e.g. fisherman in Hyderabad).
_CITIES = [
    {"city": "Hyderabad", "district": "Hyderabad", "state": "Telangana", "latitude": 17.385, "longitude": 78.4867, "coastal": False},
    {"city": "Medchal", "district": "Medchal Malkajgiri", "state": "Telangana", "latitude": 17.52, "longitude": 78.53, "coastal": False},
    {"city": "Warangal", "district": "Warangal", "state": "Telangana", "latitude": 18.0, "longitude": 79.58, "coastal": False},
    {"city": "Nizamabad", "district": "Nizamabad", "state": "Telangana", "latitude": 18.67, "longitude": 78.09, "coastal": False},
    {"city": "Mumbai", "district": "Mumbai", "state": "Maharashtra", "latitude": 19.076, "longitude": 72.8777, "coastal": True},
    {"city": "Delhi", "district": "New Delhi", "state": "Delhi", "latitude": 28.6139, "longitude": 77.209, "coastal": False},
    {"city": "Bengaluru", "district": "Bengaluru Urban", "state": "Karnataka", "latitude": 12.9716, "longitude": 77.5946, "coastal": False},
    {"city": "Chennai", "district": "Chennai", "state": "Tamil Nadu", "latitude": 13.0827, "longitude": 80.2707, "coastal": True},
    {"city": "Visakhapatnam", "district": "Visakhapatnam", "state": "Andhra Pradesh", "latitude": 17.6868, "longitude": 83.2185, "coastal": True},
    {"city": "Kakinada", "district": "Kakinada", "state": "Andhra Pradesh", "latitude": 16.9891, "longitude": 82.2475, "coastal": True},
    {"city": "Machilipatnam", "district": "Krishna", "state": "Andhra Pradesh", "latitude": 16.1873, "longitude": 81.1389, "coastal": True},
    {"city": "Nellore", "district": "Nellore", "state": "Andhra Pradesh", "latitude": 14.4426, "longitude": 79.9865, "coastal": True},
    {"city": "Kochi", "district": "Kerala", "state": "Kerala", "latitude": 9.9312, "longitude": 76.2673, "coastal": True},
    {"city": "Panaji", "district": "North Goa", "state": "Goa", "latitude": 15.4909, "longitude": 73.8278, "coastal": True},
    {"city": "Veraval", "district": "Gir Somnath", "state": "Gujarat", "latitude": 20.9067, "longitude": 70.3683, "coastal": True},
    # Major districts beyond Telangana/Andhra + the metros above. Without
    # these, a GPS fix in (say) Kanpur resolved to New Delhi — 391 km away —
    # and the user inherited Delhi's alerts. Coordinates are city centres,
    # good to ~5 km for nearest-district matching.
    {"city": "Lucknow", "district": "Lucknow", "state": "Uttar Pradesh", "latitude": 26.85, "longitude": 80.95, "coastal": False},
    {"city": "Kanpur", "district": "Kanpur Nagar", "state": "Uttar Pradesh", "latitude": 26.4499, "longitude": 80.3319, "coastal": False},
    {"city": "Varanasi", "district": "Varanasi", "state": "Uttar Pradesh", "latitude": 25.3176, "longitude": 82.9739, "coastal": False},
    {"city": "Agra", "district": "Agra", "state": "Uttar Pradesh", "latitude": 27.1767, "longitude": 78.0081, "coastal": False},
    {"city": "Prayagraj", "district": "Prayagraj", "state": "Uttar Pradesh", "latitude": 25.4358, "longitude": 81.8463, "coastal": False},
    {"city": "Meerut", "district": "Meerut", "state": "Uttar Pradesh", "latitude": 28.9845, "longitude": 77.7064, "coastal": False},
    {"city": "Patna", "district": "Patna", "state": "Bihar", "latitude": 25.5941, "longitude": 85.1376, "coastal": False},
    {"city": "Bhopal", "district": "Bhopal", "state": "Madhya Pradesh", "latitude": 23.2599, "longitude": 77.4126, "coastal": False},
    {"city": "Indore", "district": "Indore", "state": "Madhya Pradesh", "latitude": 22.7196, "longitude": 75.8577, "coastal": False},
    {"city": "Jaipur", "district": "Jaipur", "state": "Rajasthan", "latitude": 26.9124, "longitude": 75.7873, "coastal": False},
    {"city": "Jodhpur", "district": "Jodhpur", "state": "Rajasthan", "latitude": 26.2389, "longitude": 73.0243, "coastal": False},
    {"city": "Pune", "district": "Pune", "state": "Maharashtra", "latitude": 18.5204, "longitude": 73.8567, "coastal": False},
    {"city": "Nagpur", "district": "Nagpur", "state": "Maharashtra", "latitude": 21.1458, "longitude": 79.0882, "coastal": False},
    {"city": "Ahmedabad", "district": "Ahmedabad", "state": "Gujarat", "latitude": 23.0225, "longitude": 72.5714, "coastal": False},
    {"city": "Surat", "district": "Surat", "state": "Gujarat", "latitude": 21.1702, "longitude": 72.8311, "coastal": True},
    {"city": "Kolkata", "district": "Kolkata", "state": "West Bengal", "latitude": 22.5726, "longitude": 88.3639, "coastal": False},
    {"city": "Bhubaneswar", "district": "Khordha", "state": "Odisha", "latitude": 20.2961, "longitude": 85.8245, "coastal": False},
    {"city": "Mysuru", "district": "Mysuru", "state": "Karnataka", "latitude": 12.2958, "longitude": 76.6394, "coastal": False},
    {"city": "Coimbatore", "district": "Coimbatore", "state": "Tamil Nadu", "latitude": 11.0168, "longitude": 76.9558, "coastal": False},
    {"city": "Madurai", "district": "Madurai", "state": "Tamil Nadu", "latitude": 9.9252, "longitude": 78.1198, "coastal": False},
    {"city": "Thiruvananthapuram", "district": "Thiruvananthapuram", "state": "Kerala", "latitude": 8.5241, "longitude": 76.9366, "coastal": True},
    {"city": "Ludhiana", "district": "Ludhiana", "state": "Punjab", "latitude": 30.901, "longitude": 75.8573, "coastal": False},
    {"city": "Amritsar", "district": "Amritsar", "state": "Punjab", "latitude": 31.634, "longitude": 74.8723, "coastal": False},
    {"city": "Gurugram", "district": "Gurugram", "state": "Haryana", "latitude": 28.4595, "longitude": 77.0266, "coastal": False},
    {"city": "Shimla", "district": "Shimla", "state": "Himachal Pradesh", "latitude": 31.1048, "longitude": 77.1734, "coastal": False},
    {"city": "Dehradun", "district": "Dehradun", "state": "Uttarakhand", "latitude": 30.3165, "longitude": 78.0322, "coastal": False},
    {"city": "Ranchi", "district": "Ranchi", "state": "Jharkhand", "latitude": 23.3441, "longitude": 85.3096, "coastal": False},
    {"city": "Raipur", "district": "Raipur", "state": "Chhattisgarh", "latitude": 21.2514, "longitude": 81.6296, "coastal": False},
    {"city": "Guwahati", "district": "Kamrup Metropolitan", "state": "Assam", "latitude": 26.1445, "longitude": 91.7362, "coastal": False},
    {"city": "Srinagar", "district": "Srinagar", "state": "Jammu and Kashmir", "latitude": 34.0837, "longitude": 74.7973, "coastal": False},
]


# Beyond this distance the "nearest district" is a guess, not a location.
_MAX_NEAREST_KM = 150.0


def _build_gazetteer() -> list[dict]:
    """City entries plus every Telangana / Andhra district.

    The city list alone held 14 entries while the CAP feeds address all 33
    Telangana and 26 Andhra Pradesh districts, so a user in, say, Kamareddy
    resolved to a district hundreds of kilometres away — and then their alerts
    were matched against that wrong district. City entries stay first and win a
    collision, because they carry a town name worth showing.
    """
    merged = [dict(e) for e in _CITIES]
    seen = {(e["state"], e["district"]) for e in merged}
    for entry in district_service.as_gazetteer_entries():
        if (entry["state"], entry["district"]) in seen:
            continue
        merged.append(entry)
        seen.add((entry["state"], entry["district"]))
    return merged


GAZETTEER = _build_gazetteer()


# Common ways people actually type these places: nicknames, older spellings,
# transliteration variants, voice-transcription manglings. Keys are normalized.
_ALIASES = {
    "hyd": "Hyderabad",
    "hydrabad": "Hyderabad",
    "hydrabhad": "Hyderabad",
    "hydarabad": "Hyderabad",
    "vizag": "Visakhapatnam",
    "vizak": "Visakhapatnam",
    "vizakapatnam": "Visakhapatnam",
    "visakha": "Visakhapatnam",
    "wgl": "Warangal",
    "warangl": "Warangal",
    "warrangal": "Warangal",
    "bangalore": "Bengaluru Urban",
    "bengluru": "Bengaluru Urban",
    "bengaluru": "Bengaluru Urban",
    "cochin": "Kerala",
    "panjim": "North Goa",
    "gurgaon": "New Delhi",
    "mumbay": "Mumbai",
    "chennay": "Chennai",
    "chenai": "Chennai",
    "delhi": "New Delhi",
    "newdelhi": "New Delhi",
    "kakinda": "Kakinada",
    "kakinadha": "Kakinada",
    "nizamabadh": "Nizamabad",
    "nellore": "Nellore",
    "machilipatam": "Krishna",
    "masulipatnam": "Krishna",
    "gir somnath": "Gir Somnath",
    "somnath": "Gir Somnath",
}


# Shortest token allowed to take part in a match. `_match_query` tests both
# "query contains token" and "token contains query", so a one- or two-letter
# token is not a name, it is a wildcard: "Dr. B.R. Ambedkar Konaseema" would
# otherwise contribute "b" and "r" and swallow every query containing a "b"
# ("hydrbadd", "bangalore", ...). Names worth matching are at least 3 letters.
_MIN_TOKEN = 3


def _tokens(entry: dict) -> list[str]:
    """All name tokens an entry can be matched by, e.g. ['visakhapatnam', ...]."""
    words: list[str] = []
    for key in ("city", "district", "state"):
        words.extend(_norm(entry.get(key, "")).split())
    # Whole multi-word names as single tokens too ('north goa', 'gir somnath').
    words.append(_norm(entry.get("city", "")))
    words.append(_norm(entry.get("district", "")))
    # Spellings the official feeds use for the same place ("Ranga Reddy",
    # "Vijayawada", "Paderu"). Without these a user cannot find their own
    # district by the name they actually see in the alert.
    for alias in entry.get("aliases") or []:
        words.append(_norm(alias))
    return [w for w in dict.fromkeys(words) if len(w) >= _MIN_TOKEN]


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _name_tokens(entry: dict) -> list[str]:
    """City/district/alias tokens only — no state words. A typo'd place name
    must match the PLACE, not a state that happens to share letters
    ('bangalre' once suggested Kolkata because 'bengal' from 'West Bengal'
    outscored 'bengaluru')."""
    words: list[str] = []
    for key in ("city", "district"):
        words.extend(_norm(entry.get(key, "")).split())
    words.append(_norm(entry.get("city", "")))
    words.append(_norm(entry.get("district", "")))
    for alias in entry.get("aliases") or []:
        words.append(_norm(alias))
    return [w for w in words if w]


def _fuzzy_candidates(query: str, limit: int = 5, cutoff: float = 0.6) -> list[dict]:
    """Closest gazetteer entries to a mistyped name, best first. Empty when the
    input is too far from anything (no confident guess = no suggestion)."""
    q = _norm(query)
    if not q:
        return []
    scored: list[tuple[float, float, str, dict]] = []
    for entry in GAZETTEER:
        name_best = max((_similarity(q, tok) for tok in _name_tokens(entry)), default=0.0)
        state_best = max((_similarity(q, tok) for tok in _norm(entry.get("state", "")).split()), default=0.0)
        scored.append((name_best, state_best, entry["district"], entry))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    out = []
    for name_best, state_best, _name, entry in scored[:limit]:
        if max(name_best, state_best) < cutoff:
            break
        hit = dict(entry)
        hit["suggested"] = True
        hit["match_score"] = round(max(name_best, state_best), 3)
        out.append(hit)
    return out


class LocationService:
    def lookup(self, query: str) -> dict | None:
        """The gazetteer entry for a name, or None when we cannot place it.

        Public form of the name match, for callers that already know which
        district they want (rather than having a GPS fix). Those callers need the
        entry's state and coordinates, and they need to hear "I do not know this
        place" rather than be handed the nearest guess — `resolve` deliberately
        guesses, `lookup` deliberately does not.
        """
        return self._match_query(query)

    def _match_query(self, query: str) -> dict | None:
        q = _norm(query)
        if not q:
            return None
        for entry in GAZETTEER:
            toks = _tokens(entry)
            if q in toks or any(q in tok or tok in q for tok in toks):
                return dict(entry)
        alias = _ALIASES.get(q)
        if alias:
            return next((dict(e) for e in GAZETTEER if e["district"] == alias), None)
        fuzzy = _fuzzy_candidates(query, limit=1)
        return fuzzy[0] if fuzzy else None

    def resolve(self, latitude: float | None, longitude: float | None, query: str = "") -> dict:
        if query:
            hit = self._match_query(query)
            if hit:
                return hit
        lat = latitude if latitude is not None else cfg.DEFAULT_LAT
        lon = longitude if longitude is not None else cfg.DEFAULT_LON
        # A non-finite fix (inf/nan — reachable from a query or JSON float) cannot
        # be placed. Treat it like "no fix" and fall back to the default location
        # rather than letting the nearest-district search raise a math domain
        # error and turn the request into a 500.
        if not (math.isfinite(lat) and math.isfinite(lon)):
            lat, lon = cfg.DEFAULT_LAT, cfg.DEFAULT_LON
        entry = min(GAZETTEER, key=lambda e: haversine_km(lat, lon, e["latitude"], e["longitude"]))
        dist_km = haversine_km(lat, lon, entry["latitude"], entry["longitude"])
        if dist_km > _MAX_NEAREST_KM:
            # Beyond this distance the "nearest district" is a guess, not a
            # location: Kanpur once resolved to New Delhi (391 km) and inherited
            # Delhi's alerts. Unknown is honest; a wrong district is not.
            # coastal=None (never False): an unknown district must never be
            # called inland — the advisory layer keeps its neutral wording.
            report("gis-location", LIVE,
                   f"GPS fix {dist_km:.0f} km from nearest known district — unknown")
            return {"city": None, "district": None, "state": None,
                    "latitude": lat, "longitude": lon, "coastal": None,
                    "unknown": True, "nearest_km": round(dist_km, 1)}
        # GIS Job 1 "Where am I?" just ran for real — refresh its source status.
        report("gis-location", LIVE, f"nearest district to GPS fix: {entry.get('district')}")
        return dict(entry)

    def search(self, query: str) -> list[dict]:
        q = _norm(query)
        if not q:
            return []
        exact = [dict(e) for e in GAZETTEER if q in _tokens(e) or any(q in tok for tok in _tokens(e))]
        if exact:
            return exact[:8]
        alias = _ALIASES.get(q)
        if alias:
            alias_hits = [dict(e) for e in GAZETTEER if e["district"] == alias]
            for h in alias_hits:
                h["suggested"] = True
            return alias_hits[:8]
        return _fuzzy_candidates(query)[:8]