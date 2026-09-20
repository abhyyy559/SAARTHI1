"""WeatherGPT backend entrypoint."""
import asyncio
import contextlib
import logging
import time
from pathlib import Path
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from .utils.time import iso_now

from . import config
from .api import (weather, chat, voice, location, sources, climate, advisory, v1,
                  push, demo_alerts, notifications)
from .utils.logging import RequestLoggingMiddleware

log = logging.getLogger("weathergpt.main")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    """Restore the persisted source mode, then start the background alert watcher.

    Push notifications only reach a user who is NOT looking at the app, so the
    decision to notify cannot live in the browser. This task evaluates the
    verdict for every subscribed district on a timer and pushes on a change —
    the same `build_verdict` the UI renders, so the two cannot disagree.
    """
    from .services import alert_watcher, mode_persistence

    # MUST live here, not in an @app.on_event("startup") handler. This app passes
    # a custom `lifespan=`, and that replaces Starlette's default lifespan — the
    # one that invokes on_startup handlers. A restore registered as a startup
    # event was therefore never called: every restart silently re-read .env,
    # reverted DEMO to hybrid, and left the demo panel and coverage dashboard
    # polling /api/demo/* into a wall of 403s.
    try:
        await mode_persistence.restore_async()
        log.info("source mode at startup: %s", config.current_source_mode())
    except Exception as exc:  # noqa: BLE001 - a bad row must not stop the app booting
        log.warning("mode restore skipped: %s", exc)

    interval = int(getattr(config, "ALERT_WATCH_INTERVAL", alert_watcher.DEFAULT_INTERVAL))
    tick = int(getattr(config, "DEMO_TICK", alert_watcher.DEMO_TICK_DEFAULT))
    task = asyncio.create_task(alert_watcher.run_forever(interval, tick))
    log.info("alert watcher task started (lifecycle=%ss, network=%ss)", tick, interval)
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        log.info("alert watcher task stopped")


app = FastAPI(title="WeatherGPT", version="1.0.0", lifespan=lifespan)


def _cors_origins() -> list:
    """Env-driven allowlist + always-on local dev origins."""
    origins = {
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:3000", "http://127.0.0.1:3000",
    }
    for raw in config.FRONTEND_ORIGINS.split(","):
        raw = raw.strip()
        if raw:
            origins.add(raw.rstrip("/"))
    return sorted(origins)


app.add_middleware(CORSMiddleware, allow_origins=_cors_origins(), allow_methods=["*"], allow_headers=["*"])


# Tiny in-memory rate limiter for the public interactive endpoints (chat,
# voice, advisories). No new dependencies; generous enough for a demo, but it
# stops runaway loops. Per-IP sliding window.
_RATE_LIMIT_PATHS = {
    "/api/chat", "/api/chat/query", "/api/v1/chat",
    "/api/voice/transcribe", "/api/voice/synthesize",
    "/api/advisory", "/api/v1/advisories",
}
_RATE_LIMIT_MAX = 120        # requests per window per IP
_RATE_LIMIT_WINDOW = 60.0    # seconds
_rate_hits: dict = {}


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in _RATE_LIMIT_PATHS:
            ip = request.client.host if request.client else "unknown"
            now = time.monotonic()
            window = _rate_hits.setdefault(ip, [])
            cutoff = now - _RATE_LIMIT_WINDOW
            while window and window[0] < cutoff:
                window.pop(0)
            if len(window) >= _RATE_LIMIT_MAX:
                return JSONResponse(
                    status_code=429,
                    content={"detail": f"Too many requests: limit is {_RATE_LIMIT_MAX} "
                                       "per minute per IP for this endpoint. Please slow down and retry."},
                )
            window.append(now)
        return await call_next(request)


app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)

app.include_router(weather.router)
app.include_router(chat.router)
app.include_router(voice.router)
app.include_router(location.router)
app.include_router(sources.router)
app.include_router(climate.router)
app.include_router(advisory.router)
app.include_router(v1.router)
app.include_router(push.router)
app.include_router(demo_alerts.router)
app.include_router(notifications.router)

# Ack/telemetry ingest (Round2 T3.3: POST /api/ack, GET /api/coverage). Guarded
# so a telemetry-only failure can never prevent the app from serving alerts.
try:
    from .api import ack as _ack_api
    app.include_router(_ack_api.router)
