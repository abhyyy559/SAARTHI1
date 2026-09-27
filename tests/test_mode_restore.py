"""The persisted IMD/HYBRID source mode must survive a restart.

Demo mode was removed (2026-09-23), so the persisted values that matter are
"imd" and "hybrid" — and a stale legacy "demo" row must be IGNORED, never
resurrected, because the fixture data behind it no longer exists.

These tests exercise the real lifespan, not the helper: the restore is
wired to the custom lifespan() in main.py (a restore registered with
@app.on_event("startup") would silently never run, since a custom lifespan
replaces Starlette's default one).
"""
import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.services import db, mode_persistence


@pytest.fixture
def isolated_store(tmp_path, monkeypatch):
    """Keep the mode row out of the developer's real store."""
    monkeypatch.setattr(db, "_json_path", lambda name: tmp_path / name)
    return tmp_path


@pytest.fixture
def boot_hybrid(monkeypatch):
    """Boot state as .env defines it: hybrid, so a restore is observable."""
    monkeypatch.setattr(config, "SOURCE_MODE", "hybrid", raising=False)
    monkeypatch.setattr(config, "IMD_ADAPTER", "live", raising=False)


def test_lifespan_restores_persisted_imd_mode(isolated_store, boot_hybrid):
    """Start the app for real: the persisted 'imd' must win over .env."""
    import asyncio

    asyncio.run(mode_persistence.persist_async("imd"))
    assert config.current_source_mode() == "hybrid"  # nothing restored yet

    from backend.main import app

    with TestClient(app):
        assert config.current_source_mode() == "imd"
        assert config.IMD_ADAPTER == "live"


def test_persisted_legacy_demo_value_is_ignored(isolated_store, boot_hybrid):
    """A stale 'demo' row must never resurrect demo mode — the fixtures are gone."""
    import asyncio

    asyncio.run(mode_persistence.persist_async("demo"))

    from backend.main import app

    with TestClient(app):
        assert config.current_source_mode() == "hybrid"


def test_lifespan_leaves_hybrid_alone(isolated_store, boot_hybrid):
    """With nothing persisted, .env stays the boot default — no invented mode."""
    import asyncio

    asyncio.run(db.kv_set("mode:source_mode", "hybrid"))

    from backend.main import app

    with TestClient(app):
        assert config.current_source_mode() == "hybrid"


def test_invalid_persisted_value_is_ignored(isolated_store, boot_hybrid):
    """A corrupt row must not put the app into a mode that does not exist."""
    import asyncio

    asyncio.run(db.kv_set("mode:source_mode", "banana"))

    from backend.main import app

    with TestClient(app):
        assert config.current_source_mode() == "hybrid"


def test_restore_is_not_registered_as_a_startup_event():
    """Guard the trap: a restore wired to on_event would silently never run.

    The app passes `lifespan=`, which replaces Starlette's default lifespan and
    therefore its on_startup invocation.
    """
    from backend.main import app

    handlers = [getattr(h, "__name__", str(h)) for h in app.router.on_startup]
    assert not any("restore" in name.lower() for name in handlers), handlers
