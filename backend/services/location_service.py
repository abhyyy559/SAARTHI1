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
]


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


def _fuzzy_candidates(query: str, limit: int = 5, cutoff: float = 0.6) -> list[dict]:
    """Closest gazetteer entries to a mistyped name, best first. Empty when the
    input is too far from anything (no confident guess = no suggestion)."""
    q = _norm(query)
    if not q:
        return []
    scored: list[tuple[float, str, dict]] = []
    for entry in GAZETTEER:
        best = max(_similarity(q, tok) for tok in _tokens(entry))
        scored.append((best, entry["district"], entry))
    scored.sort(key=lambda x: -x[0])
    out = []
    for score, _name, entry in scored[:limit]:
        if score < cutoff:
            break
        hit = dict(entry)
        hit["suggested"] = True
        hit["match_score"] = round(score, 3)
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