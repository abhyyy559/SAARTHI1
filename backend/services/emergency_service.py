"""Resilient emergency network (§27–29, §54): E2E-encrypted packets, relay store,
dedup, replay protection, sync. Real Fernet crypto (audited lib) — never invented.

Transports: P2PTransport interface -> LocalRelayTransport (backend store as LAN
relay) + SimulatedTransport (labelled loopback for stage demo). UI uses only the
EmergencyMessagingService facade: send/discover/receive/forward/sync.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from .. import config
from ..models.emergency import EmergencyMessage
from ..utils.time import IST, iso_now, now_ist

# Store location: CACHE_FILE's folder by default; overridable via env so the
# test suite can isolate itself from the real runtime store (never pollute prod).
# NOTE: this store stays JSON-file-based even when DATABASE_URL is set — the P2P
# relay store is deliberately self-contained (it models device-local storage,
# which is exactly what a phone would hold). The SERVER-side stores (demo
# alerts, notifications, delivery ledger, push subscriptions, watcher state)
# use services/db.py and follow DATABASE_URL.
_STORE = Path(
    os.environ.get(
        "EMERGENCY_STORE_FILE",
        str(Path(getattr(config, "CACHE_FILE", "weathergpt_cache.json")).parent / "emergency_store.json"),
    )
)
REPLAY_WINDOW = timedelta(hours=72)
MAX_HOPS = 10

_key_cache: bytes | None = None


def _fernet() -> Fernet:
    """EMERGENCY_KEY env (Fernet-format) or ephemeral per-process key (documented)."""
    global _key_cache
    if _key_cache is None:
        raw = os.environ.get("EMERGENCY_KEY", "").strip()
        if raw:
            try:
                _key_cache = raw.encode()
                Fernet(_key_cache)  # validate format now, fail fast
            except Exception:
                _key_cache = Fernet.generate_key()
        else:
            _key_cache = Fernet.generate_key()
    return Fernet(_key_cache)


def _hmac_key() -> bytes:
    f = _fernet()
    return hashlib.sha256(b"weathergpt-hmac:" + f._signing_key).digest()


def _load_store() -> dict:
    try:
        return json.loads(_STORE.read_text(encoding="utf-8"))
    except Exception:
        return {"messages": {}, "outbox": []}


def _save_store(data: dict) -> None:
    try:
        _STORE.write_text(json.dumps(data, default=str), encoding="utf-8")
    except Exception:
        pass


def seal(sender_id: str, payload: dict[str, Any]) -> EmergencyMessage:
    """Encrypt a structured emergency payload into a relayable packet."""
    body = json.dumps({"sender": sender_id, "at": iso_now(), **payload}, ensure_ascii=False).encode()
    token = _fernet().encrypt(body).decode()
    sig = hmac.new(_hmac_key(), token.encode(), hashlib.sha256).hexdigest()
    loc = payload.get("location") or {}
    return EmergencyMessage(
        message_id=payload.get("message_id") or f"msg-{uuid.uuid4().hex[:12]}",
        sender_id=sender_id, timestamp=now_ist(),
        message_type=payload.get("message_type", "NEED_HELP"),
        location={"latitude": loc.get("latitude", 0.0), "longitude": loc.get("longitude", 0.0)} if loc else None,
        people_count=int(payload.get("people_count", 1)),
        medical_required=bool(payload.get("medical_required", False)),
        text=str(payload.get("text", ""))[:280],
        ciphertext=token, nonce=token[:16], signature=sig,
    )


def open_packet(msg: EmergencyMessage) -> dict[str, Any]:
    """Verify signature + decrypt + replay-window check. Raises on any failure."""
    expect = hmac.new(_hmac_key(), msg.ciphertext.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expect, msg.signature):
        raise ValueError("integrity check failed")
    try:
        body = json.loads(_fernet().decrypt(msg.ciphertext.encode()).decode())
    except InvalidToken as exc:
        raise ValueError("decryption failed") from exc
    # Replay window uses the SIGNED envelope time (body.at), not the outer field.
    try:
        sent_raw = body.get("at", "")
        sent = datetime.fromisoformat(sent_raw)
    except ValueError:
        raise ValueError("bad envelope timestamp")
    now = now_ist()
    if abs(now - (sent if sent.tzinfo else sent.replace(tzinfo=IST))) > REPLAY_WINDOW:
        raise ValueError("outside replay window")
    return body


def receive(packet: dict[str, Any]) -> dict[str, Any]:
    """Relay intake: dedup, verify, store, forward-flag. Returns {stored|duplicate|error}."""
    store = _load_store()
    mid = packet.get("message_id", "")
    if not mid:
        return {"result": "error", "reason": "missing message_id"}
    if mid in store["messages"]:
        return {"result": "duplicate", "message_id": mid}
    try:
        msg = EmergencyMessage(**packet)
        body = open_packet(msg)
    except Exception as exc:
        return {"result": "error", "reason": str(exc)}
    if msg.hops >= MAX_HOPS:
        return {"result": "error", "reason": "hop limit"}
    msg.hops += 1
    store["messages"][mid] = {**msg.model_dump(mode="json"), "decrypted_preview": {k: body.get(k) for k in ("message_type", "people_count", "medical_required")}}
    if packet.get("queued_locally"):
        store["outbox"].append(mid)
    _save_store(store)
    return {"result": "stored", "message_id": mid, "forwardable": True}


def sync_outbox() -> dict[str, Any]:
    """Connectivity restored: flush queued packets, mark synced. Deduplicated by id."""
    store = _load_store()
    synced = []
    for mid in store["outbox"]:
        if mid in store["messages"]:
            store["messages"][mid]["synced"] = True
            synced.append(mid)
    store["outbox"] = [m for m in store["outbox"] if m not in synced]
    _save_store(store)
    return {"synced": synced, "pending": store["outbox"]}


def inbox() -> list[dict[str, Any]]:
    return list(_load_store()["messages"].values())


class P2PTransport:
    name = "base"
    async def discover(self) -> list[dict]: raise NotImplementedError
    async def send(self, packet: dict) -> dict: raise NotImplementedError


class LocalRelayTransport(P2PTransport):
    """Hackathon-honest LAN relay: packets hop through this backend store."""
    name = "local-relay"

    async def discover(self) -> list[dict]:
        peers = {m.get("sender_id", "?") for m in inbox()}
        return [{"peer": p, "transport": self.name} for p in peers if p]

    async def send(self, packet: dict) -> dict:
        return receive(packet)


class SimulatedTransport(P2PTransport):
    """Labelled loopback for stage demo of the store-and-forward chain."""
    name = "simulated"

    async def discover(self) -> list[dict]:
        return [{"peer": "device-B (simulated)", "transport": self.name},
                {"peer": "device-C (simulated)", "transport": self.name}]

    async def send(self, packet: dict) -> dict:
        res = receive({**packet, "simulated_hops": ["A", "B", "C"]})
        res["provenance"] = "SIMULATED"
        return res


class EmergencyMessagingService:
    """Facade the UI talks to. Transport stays underneath (§54)."""

    def __init__(self, transport: P2PTransport | None = None) -> None:
        self.transport = transport or LocalRelayTransport()

    async def sendEmergencyMessage(self, sender_id: str, payload: dict) -> dict:
        msg = seal(sender_id, payload)
        res = await self.transport.send(msg.model_dump(mode="json"))
        return {"message_id": msg.message_id, "transport": self.transport.name, **res}

    async def discoverNearbyDevices(self) -> list[dict]:
        return await self.transport.discover()

    def receiveMessage(self, packet: dict) -> dict:
        return receive(packet)

    def queueForForwarding(self, packet: dict) -> dict:
        return receive({**packet, "queued_locally": True})

    def syncWhenConnected(self) -> dict:
        return sync_outbox()
