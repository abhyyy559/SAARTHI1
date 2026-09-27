"""IMD station/district ID resolution for ANY location.

The IMD API takes numeric IDs (?id=...), never names or coordinates. A fixed
hand-written map (IMD_STATION_IDS) only covers the districts somebody typed
in — it cannot serve arbitrary user locations. This resolver instead fetches
IMD's own mapping tables once, caches them on disk, and resolves at runtime:

  lat/lng       -> nearest IMD station (haversine) -> current_wx / forecast ID
  district name -> IMD district ID                 -> districtwarning / nowcast ID

Resolution order for every call:
  1. IMD_STATION_IDS manual override (exact district name wins — for pinning
     a wrong auto-match without touching code).
  2. The fetched mapping tables.
  3. Fail closed -> AdapterUnavailable -> the chain falls through to
     Open-Meteo, honestly labelled. IDs are never guessed.

Honesty notes:
  - The mapping endpoint names (IMD_PATH_STATION_MAPPING /
    IMD_PATH_DISTRICT_MAPPING) are BEST-EFFORT GUESSES following IMD's naming
    (current_wx, districtwarning, ...). The API docs sit behind the portal
    login, so they are NOT verified. A wrong name 404s -> the resolver fails
    closed with the exact URL it tried, never a wrong station.
  - A "nearest" station more than MAX_STATION_KM away is not this user's
    weather (outside India / no IMD coverage) -> fail closed to Open-Meteo.
"""
import asyncio
import json
import math
import time
from pathlib import Path
from typing import Awaitable, Callable, Optional

from .. import config
from ..adapters.registry import AdapterUnavailable, make_client

_CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "imd_mapping_cache.json"

# Beyond this the "nearest" IMD station is not the user's weather. Matches the
# app's district-honesty threshold (150 km).
MAX_STATION_KM = 150.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2)
    return 2 * radius * math.asin(math.sqrt(a))


def _norm(name) -> str:
    return " ".join(str(name or "").strip().lower().split())


def _first(entry: dict, *names):
    """First non-None value under any name; case-insensitive fallback."""
    for name in names:
        value = entry.get(name)
        if value is not None:
            return value
    lowered = {str(k).lower(): v for k, v in entry.items()}
    for name in names:
        value = lowered.get(str(name).lower())
        if value is not None:
            return value
    return None


