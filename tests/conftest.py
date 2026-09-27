"""Shared test setup. Runs BEFORE any test module imports backend code.

Isolation: the test suite must never read or write the developer's real runtime
store. Two separate leaks existed here.

1. The emergency relay keeps a message store, and a leftover message id
   surfaced as a false 'duplicate' — the flake this suite already had.
   `EMERGENCY_STORE_FILE` (read directly by emergency_service) fixes that.

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

# Emergency relay keeps its own file, read directly by emergency_service.
os.environ["EMERGENCY_STORE_FILE"] = os.path.join(_TMP, "emergency_store.json")

# Keep the real store out of reach even if something resolves a path before
# SAARTHI_STORE_DIR is consulted.
os.environ.pop("DATABASE_URL", None)
