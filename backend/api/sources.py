"""Source-status endpoint — the console's honesty strip. Shows LIVE/CACHED/DEMO/etc. per source."""
import time

from fastapi import APIRouter

from .. import config
from ..adapters import cap_adapter
from ..adapters.registry import CACHED, LIVE, READY, AdapterUnavailable, snapshot
from ..services.location_service import GAZETTEER
from ..services.verdict_service import _is_expired
from ..utils.time import iso_now

router = APIRouter(prefix="/api")

# The landing screen's numbers. Every one is measured, never a marketing
# figure: a count we could not take is null, not zero.
_STATS_TTL_S = 300.0
_alert_count = {"at": 0.0, "value": None}


async def _official_alerts_in_force() -> int | None:
    """In-force alerts across the SACHET feeds the app reads (all-India latest
    + Telangana + Andhra). Cached 5 min: one landing view must not refetch
    every linked CAP file."""
    now = time.monotonic()
    if _alert_count["value"] is not None and now - _alert_count["at"] < _STATS_TTL_S:
        return _alert_count["value"]
    try:
        alerts, prov = await cap_adapter.fetch_alerts()
    except AdapterUnavailable:
        return None
    if prov != LIVE:
        return None  # a cached list is not a count of what is in force now
    value = sum(1 for a in alerts if not _is_expired(a))
    _alert_count.update(at=now, value=value)
    return value


@router.get("/stats")
async def stats() -> dict:
    alerts = await _official_alerts_in_force()
    # snapshot(), not get_status(): a source not yet exercised in this process
    # reports its configured state (READY) only through snapshot().
    status = {s["name"]: s["status"] for s in snapshot()}
    imd, meteo = status.get("imd"), status.get("open-meteo")
    return {
        "official_alerts_in_force": alerts,
        "districts_covered": len(GAZETTEER),
        "languages": ["en", "hi", "te"],
        "alert_check_minutes": max(1, config.ALERT_WATCH_INTERVAL // 60),
        "sources": [
            {"name": "NDMA SACHET", "role": "alerts", "live": alerts is not None},
            {"name": "IMD", "role": "alerts", "live": imd == LIVE},
            {"name": "Open-Meteo", "role": "forecast", "live": meteo in (LIVE, CACHED, READY)},
        ],
        "generated_at": iso_now(),
    }


@router.get("/sources")
async def sources() -> dict:
    return {
        "source_mode": config.current_source_mode(),
        # Demo mode is removed entirely (single IMD-first mode, 2026-09-27).
        "demo_mode": False,
        "sources": snapshot(),
        "needs_keys": {
            "DATAGOV_API_KEY": not bool(config.DATAGOV_API_KEY),
            "OWM_API_KEY": not bool(config.OWM_API_KEY),
            "SARVAM_API_KEY": not bool(config.SARVAM_API_KEY),
            "CAP_FEED_URL": not bool(config.CAP_FEED_URLS),
        },
        "generated_at": iso_now(),
    }
