"""WeatherGPT backend entrypoint."""
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config
from .api import weather, chat, voice, location
from .utils.logging import RequestLoggingMiddleware

app = FastAPI(title="WeatherGPT", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.add_middleware(RequestLoggingMiddleware)

app.include_router(weather.router)
app.include_router(chat.router)
app.include_router(voice.router)
app.include_router(location.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "imd_adapter": config.IMD_ADAPTER, "demo_mode": config.DEMO_MODE}


_frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
if _frontend_dir.exists():
    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="frontend")