def _coerce_rows(payload) -> list:
    """Mapping payloads may be a bare list or a dict wrapping one."""
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("data", "stations", "districts", "result",
                    "rows", "items", "list"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [r for r in rows if isinstance(r, dict)]
    return []


def _station_record(entry: dict) -> Optional[dict]:
    sid = _first(entry, "id", "station_id", "stationid", "code", "station_code")
    name = _first(entry, "station_name", "name", "station", "city", "place")
    if sid is None or name is None:
        return None
    lat = _first(entry, "lat", "latitude")
    lng = _first(entry, "lng", "lon", "long", "longitude")
    try:
        lat = float(lat) if lat is not None else None
        lng = float(lng) if lng is not None else None
    except (TypeError, ValueError):
        lat, lng = None, None
    return {
        "id": str(sid),
        "name": str(name),
        "lat": lat,
        "lng": lng,
        "district": _first(entry, "district", "district_name"),
        # Some IMD tables give the forecast its own city code; fall back to
        # the station id when the table does not distinguish.
        "forecast_id": _first(entry, "forecast_id", "city_id", "city_code"),
    }


def _district_record(entry: dict) -> Optional[dict]:
    did = _first(entry, "id", "district_id", "districtid", "code")
    name = _first(entry, "district", "district_name", "name")
    if did is None or name is None:
        return None
    return {"id": str(did), "name": str(name)}


class IMDMappingResolver:
    """Fetches + caches IMD's mapping tables; resolves any location to IDs."""

    def __init__(self, get_jwt: Callable[[], Awaitable[str]]) -> None:
        self._get_jwt = get_jwt
        self._lock = asyncio.Lock()
        self._loaded = False
        self._stations: list = []
        self._districts: list = []
        self._stale: dict = {}

    # -- loading ---------------------------------------------------------
    async def ensure_loaded(self) -> None:
        if self._loaded:
            return
        async with self._lock:
            if self._loaded:
                return
            if self._load_cache():
                self._loaded = True
                return
            await self._fetch_and_cache()
            self._loaded = True

    def _load_cache(self) -> bool:
        try:
            raw = json.loads(_CACHE_PATH.read_text())
        except (OSError, ValueError):
            return False
        try:
            age = time.time() - float(raw.get("fetched_at", 0))
        except (TypeError, ValueError):
            return False
        self._stations = raw.get("stations") or []
        self._districts = raw.get("districts") or []
        if age <= config.IMD_MAPPING_TTL_S and (self._stations or self._districts):
            return True
        # Expired but structurally fine: remember as a fallback if the refetch
        # fails (IMD IDs are stable; a stale table beats no table).
        self._stale = {"stations": self._stations,
                       "districts": self._districts}
        self._stations, self._districts = [], []
        return False

    async def _fetch_table(self, path: str) -> dict:
        if not config.IMD_API_KEY:
            raise AdapterUnavailable("IMD live unavailable — set IMD_API_KEY")
        url = f"{config.IMD_BASE_URL}/{path}"
        headers = {"X-API-KEY": config.IMD_API_KEY,
                   "Authorization": f"Bearer {await self._get_jwt()}"}
        try:
            # make_client: proxy-safe factory (see imd_service) — a malformed
            # proxy env must not take down mapping-table fetches.
            async with make_client(timeout=config.IMD_TIMEOUT) as client:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            raise AdapterUnavailable(
                f"IMD mapping fetch failed for {url} — check "
                f"IMD_PATH_STATION_MAPPING / IMD_PATH_DISTRICT_MAPPING against "
                f"the portal API docs: {type(exc).__name__}") from exc

    async def _fetch_and_cache(self) -> None:
        stations, districts = [], []
        try:
            if config.IMD_PATH_STATION_MAPPING:
                payload = await self._fetch_table(config.IMD_PATH_STATION_MAPPING)
                stations = [r for r in
                            (_station_record(e) for e in _coerce_rows(payload)) if r]
            if config.IMD_PATH_DISTRICT_MAPPING:
                payload = await self._fetch_table(config.IMD_PATH_DISTRICT_MAPPING)
                districts = [r for r in
                             (_district_record(e) for e in _coerce_rows(payload)) if r]
        except AdapterUnavailable:
            if self._stale.get("stations") or self._stale.get("districts"):
                self._use_stale()
                return
            raise
        if not stations and not districts:
            if self._stale.get("stations") or self._stale.get("districts"):
                self._use_stale()
                return
            raise AdapterUnavailable(
                "IMD mapping tables came back empty — check "
                "IMD_PATH_STATION_MAPPING / IMD_PATH_DISTRICT_MAPPING against "
                "the portal API docs")
        self._stations, self._districts = stations, districts
        try:
            _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            _CACHE_PATH.write_text(json.dumps({
                "fetched_at": time.time(),
                "stations": stations,
                "districts": districts,
            }))
        except OSError:
            pass  # cache write failure must not break resolution

    def _use_stale(self) -> None:
        self._stations = self._stale.get("stations") or []
        self._districts = self._stale.get("districts") or []

    # -- resolution ------------------------------------------------------
    def station_for(self, lat: float, lng: float,
                    max_km: float = MAX_STATION_KM) -> Optional[dict]:
        best, best_km = None, None
        for station in self._stations:
            if station["lat"] is None or station["lng"] is None:
                continue
            km = _haversine_km(lat, lng, station["lat"], station["lng"])
            if best_km is None or km < best_km:
                best, best_km = station, km
        if best is None or best_km > max_km:
            return None
        return best

    def station_for_district(self, district: str) -> Optional[dict]:
        want = _norm(district)
        for station in self._stations:
            if _norm(station.get("district")) == want:
                return station
        return None

    def district_id(self, district: str) -> Optional[str]:
        want = _norm(district)
        for entry in self._districts:
            if _norm(entry["name"]) == want:
                return entry["id"]
        for entry in self._districts:  # loose: "Hyderabad" in "Hyderabad district"
            normed = _norm(entry["name"])
            if want and (want in normed or normed in want):
                return entry["id"]
        return None

    async def resolve(self, kind: str, lat: Optional[float] = None,
                      lng: Optional[float] = None,
                      district: Optional[str] = None) -> str:
        """Resolve one endpoint kind to an IMD numeric ID.

        kind: "current" | "forecast" | "warning" | "nowcast".
        Raises AdapterUnavailable (fail closed -> Open-Meteo) when the
        location cannot be mapped — never a guessed or wrong-station ID.
        """
        name = (district or "").strip()

        # 1. Manual override wins — exact district name.
        if name:
            override = (config.IMD_STATION_IDS.get(name) or {}).get(kind)
            if override:
                return str(override)

        # 2. Mapping tables.
        if not (config.IMD_PATH_STATION_MAPPING or config.IMD_PATH_DISTRICT_MAPPING):
            raise AdapterUnavailable(
                f"no IMD {kind} ID for {name or 'this location'} — set "
                f"IMD_STATION_IDS, or configure IMD_PATH_STATION_MAPPING / "
                f"IMD_PATH_DISTRICT_MAPPING (see docs/IMD-KEY-ONBOARDING.md)")
        await self.ensure_loaded()

        if kind in ("warning", "nowcast"):
            if not name:
                name = config.IMD_DEFAULT_DISTRICT
            did = self.district_id(name)
            if did:
                return did
            # Last resort: nearest station's district (needs coords).
            if lat is not None and lng is not None:
                station = self.station_for(lat, lng)
                if station and station.get("district"):
                    did = self.district_id(station["district"])
                    if did:
                        return did
            raise AdapterUnavailable(
                f"no IMD district ID for {name!r} — IMD has no warning "
                f"coverage here; falling back to SACHET CAP + Open-Meteo")

        # current / forecast: nearest station to the coordinates.
        station = None
        if lat is not None and lng is not None:
            station = self.station_for(lat, lng)
        if station is None and name:
            station = self.station_for_district(name or config.IMD_DEFAULT_DISTRICT)
        if station is None:
            raise AdapterUnavailable(
                f"no IMD station near ({lat}, {lng})"
                f"{f' / {name}' if name else ''} — outside IMD coverage; "
                f"falling back to Open-Meteo")
        if kind == "forecast" and station.get("forecast_id"):
            return str(station["forecast_id"])
        return str(station["id"])


_resolver: Optional[IMDMappingResolver] = None


def get_resolver(get_jwt: Callable[[], Awaitable[str]]) -> IMDMappingResolver:
    """Process-wide singleton — every provider mints from the same config."""
    global _resolver
    if _resolver is None:
        _resolver = IMDMappingResolver(get_jwt=get_jwt)
    return _resolver
