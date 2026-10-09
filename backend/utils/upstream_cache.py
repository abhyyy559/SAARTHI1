"""Short-lived memo for upstream fetches (Open-Meteo, SACHET, the alert chain).

Why: one screen load asks the same upstream question several times at once —
Home's weather card and hero both want current weather, and the store, hero,
active-alerts list and alert pill all want the warnings, which the pill re-asks
every 30 s. Each warnings request fetched SACHET, WeatherInTouch and GDACS
afresh (2-3 s on a good line, 20 s on a bad one), so requests piled up past the
app's timeout and the screens showed "not available".

The window is far shorter than the sources' own update cadence (Open-Meteo
model steps are 15 min, CAP bulletins are issued on the scale of hours), so an
answer served from here is as live as the source itself. Failures are never
memoized: the next request tries the source again.

Callers get a deep copy every time: alert dicts are tagged per request
(relevance, provenance), and a shared object would leak one district's tags
into another's answer.

UPSTREAM_CACHE_SECONDS=0 turns it off (the test suite does, for determinism).
"""
from __future__ import annotations

import asyncio
import copy
import os
import time
from typing import Any, Awaitable, Callable

_store: dict[Any, tuple[float, Any]] = {}
_inflight: dict[Any, "asyncio.Future[Any]"] = {}


def _enabled() -> bool:
    try:
        return float(os.environ.get("UPSTREAM_CACHE_SECONDS", "1")) > 0
    except ValueError:
        return True


async def remember(key: Any, ttl: float, fetch: Callable[[], Awaitable[Any]],
                   keep: Callable[[Any], bool] | None = None) -> Any:
    """Return a copy of a fresh memoized result for `key`, else fetch it once.

    Concurrent callers with the same key share one fetch. An exception from
    `fetch` propagates to every waiter and nothing is stored; nor is a result
    `keep` rejects (e.g. a CACHED fallback, which must not outlive the outage).
    """
    if not _enabled():
        return await fetch()
    now = time.monotonic()
    hit = _store.get(key)
    if hit and hit[0] > now:
        return copy.deepcopy(hit[1])
    pending = _inflight.get(key)
    if pending is None:
        async def _run():
            value = await fetch()
            if keep is None or keep(value):
                _store[key] = (time.monotonic() + ttl, copy.deepcopy(value))
            return value

        pending = asyncio.ensure_future(_run())
        _inflight[key] = pending
        pending.add_done_callback(lambda _f, k=key: _inflight.pop(k, None))
    value = await asyncio.shield(pending)
    return copy.deepcopy(value)


def clear() -> None:
    _store.clear()
