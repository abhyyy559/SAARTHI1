"""Shared test setup. Runs BEFORE any test module imports backend code.

Isolation: the test suite must never read or write the developer's real runtime
store. Two separate leaks existed here.

1. (Removed: the old emergency relay and its own store file.)

2. The Round-2 stores did NOT have working isolation. `NOTIFICATION_STORE_FILE`,
   `DELIVERY_STORE_FILE` and `DEMO_ALERT_STORE_FILE` were set below but read by
   no backend code: the demo alert store and the notification log go through
   services/db.py, which resolved them to `<cache_dir>/store/docs_*.json`
   regardless. A plain `pytest` run therefore wrote to — and, via the tests that
   call `reset_store()`, CLEARED — the real demo alerts, notification log and
   delivery ledger. Running the suite before a demo wiped the demo.

   The real switch is `SAARTHI_STORE_DIR`, honoured by `db._json_path`, which
   relocates every kv row, document and log together. It is set first, before
   anything can import the backend.
"""
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="wgpt_test_stores_")

# Relocate the ENTIRE JSON store (kv rows, docs, logs) for this process.
os.environ["SAARTHI_STORE_DIR"] = _TMP

# Keep the real store out of reach even if something resolves a path before
# SAARTHI_STORE_DIR is consulted.
os.environ.pop("DATABASE_URL", None)

# SACHET feeds are on by default in config; tests opt in by monkeypatching
# config.CAP_FEED_URLS, so the suite never depends on the live NDMA feed.
os.environ["CAP_FEED_URLS"] = "off"
# No start-up warm-up of real places, and no second LLM model, in tests.
os.environ["WARM_DISTRICTS"] = ""
os.environ["LLM_FALLBACK_MODEL"] = ""

# A developer's .env must not leak into the suite: config loads it with
# override=False, so empty values set here win. Tests that need a key
# monkeypatch config directly.
for _key in ("IMD_API_KEY", "IMD_KEY", "LLM_API_KEY", "SARVAM_API_KEY", "STT_API_KEY",
             "TTS_API_KEY", "OWM_API_KEY", "DATAGOV_API_KEY", "WEATHERAPI_KEY",
             "WEATHERUNION_KEY", "DEMO_MODE"):
    os.environ[_key] = ""


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_module_caches():
    """Start every test with cold module-level latency caches.

    weather._front (5-min weather front cache) and alert_service._gather_cache
    (5-min positive gather cache) are process-global. Without this, two tests
    using the same coordinates would share answers — a previous test's mocked
    data served as the next test's "live" result.
    """
    def _clear():
        try:
            from backend.api import weather as _w
            _w._front.clear()
        except Exception:
            pass
        try:
            from backend.services import alert_service as _a
            _a._gather_cache.clear()
        except Exception:
            pass
        try:
            from backend.api import map as _map
            _map._alerts_cache.update(at=0.0, value=None)
            _map._grid_cache.update(at=0.0, value=None)
        except Exception:
            pass
        try:
            from backend.adapters import marine_adapter as _mar
            _mar._cache.clear()
        except Exception:
            pass
        try:
            from backend.api import climate as _clim
            _clim._cache.clear()
        except Exception:
            pass
        try:
            from backend.adapters import cap_adapter as _cap
            _cap.reset_shared_cache()
        except Exception:
            pass
        try:
            from backend.services import imd_service as _imd
            _imd.reset_breaker()  # one test's rejected IMD must not skip IMD in the next
        except Exception:
            pass
        try:
            from backend.api import chat as _chat
            _chat._answers.clear()  # a remembered answer must not leak into the next test
        except Exception:
            pass

    _clear()
    yield
    _clear()
