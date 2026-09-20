"""The persisted DEMO/HYBRID/IMD mode must survive a restart.

This is the bug that made the whole demo panel look broken: the mode was
persisted correctly, but nothing read it back at startup, so every restart
re-read `.env` (`DEMO_MODE=false`) and came up in hybrid. The UI kept believing
demo was on and polled `/api/demo/*` into a wall of 403s.

Root cause: the restore was registered with `@app.on_event("startup")`, but the
app passes a custom `lifespan=`. In Starlette a custom lifespan REPLACES the
default lifespan — the one that invokes `on_startup` handlers — so the handler
was never called. These tests exercise the real lifespan, not the helper.
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
    monkeypatch.setattr(config, "DEMO_MODE", False, raising=False)
    monkeypatch.setattr(config, "IMD_ADAPTER", "live", raising=False)


def test_lifespan_restores_persisted_demo_mode(isolated_store, boot_hybrid):
    """Start the app for real: the persisted 'demo' must win over .env."""
    import asyncio

    asyncio.run(mode_persistence.persist_async("demo"))
    assert config.current_source_mode() == "hybrid"  # nothing restored yet

    from backend.main import app

    with TestClient(app):
        assert config.current_source_mode() == "demo"
        assert config.DEMO_MODE is True
        assert config.IMD_ADAPTER == "demo"


def test_demo_endpoints_open_after_restore(isolated_store, boot_hybrid):
    """The user-visible consequence: /api/demo/* stops 403-ing."""
    import asyncio

    asyncio.run(mode_persistence.persist_async("demo"))

    from backend.main import app

    with TestClient(app) as c:
        assert c.get("/api/demo/alerts").status_code == 200
        assert c.get("/api/health").json()["source_mode"] == "demo"


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
