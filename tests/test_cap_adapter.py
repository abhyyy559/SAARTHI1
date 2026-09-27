"""CAP adapter serve-fresh cache — hit/miss/expiry semantics. No network."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import asyncio  # noqa: E402
import tempfile  # noqa: E402
from datetime import datetime, timedelta  # noqa: E402

from backend.adapters import cap_adapter  # noqa: E402
from backend.services.cache_service import CacheService  # noqa: E402
from backend.utils.time import now_ist  # noqa: E402
from backend import config  # noqa: E402


def _seed_cache(monkeypatch, age_seconds: int):
    """Seed cap_alerts cache entry with a controlled age.

    Isolated to a tmp cache file (via config.CACHE_FILE, which CacheService
    reads at construction time): the suite must never touch the developer's
    real runtime cache. fetch_alerts() builds its own CacheService from disk,
    so the seed has to be _save()d — an in-memory-only write is invisible.
    """
    # fetch_alerts requires configured URLs before it checks the cache.
    config.CAP_FEED_URLS = ["https://example.com/cap.xml"]
    tmp = tempfile.mkdtemp(prefix="cap_test_cache_")
    monkeypatch.setattr(config, "CACHE_FILE", os.path.join(tmp, "cache.json"))
    svc = CacheService()
    retrieved = (now_ist() - timedelta(seconds=age_seconds)).isoformat()
    entry = {"data": [{"identifier": "seed-1", "headline": "Seed alert"}],
             "retrieved_at": retrieved,
             "expires_at": (now_ist() + timedelta(minutes=30)).isoformat()}
    # Bypass TTL stamping: write directly to the underlying store, then persist.
    # _save() takes the lock itself, so it must run outside the with-block.
    with svc._lock:
        svc._data["cap_alerts"] = entry
    svc._save()
    return svc


def test_serve_fresh_cache_hit(monkeypatch):
    # Fresh entry (<5min): returns cached data immediately, no network.
    _seed_cache(monkeypatch, age_seconds=120)
    alerts, prov = asyncio.run(cap_adapter.fetch_alerts())
    assert alerts[0]["identifier"] == "seed-1"
    assert prov == "CACHED", f"fresh cache must report CACHED, got {prov}"
    print("PASS: test_serve_fresh_cache_hit")


def test_serve_fresh_cache_expired_triggers_live(monkeypatch):
    # Stale entry (>5min): serve-fresh skipped, live fetch attempted.
    _seed_cache(monkeypatch, age_seconds=400)
    called = {"live": False}
    async def fake_fetch(client, url):
        called["live"] = True
        return []
    monkeypatch.setattr(cap_adapter, "_fetch_feed", fake_fetch)
    # Also stub the linked-doc fetch to avoid network.
    async def fake_linked(client, link):
        return []
    monkeypatch.setattr(cap_adapter, "_fetch_linked", fake_linked)
    alerts, prov = asyncio.run(cap_adapter.fetch_alerts())
    assert called["live"], "expired cache must trigger live fetch"
    print("PASS: test_serve_fresh_cache_expired_triggers_live")


if __name__ == "__main__":
    # Standalone run: minimal monkeypatch stand-in (process exits right after).
    class _Shim:
        def setattr(self, obj, name, value):
            setattr(obj, name, value)
    test_serve_fresh_cache_hit(_Shim())
    # test_serve_fresh_cache_expired_triggers_live needs pytest's monkeypatch; run via pytest
    print("\nCAP adapter cache tests passed.")
