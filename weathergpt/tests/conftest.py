"""Shared test setup. Runs BEFORE any test module imports backend code.

Isolation: the emergency relay must never read/write the developer's real
runtime store during tests - a leftover message id would otherwise surface
as a false 'duplicate' (exactly the flake this suite had).
"""
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="wgpt_test_stores_")
os.environ["EMERGENCY_STORE_FILE"] = os.path.join(_TMP, "emergency_store.json")
