"""Sync bridge over the async db layer.

WHY
---
The stores (demo alerts, notifications, delivery ledger, push subscriptions)
have synchronous APIs used from both sync service code and async endpoints.
Rewriting every caller to async is risk without reward; instead every store
keeps its sync signature and calls `run(db.coro())`, which executes the
coroutine on a dedicated background loop and waits for the result.

CONCURRENCY MODEL (read this before "simplifying")
--------------------------------------------------
The bridge loop runs on its own daemon thread. `run()` submits the coroutine
there with `asyncio.run_coroutine_threadsafe(...).result()` — which BLOCKS the
calling thread until the bridge finishes. That is safe from every thread,
including event-loop threads (endpoints, watcher, TestClient portal): the
future completes on the BRIDGE loop, so the calling loop is stalled for the
duration of one store operation (milliseconds) but never deadlocked.

The one impossible case is the bridge thread calling `run()` itself — blocking
on your own queue is a genuine deadlock — so that is detected and raised as
the programming error it is.

Postgres I/O happens through the asyncpg pool on the bridge loop; the JSON
fallback is plain file I/O. Either way the caller sees a plain return value.
"""
from __future__ import annotations

import asyncio
import threading
from typing import Any, Coroutine

_loop: asyncio.AbstractEventLoop | None = None
_loop_lock = threading.Lock()
_bridge_thread: threading.Thread | None = None


def _get_loop() -> asyncio.AbstractEventLoop:
    global _loop, _bridge_thread
    if _loop is None or _loop.is_closed():
        with _loop_lock:
            if _loop is None or _loop.is_closed():
                new = asyncio.new_event_loop()

                def _run() -> None:
                    asyncio.set_event_loop(new)
                    new.run_forever()

                t = threading.Thread(target=_run, name="saarthi-db-bridge", daemon=True)
                t.start()
                _loop = new
                _bridge_thread = t
    return _loop


def run(coro: Coroutine[Any, Any, Any]) -> Any:
    """Run one db coroutine to completion and return its result.

    Thread-safe. Safe to call from sync service code, from async endpoint
    handlers, and from the watcher's loop — see the concurrency note above.
    """
    if _bridge_thread is not None and threading.current_thread() is _bridge_thread:
        raise RuntimeError(
            "store_bridge.run() called from the bridge thread itself - this "
            "would deadlock. Store functions must be called from other threads.")
    return asyncio.run_coroutine_threadsafe(coro, _get_loop()).result()


def close() -> None:
    """Stop the bridge loop (tests / shutdown)."""
    global _loop
    if _loop is not None and not _loop.is_closed():
        _loop.call_soon_threadsafe(_loop.stop)
