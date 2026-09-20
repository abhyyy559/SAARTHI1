"""Persistent source-mode — one line of truth that survives restarts.

WHY THIS EXISTS
---------------
The DEMO/HYBRID/IMD switch used to live only in `config.SOURCE_MODE` (memory).
Every backend restart re-read `.env` (`DEMO_MODE=false` here) and silently
reverted to hybrid — the UI kept believing demo was on and spammed demo
endpoints with 403s. Round 2's demo cannot afford that: the panel, coverage
dashboard and Home's active-alerts section all poll `/api/demo/*` only when
they believe demo is live.

Now the switch is a kv row (`mode:source_mode`) written through the db layer:
JSON file on a laptop, Postgres row on Render. `.env` remains only the
BOOT default when nothing has ever been persisted.

Contract (unchanged for callers): `current_source_mode()`, `DEMO_MODE`,
`SOURCE_MODE`, `IMD_ADAPTER` keep their names and semantics.
"""
from __future__ import annotations

import logging

from . import db
from .store_bridge import run as _db_run
from .. import config

log = logging.getLogger(__name__)

_KEY = "mode:source_mode"
_VALID = frozenset(config.MODE_SOURCES)  # {"demo", "imd", "hybrid"}


def apply_mode(mode: str) -> None:
    """Set the in-memory runtime flags (no persistence). Call after validation."""
    config.SOURCE_MODE = mode
    config.DEMO_MODE = mode == "demo"
    config.IMD_ADAPTER = "demo" if mode == "demo" else "live"


def _restore_sync() -> None:
    """Blocking restore, for callers that have no event loop (scripts, tests).

    NOTE: the server restores via `restore_async()` from `main.lifespan()`.
    Do not wire this to `@app.on_event("startup")`: that app passes a custom
    `lifespan=`, which replaces the default lifespan that invokes startup
    handlers, so the handler would never run and the mode would silently
    revert to .env on every restart.
    """
    try:
        stored = _db_run(db.kv_get(_KEY))
    except Exception as exc:  # noqa: BLE001
        log.warning("mode restore failed (%s); using .env default", exc)
        return
    if isinstance(stored, str) and stored in _VALID and stored != config.SOURCE_MODE:
        apply_mode(stored)
        log.info("restored persisted source mode: %s", stored)


# Restore from an async context. Called from main.lifespan() at startup — the
# only correct place, see the note above.
async def restore_async() -> None:
    stored = await db.kv_get(_KEY)
    if isinstance(stored, str) and stored in _VALID and stored != config.SOURCE_MODE:
        apply_mode(stored)
        log.info("restored persisted source mode: %s", stored)


async def persist_async(mode: str) -> None:
    await db.kv_set(_KEY, mode)
