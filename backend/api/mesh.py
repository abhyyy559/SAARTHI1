"""Mesh gateway endpoints. See services/mesh_service.py for the protocol."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Body

from ..services import mesh_service
from ..utils.time import iso_now

router = APIRouter(prefix="/api/mesh", tags=["mesh"])


@router.get("/key")
async def key() -> dict:
    """The public key phones pin to check alerts the server signed."""
    pub = mesh_service.public_key_der()
    return {"key": mesh_service.public_key_b64(), "node": mesh_service.node_id(pub)}


@router.get("/alerts")
async def alerts(district: str = "Hyderabad", lat: Optional[float] = None, lon: Optional[float] = None) -> dict:
    """The district's official alerts, signed for the phone-to-phone mesh.

    Same admission rules as the app's alert strip: a validated IMD warning, and
    official CAP alerts only (never a commercial provider's).
    """
    from .weather import warnings as _warnings

    data = await _warnings(district=district, lat=lat, lon=lon)
    name = (data.get("location") or {}).get("district") or district
    picked: list[dict[str, Any]] = []
    w = data.get("warning")
    if w and ((data.get("verified") or {}).get("verified")
              or (data.get("verdict") or {}).get("basis") == "unverified_warning"):
        picked.append(w)
    picked += [a for a in data.get("cap_alerts") or [] if a.get("official") is not False]
    messages = [m for m in (mesh_service.alert_message(a, name) for a in picked) if m]
    return {"district": name, "messages": messages, "key": mesh_service.public_key_b64(),
            "generated_at": iso_now()}


@router.post("/relay")
async def relay(body: dict = Body(...)) -> dict:
    """A phone that got online hands over the SOS messages it carried."""
    msgs = body.get("messages")
    if not isinstance(msgs, list):
        return {"accepted": 0, "duplicate": 0, "rejected": [{"id": None, "reason": "messages must be a list"}]}
    return mesh_service.relay(msgs)


@router.get("/sos")
async def sos() -> dict:
    """Open SOS calls that reached the server through any phone."""
    items = mesh_service.incidents()
    return {"incidents": items, "active": sum(1 for i in items if i["status"] == "active"),
            "generated_at": iso_now()}
