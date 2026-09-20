"""Persistent storage — one interface, two backends, chosen by env.

WHY THIS EXISTS
---------------
Every durable thing SAARTHI writes (demo alerts, notification log, delivery
ledger, push subscriptions, community reports, watcher state) used to live in a
JSON file next to the cache. On a laptop that is fine. On Render/Vercel the
filesystem is EPHEMERAL: every deploy or restart wiped every alert, every
acknowledgement, every subscription — the jury's coverage dashboard forgot the
demo, and "notify exactly once" forgot it had notified.

This module gives every store the SAME interface with a backend chosen once:

  DATABASE_URL set  -> PostgreSQL via asyncpg (survives deploys, restarts,
                       multiple workers). Tables auto-create on first use; no
                       manual migration step.
  DATABASE_URL unset-> JSON files (exactly the old behaviour), so a laptop demo
                       or CI run needs zero infrastructure.

RULES
-----
- The JSON fallback must never break: a hackathon demo with no DB is a valid
  deployment, not a degraded one.
- Postgres failures degrade to the JSON store with a one-time warning, never an
  exception through a request path — a cache/store outage must not 500 the app.
- Values are JSON documents everywhere, so a store can migrate from file to DB
  without changing its schema or its callers.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .. import config

log = logging.getLogger("weathergpt.db")

_BACKEND: str | None = None          # "postgres" | "json" (resolved once)
_POOL: Any = None                    # asyncpg.Pool when backend == postgres
_INIT_LOCK = asyncio.Lock()
_PG_WARNED = False


def database_url() -> str:
    """DATABASE_URL from env, with local Reander/Render URL quirks tolerated."""
    url = os.environ.get("DATABASE_URL", "") or getattr(config, "DATABASE_URL", "")
    return (url or "").strip()


def backend_name() -> str:
    """'postgres' when a URL is configured and the driver exists, else 'json'."""
    global _BACKEND
    if _BACKEND is None:
        if database_url() and _driver_available():
            _BACKEND = "postgres"
        else:
            _BACKEND = "json"
    return _BACKEND


def _driver_available() -> bool:
    try:
        import asyncpg  # noqa: F401
        return True
    except ImportError:
        return False


def _ssl_options(url: str) -> dict[str, Any]:
    """Render/Heroku-style URLs need TLS but often ship a non-verifyable cert."""
    host = (urlsplit(url).hostname or "").lower()
    if host in ("localhost", "127.0.0.1", "::1"):
        return {}
    return {"ssl": "require"}


async def _get_pool():
    """The asyncpg pool, created once. Returns None on any failure (JSON mode)."""
    global _POOL, _PG_WARNED
    if _POOL is not None:
        return _POOL
    if backend_name() != "postgres":
        return None
    async with _INIT_LOCK:
        if _POOL is not None:
            return _POOL
        try:
            import asyncpg

            url = database_url()
            # asyncpg wants the plain postgres:// scheme normalized.
            if url.startswith("postgres://"):
                url = "postgresql://" + url[len("postgres://"):]
            _POOL = await asyncpg.create_pool(
                url, min_size=1, max_size=5, command_timeout=10,
                **_ssl_options(url),
            )
            await _ensure_schema(_POOL)
            log.info("database backend: postgres (%s)", _mask(url))
        except Exception as exc:  # noqa: BLE001 - degrade, never crash startup
            _POOL = None
            _BACKEND = "json"
            if not _PG_WARNED:
                _PG_WARNED = True
                log.warning("DATABASE_URL set but unusable (%s: %s) - falling back to JSON stores",
                            type(exc).__name__, exc)
        return _POOL


def _mask(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.hostname or '?'}{('/' + (parts.path or '').lstrip('/')) if parts.path else ''}"


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
# One document table per concern, all auto-created. `kv` covers watcher state
# and misc singletons; the rest are the stores' own namespaces.

_SCHEMA = """
CREATE TABLE IF NOT EXISTS saarthi_kv (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saarthi_docs (
  ns TEXT NOT NULL,
  id TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ns, id)
);
CREATE TABLE IF NOT EXISTS saarthi_log (
  ns TEXT NOT NULL,
  id TEXT NOT NULL,
  value JSONB NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ns, id)
);
CREATE INDEX IF NOT EXISTS idx_saarthi_log_ns_at ON saarthi_log (ns, at DESC);
"""


async def _ensure_schema(pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(_SCHEMA)


async def health() -> dict[str, Any]:
    """Backend report for /api/v1/system/status. Never raises."""
    try:
        if backend_name() == "postgres":
            pool = await _get_pool()
            if pool is None:
                return {"backend": "json", "reason": "postgres unavailable - JSON fallback"}
            async with pool.acquire() as conn:
                v = await conn.fetchval("SELECT 1")
            return {"backend": "postgres", "reachable": v == 1}
    except Exception as exc:  # noqa: BLE001
        return {"backend": "json", "reason": f"{type(exc).__name__}: {exc}"}
    return {"backend": "json"}


# ---------------------------------------------------------------------------
# Key-value (watcher state, mode singletons, seeded markers)
# ---------------------------------------------------------------------------

async def kv_get(key: str) -> Any | None:
    pool = await _get_pool()
    if pool is None:
        return _json_kv_get(key)
    try:
        async with pool.acquire() as conn:
            raw = await conn.fetchval("SELECT value FROM saarthi_kv WHERE key = $1", key)
        return json.loads(raw) if raw is not None else None
    except Exception as exc:  # noqa: BLE001
        log.warning("kv_get(%s) failed: %s", key, exc)
        return _json_kv_get(key)


async def kv_set(key: str, value: Any) -> None:
    pool = await _get_pool()
    if pool is None:
        _json_kv_set(key, value)
        return
    try:
        raw = json.dumps(value, default=str, ensure_ascii=False)
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO saarthi_kv (key, value) VALUES ($1, $2)"
                " ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()",
                key, raw,
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("kv_set(%s) failed: %s", key, exc)
        _json_kv_set(key, value)


async def kv_delete(key: str) -> None:
    pool = await _get_pool()
    if pool is None:
        for name in (_kv_filename(key), f"kv_{key}.json"):
            try:
                _json_path(name).unlink(missing_ok=True)
            except Exception:  # noqa: BLE001 - a row we cannot delete is not fatal
                pass
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM saarthi_kv WHERE key = $1", key)
    except Exception as exc:  # noqa: BLE001
        log.warning("kv_delete(%s) failed: %s", key, exc)


# JSON fallback for kv: one file per key beside the cache.
_KV_DIR = None

# Keys are logical names and may contain characters that are illegal in a
# filename. `mode:source_mode` is the one that bit us: on Windows a ':' inside a
# path is not a filename at all, it starts an NTFS ALTERNATE DATA STREAM. The
# write "succeeds", the value even round-trips in-process, but no ordinary file
# appears — so the row is invisible to directory listings, backups, git and
# OneDrive sync, and a restart can come back with the old value. Sanitising the
# key keeps every kv row a real file on every platform.
_KV_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _kv_filename(key: str) -> str:
    """Filesystem-safe filename for a kv key (stable, and readable when debugging)."""
    safe = _KV_UNSAFE.sub("_", str(key)).strip("._") or "key"
    return f"kv_{safe}.json"


def _json_path(name: str) -> Path:
    """Where one JSON row lives.

    `SAARTHI_STORE_DIR` relocates the WHOLE store directory. That is the single
    switch the test suite needs: every kv row, document and log moves together,
    so a test can never write to — or reset — the developer's real demo alerts,
    notification log or delivery ledger.

    The old per-store variables (DEMO_ALERT_STORE_FILE, NOTIFICATION_STORE_FILE,
    DELIVERY_STORE_FILE) were set by tests/conftest.py but read by nothing, so
    the isolation they promised did not exist: a plain `pytest` run cleared the
    real stores. Only EMERGENCY_STORE_FILE was ever honoured, and it still is
    (emergency_service reads it directly).
    """
    override = os.environ.get("SAARTHI_STORE_DIR", "").strip()
    if override:
        return Path(override) / name
    return Path(getattr(config, "CACHE_FILE", "weathergpt_cache.json")).parent / "store" / name


def _json_kv_get(key: str) -> Any | None:
    candidates = [_kv_filename(key)]
    raw_name = f"kv_{key}.json"
    if raw_name not in candidates:  # pre-sanitise rows written via the ADS path
        candidates.append(raw_name)
    for name in candidates:
        try:
            return json.loads(_json_path(name).read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 - missing/unreadable row just means "unset"
            continue
    return None


def _json_kv_set(key: str, value: Any) -> None:
    # A silently-dropped write is how the persisted mode went missing for a whole
    # session, so a failure here is logged rather than swallowed.
    try:
        p = _json_path(_kv_filename(key))
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(value, default=str, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        log.warning("kv_set(%s) could not be persisted: %s", key, exc)


# ---------------------------------------------------------------------------
# Documents (alert store, ledger): namespace + id -> JSON document
# ---------------------------------------------------------------------------

async def doc_put(ns: str, doc_id: str, value: dict[str, Any]) -> None:
    pool = await _get_pool()
    if pool is None:
        data = _json_doc_all(ns)
        data[doc_id] = value
        _json_doc_write(ns, data)
        return
    try:
        raw = json.dumps(value, default=str, ensure_ascii=False)
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO saarthi_docs (ns, id, value) VALUES ($1, $2, $3)"
                " ON CONFLICT (ns, id) DO UPDATE SET value = $3, updated_at = now()",
                ns, doc_id, raw,
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("doc_put(%s/%s) failed: %s", ns, doc_id, exc)
        data = _json_doc_all(ns)
        data[doc_id] = value
        _json_doc_write(ns, data)


async def doc_get(ns: str, doc_id: str) -> dict[str, Any] | None:
    pool = await _get_pool()
    if pool is None:
        return _json_doc_all(ns).get(doc_id)
    try:
        async with pool.acquire() as conn:
            raw = await conn.fetchval("SELECT value FROM saarthi_docs WHERE ns = $1 AND id = $2", ns, doc_id)
        return json.loads(raw) if raw is not None else None
    except Exception as exc:  # noqa: BLE001
        log.warning("doc_get(%s/%s) failed: %s", ns, doc_id, exc)
        return _json_doc_all(ns).get(doc_id)


async def doc_all(ns: str) -> dict[str, dict[str, Any]]:
    pool = await _get_pool()
    if pool is None:
        return _json_doc_all(ns)
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT id, value FROM saarthi_docs WHERE ns = $1", ns)
        return {r["id"]: json.loads(r["value"]) for r in rows}
    except Exception as exc:  # noqa: BLE001
        log.warning("doc_all(%s) failed: %s", ns, exc)
        return _json_doc_all(ns)


async def doc_delete(ns: str, doc_id: str) -> None:
    pool = await _get_pool()
    if pool is None:
        data = _json_doc_all(ns)
        data.pop(doc_id, None)
        _json_doc_write(ns, data)
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM saarthi_docs WHERE ns = $1 AND id = $2", ns, doc_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("doc_delete(%s/%s) failed: %s", ns, doc_id, exc)


async def doc_clear(ns: str) -> None:
    pool = await _get_pool()
    if pool is None:
        _json_doc_write(ns, {})
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM saarthi_docs WHERE ns = $1", ns)
    except Exception as exc:  # noqa: BLE001
        log.warning("doc_clear(%s) failed: %s", ns, exc)


# JSON fallback for docs: one file per namespace.
def _json_doc_all(ns: str) -> dict[str, dict[str, Any]]:
    try:
        data = json.loads(_json_path(f"docs_{ns}.json").read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _json_doc_write(ns: str, data: dict[str, Any]) -> None:
    try:
        p = _json_path(f"docs_{ns}.json")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, default=str, ensure_ascii=False), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------------------
# Append log (notification log): append-mostly, capped, listed newest-first
# ---------------------------------------------------------------------------

async def log_append(ns: str, entry_id: str, value: dict[str, Any]) -> None:
    """Upsert one entry by id. Read receipts rewrite an existing id — that must
    UPDATE the entry, not append a duplicate (Postgres path and JSON path both)."""
    pool = await _get_pool()
    try:
        if pool is not None:
            raw = json.dumps(value, default=str, ensure_ascii=False)
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO saarthi_log (ns, id, value) VALUES ($1, $2, $3)"
                    " ON CONFLICT (ns, id) DO UPDATE SET value = $3, at = now()",
                    ns, entry_id, raw,
                )
            return
    except Exception as exc:  # noqa: BLE001
        log.warning("log_append(%s/%s) failed: %s", ns, entry_id, exc)
    # JSON fallback (also the degradation path for a failed DB write).
    items = _json_log_all(ns)
    items = [e for e in items if e.get("_id") != entry_id]
    items.append({**value, "_id": entry_id})
    _json_log_write(ns, items[-500:])


async def log_all(ns: str) -> list[dict[str, Any]]:
    """Entries for a namespace, oldest-first, each carrying its id as `_id`."""
    pool = await _get_pool()
    if pool is None:
        return _json_log_all(ns)
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, value FROM saarthi_log WHERE ns = $1 ORDER BY at ASC", ns)
        out = []
        for r in rows:
            item = json.loads(r["value"])
            item["_id"] = r["id"]
            out.append(item)
        return out
    except Exception as exc:  # noqa: BLE001
        log.warning("log_all(%s) failed: %s", ns, exc)
        return _json_log_all(ns)


async def log_clear(ns: str) -> None:
    pool = await _get_pool()
    if pool is None:
        _json_log_write(ns, [])
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM saarthi_log WHERE ns = $1", ns)
    except Exception as exc:  # noqa: BLE001
        log.warning("log_clear(%s) failed: %s", ns, exc)


def _json_log_all(ns: str) -> list[dict[str, Any]]:
    try:
        data = json.loads(_json_path(f"log_{ns}.json").read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _json_log_write(ns: str, items: list[dict[str, Any]]) -> None:
    try:
        p = _json_path(f"log_{ns}.json")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(items, default=str, ensure_ascii=False), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
