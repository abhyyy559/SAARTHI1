"""Screens must not time out waiting on upstream sources.

The weather card and alerts showed "not available" because every request
re-fetched Open-Meteo, SACHET and the alert chain (2-3 s each, 20 s on a bad
line) while the app waited at most 5 s. These pin the short upstream memo and
the parallel alert chain.
"""
import asyncio
import time

import pytest

from backend.adapters import alert_sources
from backend.utils import upstream_cache


@pytest.fixture
def memo_on(monkeypatch):
    monkeypatch.setenv("UPSTREAM_CACHE_SECONDS", "1")
    upstream_cache.clear()
    yield
    upstream_cache.clear()


def test_concurrent_and_repeat_requests_share_one_fetch(memo_on):
    calls = []

    async def fetch():
        calls.append(1)
        await asyncio.sleep(0.05)
        return {"alerts": [{"id": "a", "relevance": None}]}

    async def main():
        first = await asyncio.gather(*(upstream_cache.remember("k", 60, fetch) for _ in range(5)))
        again = await upstream_cache.remember("k", 60, fetch)
        return first, again

    first, again = asyncio.run(main())
    assert len(calls) == 1
    assert again == first[0]


def test_every_caller_gets_its_own_copy(memo_on):
    """Alert dicts are tagged per request; a shared object would leak tags."""
    async def fetch():
        return [{"id": "a"}]

    async def main():
        one = await upstream_cache.remember("k2", 60, fetch)
        one[0]["relevance"] = {"relevant": True, "district": "Hyderabad"}
        return await upstream_cache.remember("k2", 60, fetch)

    assert asyncio.run(main()) == [{"id": "a"}]


def test_failures_and_rejected_results_are_not_remembered(memo_on):
    calls = []

    async def boom():
        calls.append("boom")
        raise RuntimeError("upstream down")

    async def cached_fallback():
        calls.append("cached")
        return [], "CACHED"

    async def main():
        for _ in range(2):
            with pytest.raises(RuntimeError):
                await upstream_cache.remember("k3", 60, boom)
        for _ in range(2):
            await upstream_cache.remember("k4", 60, cached_fallback, keep=lambda r: r[1] == "LIVE")

    asyncio.run(main())
    assert calls == ["boom", "boom", "cached", "cached"]


def test_alert_chain_asks_providers_together_and_keeps_priority(monkeypatch):
    async def slow_intouch(lat, lon, district):
        await asyncio.sleep(0.4)
        return [{"identifier": "wit-1"}]

    async def wapi(lat, lon, district):
        raise RuntimeError("WEATHERAPI_KEY not configured")

    async def gdacs(lat, lon, district):
        await asyncio.sleep(0.4)
        return [{"identifier": "gdacs-1"}]

    monkeypatch.setattr(alert_sources, "_from_weatherintouch", slow_intouch)
    monkeypatch.setattr(alert_sources, "_from_weatherapi", wapi)
    monkeypatch.setattr(alert_sources, "_from_gdacs", gdacs)
    t = time.perf_counter()
    alerts, prov = asyncio.run(alert_sources.get_alerts(17.385, 78.4867, "Hyderabad"))
    elapsed = time.perf_counter() - t
    assert prov == "LIVE" and alerts == [{"identifier": "wit-1"}], alerts  # priority kept
    assert elapsed < 0.75, f"providers ran one after another ({elapsed:.2f}s)"
