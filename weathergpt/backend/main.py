"""WeatherGPT backend entrypoint."""
import asyncio
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .utils.time import iso_now

from . import config
from .api import weather, chat, voice, location, sources, climate, advisory, v1
from .utils.logging import RequestLoggingMiddleware

app = FastAPI(title="WeatherGPT", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.add_middleware(RequestLoggingMiddleware)

app.include_router(weather.router)
app.include_router(chat.router)
app.include_router(voice.router)
app.include_router(location.router)
app.include_router(sources.router)
app.include_router(climate.router)
app.include_router(advisory.router)
app.include_router(v1.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "imd_adapter": config.IMD_ADAPTER, "demo_mode": config.DEMO_MODE}


@app.websocket("/ws/warnings")
async def ws_warnings(websocket: WebSocket):
    """Live warning push (§26). Sends snapshot on connect, then refreshes. Demo-safe."""
    from .services.imd_service import IMDService
    from .services.validation_service import ValidationService

    await websocket.accept()
    imd = IMDService()
    try:
        while True:
            try:
                w = await imd.get_district_warning("Hyderabad")
                verified = ValidationService(imd).validate_warning(w, "Hyderabad") if w else None
                payload = {
                    "type": "warning_snapshot",
                    "warning": w.model_dump(mode="json") if w else None,
                    "verified": verified.model_dump(mode="json") if verified else None,
                    "generated_at": iso_now(),
                }
            except Exception as exc:
                payload = {"type": "warning_snapshot", "status": "unavailable", "detail": str(exc)}
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