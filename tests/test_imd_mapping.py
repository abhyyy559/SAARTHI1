"""IMD any-location mapping tests — nearest-station, district lookup, caching.

The network is faked by monkeypatching httpx.AsyncClient inside imd_mapping.
No real IMD calls.
"""
import asyncio
import json
import os
import sys
import time

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend import config
import backend.services.imd_mapping as mapping_mod
from backend.services.imd_mapping import (
    IMDMappingResolver, _haversine_km, _station_record, _coerce_rows,
    get_resolver,
)
from backend.adapters.registry import AdapterUnavailable

# Fake mapping payloads (mixed casings on purpose — parsing is defensive).
STATION_PAYLOAD = {"data": [
    {"Station_ID": "42182", "Station_Name": "Hyderabad", "Latitude": 17.38,
     "Longitude": 78.48, "District": "Hyderabad"},
    {"Station_ID": "43003", "Station_Name": "Warangal", "Latitude": 17.98,
     "Longitude": 79.60, "District": "Warangal"},
    {"Station_ID": "42410", "Station_Name": "Chennai", "Latitude": 13.00,
     "Longitude": 80.27, "District": "Chennai"},
]}
DISTRICT_PAYLOAD = [
    {"district_id": "D-HYD", "district_name": "Hyderabad"},
    {"district_id": "D-WRN", "district_name": "Warangal"},
]


class FakeResponse:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload if payload is not None else {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}", request=None, response=None)

    def json(self):
        return self._payload


class ScriptedClient:
    gets = []
    fetch_count = 0

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None, **kwargs):
        ScriptedClient.gets.append(url)
        ScriptedClient.fetch_count += 1
        if "stationmapping" in url:
            return FakeResponse(200, STATION_PAYLOAD)
        if "districtmapping" in url:
            return FakeResponse(200, DISTRICT_PAYLOAD)
        return FakeResponse(404, {})


async def fake_jwt():
    return "jwt-test"


@pytest.fixture
def resolver(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "IMD_API_KEY", "key-123")
    monkeypatch.setattr(config, "IMD_BASE_URL", "https://api.imd.gov.in/api/v1")
    monkeypatch.setattr(config, "IMD_PATH_STATION_MAPPING", "stationmapping")
    monkeypatch.setattr(config, "IMD_PATH_DISTRICT_MAPPING", "districtmapping")
    monkeypatch.setattr(config, "IMD_MAPPING_TTL_S", 604800)
    monkeypatch.setattr(config, "IMD_STATION_IDS", {})
    monkeypatch.setattr(config, "IMD_DEFAULT_DISTRICT", "Hyderabad")
    monkeypatch.setattr(mapping_mod, "_CACHE_PATH", tmp_path / "cache.json")
    monkeypatch.setattr(mapping_mod.httpx, "AsyncClient", ScriptedClient)
    ScriptedClient.gets = []
    ScriptedClient.fetch_count = 0
    return IMDMappingResolver(get_jwt=fake_jwt)


def test_haversine_sanity():
    # Hyderabad -> Secunderabad ~11 km; Hyderabad -> Delhi ~1260 km.
    assert _haversine_km(17.38, 78.48, 17.44, 78.50) < 15
    assert 1200 < _haversine_km(17.38, 78.48, 28.61, 77.21) < 1350


def test_defensive_parsing():
    rows = _coerce_rows(STATION_PAYLOAD)
    assert len(rows) == 3
    rec = _station_record(rows[0])
    assert rec["id"] == "42182" and rec["lat"] == 17.38
    assert _coerce_rows({"stations": [{"id": 1}]})[0]["id"] == 1
    assert _coerce_rows([{"id": 2}])[0]["id"] == 2
    assert _coerce_rows({}) == []


def test_nearest_station(resolver):
    sid = asyncio.run(resolver.resolve("current", lat=17.40, lng=78.50))
    assert sid == "42182"
    # Warangal coords -> Warangal station, not Hyderabad.
    sid = asyncio.run(resolver.resolve("current", lat=17.99, lng=79.61))
    assert sid == "43003"
    # Fetched once for both calls (in-memory + disk cache).
    assert ScriptedClient.fetch_count == 2  # one per table


def test_far_outside_india_fails_closed(resolver):
    with pytest.raises(AdapterUnavailable):
        asyncio.run(resolver.resolve("current", lat=51.5, lng=-0.12))  # London


def test_district_name_normalization(resolver):
    assert asyncio.run(resolver.resolve("warning", district="hyderabad")) == "D-HYD"
    assert asyncio.run(resolver.resolve("warning", district="  Hyderabad ")) == "D-HYD"
    assert asyncio.run(resolver.resolve("nowcast", district="WARANGAL")) == "D-WRN"


def test_unknown_district_fails_closed(resolver):
    with pytest.raises(AdapterUnavailable):
        asyncio.run(resolver.resolve("warning", district="Atlantis"))


def test_manual_override_wins(resolver, monkeypatch):
    monkeypatch.setattr(config, "IMD_STATION_IDS",
                        {"Hyderabad": {"warning": "D-PINNED"}})
    assert asyncio.run(resolver.resolve("warning", district="Hyderabad")) == "D-PINNED"
    assert ScriptedClient.fetch_count == 0  # override short-circuits, no fetch


def test_no_mapping_configured_no_network(resolver, monkeypatch):
    monkeypatch.setattr(config, "IMD_PATH_STATION_MAPPING", "")
    monkeypatch.setattr(config, "IMD_PATH_DISTRICT_MAPPING", "")
    with pytest.raises(AdapterUnavailable):
        asyncio.run(resolver.resolve("current", lat=17.40, lng=78.50))
    assert ScriptedClient.gets == [] and ScriptedClient.fetch_count == 0


def test_disk_cache_avoids_refetch(resolver, tmp_path, monkeypatch):
    asyncio.run(resolver.ensure_loaded())
    assert ScriptedClient.fetch_count == 2
    # A fresh resolver on the same cache path must not hit the network.
    ScriptedClient.fetch_count = 0
    r2 = IMDMappingResolver(get_jwt=fake_jwt)
    asyncio.run(r2.ensure_loaded())
    assert ScriptedClient.fetch_count == 0
    assert r2.station_for(17.40, 78.50)["id"] == "42182"


def test_stale_cache_used_when_fetch_fails(resolver, tmp_path, monkeypatch):
    asyncio.run(resolver.ensure_loaded())
    # Expire the cache, then break the network.
    raw = json.loads((tmp_path / "cache.json").read_text())
    raw["fetched_at"] = time.time() - 10_000_000
    (tmp_path / "cache.json").write_text(json.dumps(raw))

    class BrokenClient(ScriptedClient):
        async def get(self, url, headers=None, **kwargs):
            raise httpx.ConnectError("nope")

    monkeypatch.setattr(mapping_mod.httpx, "AsyncClient", BrokenClient)
    r2 = IMDMappingResolver(get_jwt=fake_jwt)
    asyncio.run(r2.ensure_loaded())  # must not raise
    assert r2.station_for(17.40, 78.50)["id"] == "42182"


def test_get_resolver_singleton():
    mapping_mod._resolver = None
    try:
        assert get_resolver(fake_jwt) is get_resolver(fake_jwt)
    finally:
        mapping_mod._resolver = None
