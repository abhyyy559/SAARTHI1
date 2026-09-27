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
                  push, notifications, aviation)
from .utils.logging import RequestLoggingMiddleware

log = logging.getLogger("weathergpt.main")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the background alert watcher and warm the SACHET CAP cache.

    Push notifications only reach a user who is NOT looking at the app, so the
    decision to notify cannot live in the browser. This task evaluates the
    verdict for every subscribed district on a timer and pushes on a change —
    the same `build_verdict` the UI renders, so the two cannot disagree.
    """
    from .services import alert_watcher

    interval = int(getattr(config, "ALERT_WATCH_INTERVAL", alert_watcher.DEFAULT_INTERVAL))
    tick = int(getattr(config, "WATCH_TICK", alert_watcher.WATCH_TICK_DEFAULT))
    task = asyncio.create_task(alert_watcher.run_forever(interval, tick))
    log.info("alert watcher task started (lifecycle=%ss, network=%ss)", tick, interval)

    # Warm the SACHET CAP cache in the background: a cold fetch fans out to
    # ~30 linked CAP documents and can take tens of seconds, so the first
    # visitor after a deploy must not pay for it. fetch_alerts caches on
    # success; until the warmup lands, requests fetch live (slow once).
    async def _warm_cap_cache() -> None:
        try:
            from .adapters import cap_adapter
            await cap_adapter.fetch_alerts()
            log.info("CAP cache warmed")
        except Exception as exc:  # noqa: BLE001 - warmup is best-effort
            log.info("CAP cache warmup skipped: %s", exc)

    warmup = asyncio.create_task(_warm_cap_cache())
    try:
        yield
    finally:
        warmup.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await warmup
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
    "/api/chat", "/api/chat/query", "/api/chat/stream", "/api/v1/chat",
    "/api/voice/transcribe", "/api/voice/synthesize", "/api/voice/synthesize-stream",
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
app.include_router(notifications.router)
app.include_router(aviation.router)

# Ack/telemetry ingest (Round2 T3.3: POST /api/ack, GET /api/coverage). Guarded
# so a telemetry-only failure can never prevent the app from serving alerts.
try:
    from .api import ack as _ack_api
    app.include_router(_ack_api.router)
except Exception:  # noqa: BLE001 - telemetry must never break alerts
    log.warning("ack router unavailable; /api/ack and /api/coverage disabled")


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "source_mode": "imd",
    }


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