except Exception:  # noqa: BLE001 - telemetry must never break alerts
    log.warning("ack router unavailable; /api/ack and /api/coverage disabled")


# NOTE: the DEMO/HYBRID/IMD mode restore deliberately lives in `lifespan()`
# above. It must NOT be re-added as an @app.on_event("startup") handler: this
# app passes a custom `lifespan=`, which replaces the default lifespan that
# invokes those handlers, so such a handler is never called (that is exactly
# how the persisted mode was silently lost on every restart).


def _mode_payload() -> dict:
    """The mode object GET/POST /api/mode share (docs/SOURCE-MODES.md).

    `mode` mirrors `source_mode`; `demo_mode` stays for the call sites and tests
    that already read the boolean. The source strings state which chain actually
    answers, so the banner can name sources, not just the mode.
    """
    mode = config.current_source_mode()
    chains = config.MODE_SOURCES[mode]
    return {
        "mode": mode,
        "source_mode": mode,
        "demo_mode": config.DEMO_MODE,
        "weather_source": chains["weather"],
        "warnings_source": chains["warnings"],
        "available": {"demo": True, "imd": True, "hybrid": True},
    }


# Legacy client compatibility: an old client only knows "live".
_LEGACY_MODE_ALIASES = {"live": "hybrid"}


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "imd_adapter": config.IMD_ADAPTER,
        "demo_mode": config.DEMO_MODE,
        "source_mode": config.current_source_mode(),
    }


@app.get("/api/mode")
async def get_mode() -> dict:
    return _mode_payload()


@app.post("/api/mode")
async def set_mode(payload: dict) -> dict:
    """Runtime DEMO/IMD/HYBRID switch (in-memory). Demo fixtures stay labelled;
    `imd` runs official-only and reports UNAVAILABLE rather than backfilling;
    `hybrid` runs the full multi-source chain. Restart re-reads .env."""
    raw = (payload or {}).get("mode")
    mode = _LEGACY_MODE_ALIASES.get(raw, raw) if isinstance(raw, str) else None
    if mode not in config.MODE_SOURCES:
        return {"ok": False,
                "error": "mode must be 'demo', 'imd' or 'hybrid' (legacy 'live' = 'hybrid')"}
    config.SOURCE_MODE = mode
    config.DEMO_MODE = mode == "demo"  # derived, kept in sync
    config.IMD_ADAPTER = "demo" if mode == "demo" else "live"
    # Persist so restarts/redeploys keep the mode (kv row via the db layer).
    try:
        from .services.mode_persistence import persist_async
        await persist_async(mode)
    except Exception as exc:  # noqa: BLE001
        logging.getLogger(__name__).warning("mode persist failed: %s", exc)
    return {"ok": True, **_mode_payload()}


@app.websocket("/ws/warnings")
async def ws_warnings(websocket: WebSocket):
    """Live warning push (§26). Sends snapshot on connect, then refreshes. Demo-safe."""
    from .services.imd_service import IMDService
    from .services.validation_service import ValidationService
    from .services.verdict_service import build_verdict

    await websocket.accept()
    imd = IMDService()
    try:
        while True:
            try:
                w = await imd.get_district_warning("Hyderabad")
                verified = ValidationService(imd).validate_warning(w, "Hyderabad") if w else None
                warning_d = w.model_dump(mode="json") if w else None
                verified_d = verified.model_dump(mode="json") if verified else None
                payload = {
                    "type": "warning_snapshot",
                    "warning": warning_d,
                    "verified": verified_d,
                    # Same authoritative verdict the HTTP endpoints emit, so the
                    # pushed snapshot can never be read as a calm by itself.
                    "verdict": build_verdict(
                        verified=verified_d, warning=warning_d,
                        warning_service_available=bool(w),
                    ),
                    "generated_at": iso_now(),
                }
            except Exception as exc:
                payload = {
                    "type": "warning_snapshot", "status": "unavailable", "detail": str(exc),
                    "verdict": build_verdict(warning_service_available=False),
                }
            await websocket.send_json(payload)
            await asyncio.sleep(20)
    except WebSocketDisconnect:
        return


_react_dist = Path(__file__).resolve().parent.parent / "frontend-react" / "dist"
_frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
# Prefer the React trust-console build; fall back to the legacy static frontend.
_serve_dir = _react_dist if _react_dist.exists() else _frontend_dir
if _serve_dir.exists():
    app.mount("/", StaticFiles(directory=_serve_dir, html=True), name="frontend")