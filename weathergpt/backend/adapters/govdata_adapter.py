"""data.gov.in adapter — official Indian gov open-data (IMD rainfall/temperature records).

Pattern: https://api.data.gov.in/resource/{resource_id}?api-key={key}&format=json
Needs: DATAGOV_API_KEY + DATAGOV_RESOURCE_ID in env. Without them -> UNCONFIGURED,
never fake data. Fixture helper is DEMO-only and labelled as such.
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx

from .. import config
from .registry import DEMO, ERROR, LIVE, UNCONFIGURED, AdapterUnavailable, report

SOURCE = "data.gov.in"
_FIXTURE = Path(__file__).resolve().parent.parent.parent / "demo" / "fixtures" / "govdata_rainfall.json"


async def fetch_records(limit: int = 10) -> tuple[list[dict], str]:
    key = config.DATAGOV_API_KEY
    resource = config.DATAGOV_RESOURCE_ID
    if not key or not resource:
        report("govdata", UNCONFIGURED, "DATAGOV_API_KEY / DATAGOV_RESOURCE_ID not set")
        raise AdapterUnavailable("data.gov.in unconfigured (needs API key + resource id)")
    url = f"https://api.data.gov.in/resource/{resource}"
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, params={"api-key": key, "format": "json", "limit": limit})
            resp.raise_for_status()
            payload = resp.json()
    except Exception as exc:
        report("govdata", ERROR, f"fetch failed: {type(exc).__name__}")
        raise AdapterUnavailable(f"data.gov.in unreachable: {exc}") from exc
    records = payload.get("records") or []
    report("govdata", LIVE, f"{len(records)} records from {resource}")
    return records, LIVE


def demo_fixture() -> tuple[list[dict], str]:
    """DEMO ONLY — clearly labelled simulated gov-style records."""
    try:
        raw = json.loads(_FIXTURE.read_text(encoding="utf-8"))
        records = raw.get("records") or []
    except Exception:
        records = []
    report("govdata", DEMO, "fixture (demo mode)")
    return records, DEMO
