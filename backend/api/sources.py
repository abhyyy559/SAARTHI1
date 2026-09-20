"""Source-status endpoint — the console's honesty strip. Shows LIVE/CACHED/DEMO/etc. per source."""
from fastapi import APIRouter

from .. import config
from ..adapters.registry import snapshot
from ..utils.time import iso_now

router = APIRouter(prefix="/api")


@router.get("/sources")
async def sources() -> dict:
    return {
        "source_mode": config.current_source_mode(),
        "demo_mode": config.DEMO_MODE,
        "sources": snapshot(),
        "needs_keys": {
            "DATAGOV_API_KEY": not bool(config.DATAGOV_API_KEY),
            "OWM_API_KEY": not bool(config.OWM_API_KEY),
            "SARVAM_API_KEY": not bool(config.SARVAM_API_KEY),
            "CAP_FEED_URL": not bool(config.CAP_FEED_URL),
        },
        "generated_at": iso_now(),
    }
