"""Server side of the phone-to-phone Bluetooth mesh.

The Android app relays SOS messages between phones over Bluetooth LE with no
internet at all. This module is the part that touches the server, and both
directions are optional extras:

* Gateway in: any phone that gets a connection uploads the mesh messages it
  carries (SOS, status updates, "I'm safe"), so responders with a dashboard see
  them. Each message is verified exactly as the phones verify it.
* Gateway out: official alerts are signed with the server's mesh key so a phone
  that is online can drop them into the mesh, and phones that are not can check
  the signature against the key they pinned earlier.

Wire format (identical to MeshProtocol.java):
    {"v":1,"t":type,"id":16hex,"o":nodeId,"k":pubkeyB64,"ts":sec,"exp":sec,
     "h":hops,"hl":hopLimit,"p":payloadJson,"s":sigB64}
    signed bytes = v|t|id|o|ts|exp|hl|p ; ECDSA P-256 SHA-256, DER signature
    nodeId = hex(sha256(public key DER)[:8])
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from .. import config

log = logging.getLogger(__name__)

VERSION = 1
MAX_MESSAGE_BYTES = 1500
MAX_NOTE_CHARS = 140
MAX_FUTURE_SEC = 15 * 60
MAX_STORED = 2000

# type -> (hop limit, 0 = unlimited; lifetime in seconds). Same as the phones.
RULES: dict[str, tuple[int, int]] = {
    "sos": (0, 72 * 3600),
    "sos_upd": (0, 72 * 3600),
    "alert": (0, 48 * 3600),
    "safe": (7, 24 * 3600),
    "report": (5, 12 * 3600),
}
# What the server keeps from uploads: things a responder acts on.
RELAYED_TYPES = {"sos", "sos_upd", "safe"}

_HEX16 = re.compile(r"^[0-9a-f]{16}$")
_lock = threading.Lock()


def _dir() -> Path:
    """The runtime store directory (SAARTHI_STORE_DIR wins, as in services/db.py)."""
    override = os.environ.get("SAARTHI_STORE_DIR", "").strip()
    d = Path(override) if override else Path(getattr(config, "CACHE_FILE", "weathergpt_cache.json")).parent / "store"
    d.mkdir(parents=True, exist_ok=True)
    return d


def node_id(public_der: bytes) -> str:
    return hashlib.sha256(public_der).digest()[:8].hex()


def signed_bytes(m: dict[str, Any]) -> bytes:
    return (
        f"{int(m.get('v', 0))}|{m.get('t', '')}|{m.get('id', '')}|{m.get('o', '')}|"
        f"{int(m.get('ts', 0))}|{int(m.get('exp', 0))}|{int(m.get('hl', 0))}|{m.get('p', '')}"
    ).encode("utf-8")


# --------------------------------------------------------------------------
# The server's mesh key
# --------------------------------------------------------------------------

_key_cache: ec.EllipticCurvePrivateKey | None = None


def _key() -> ec.EllipticCurvePrivateKey:
    """The server's signing key, made once and kept beside the other runtime files.

    Phones pin the public half, so regenerating it would make every phone refuse
    the server's alerts until it next comes online. MESH_PRIVATE_KEY (PEM) wins
    when set, so several instances can share one key.
    """
    global _key_cache
    if _key_cache is not None:
        return _key_cache
    env_pem = getattr(config, "MESH_PRIVATE_KEY", "") or ""
    path = _dir() / "mesh_server_key.pem"
    pem = env_pem.encode() if env_pem else (path.read_bytes() if path.exists() else b"")
    if pem:
        try:
            k = serialization.load_pem_private_key(pem, password=None)
            if isinstance(k, ec.EllipticCurvePrivateKey):
                _key_cache = k
                return k
        except Exception:  # noqa: BLE001 - a broken file is replaced below
            log.warning("mesh key unreadable; making a new one")
    k = ec.generate_private_key(ec.SECP256R1())
    try:
        path.write_bytes(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                         serialization.NoEncryption()))
    except OSError:
        log.warning("could not save the mesh key; it lasts for this process only")
    _key_cache = k
    return k


def public_key_der() -> bytes:
    return _key().public_key().public_bytes(serialization.Encoding.DER,
                                            serialization.PublicFormat.SubjectPublicKeyInfo)


def public_key_b64() -> str:
    return base64.b64encode(public_key_der()).decode("ascii")


def sign_message(t: str, payload: dict[str, Any], *, msg_id: str, ts: int, exp: int) -> dict[str, Any]:
    """A mesh message signed by the server (used for official alerts)."""
    hop_limit, ttl = RULES[t]
    pub = public_key_der()
    m: dict[str, Any] = {
        "v": VERSION, "t": t, "id": msg_id, "o": node_id(pub),
        "k": base64.b64encode(pub).decode("ascii"),
        "ts": int(ts), "exp": int(min(exp, ts + ttl)), "h": 0, "hl": hop_limit,
        "p": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
    }
    sig = _key().sign(signed_bytes(m), ec.ECDSA(hashes.SHA256()))
    m["s"] = base64.b64encode(sig).decode("ascii")
    return m


# --------------------------------------------------------------------------
# Verification (mirrors MeshProtocol.check)
# --------------------------------------------------------------------------

def check(m: Any, now: float | None = None) -> str | None:
    """Why a message is refused, or None when it is valid."""
    now = time.time() if now is None else now
    if not isinstance(m, dict):
        return "not an object"
    if len(json.dumps(m, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_MESSAGE_BYTES:
        return "too large"
    if m.get("v") != VERSION:
        return "bad version"
    t = m.get("t")
    if t not in RULES:
        return "unknown type"
    hop_rule, ttl = RULES[t]
    if not _HEX16.match(str(m.get("id", ""))) or not _HEX16.match(str(m.get("o", ""))):
        return "bad id"
    try:
        ts, exp, h, hl = int(m["ts"]), int(m["exp"]), int(m.get("h", 0)), int(m.get("hl", 0))
    except (KeyError, TypeError, ValueError):
        return "bad fields"
    if ts <= 0 or exp <= ts:
        return "bad time"
    if ts > now + MAX_FUTURE_SEC:
        return "from the future"
    if exp <= now:
        return "expired"
    if exp - ts > ttl:
        return "lifetime too long"
    if h < 0 or hl < 0 or hl > 50 or (hl > 0 and h > hl):
        return "bad hops"
    if hop_rule > 0 and (hl == 0 or hl > hop_rule):
        return "hop limit too high"
    try:
        payload = json.loads(m.get("p", ""))
    except (TypeError, ValueError):
        return "payload not json"
    if not isinstance(payload, dict):
        return "payload not json"
    if len(str(payload.get("note", ""))) > MAX_NOTE_CHARS:
        return "note too long"
    try:
        pub = base64.b64decode(m.get("k", ""), validate=True)
        if node_id(pub) != m["o"]:
            return "origin does not match key"
        if t == "alert" and pub != public_key_der():
            return "alert not signed by the server"
        key = serialization.load_der_public_key(pub)
        if not isinstance(key, ec.EllipticCurvePublicKey):
            return "bad key"
        key.verify(base64.b64decode(m.get("s", ""), validate=True), signed_bytes(m), ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError, TypeError):
        return "bad signature"
    return None


# --------------------------------------------------------------------------
# Messages uploaded by gateway phones
# --------------------------------------------------------------------------

def _store_path() -> Path:
    return _dir() / "mesh_relay.json"


def _load() -> dict[str, dict[str, Any]]:
    try:
        data = json.loads(_store_path().read_text(encoding="utf-8"))
        return {m["id"]: m for m in data if isinstance(m, dict) and "id" in m}
    except (OSError, ValueError):
        return {}


def _save(store: dict[str, dict[str, Any]]) -> None:
    try:
        path = _store_path()
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(list(store.values()), ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        log.warning("could not save relayed mesh messages")


def relay(messages: list[Any], *, now: float | None = None) -> dict[str, Any]:
    """Keep the valid SOS-related messages a phone carried in. Idempotent by id."""
    now = time.time() if now is None else now
    accepted, duplicate, rejected = 0, 0, []
    with _lock:
        store = _load()
        for m in messages[:500]:
            mid = m.get("id") if isinstance(m, dict) else None
            why = check(m, now)
            if why is None and m["t"] not in RELAYED_TYPES:
                why = "not kept by the server"
            if why:
                rejected.append({"id": mid, "reason": why})
                continue
            if mid in store:
                duplicate += 1
                continue
            store[mid] = {**m, "received_at": int(now)}
            accepted += 1
        live = {k: v for k, v in store.items() if int(v.get("exp", 0)) > now}
        if len(live) > MAX_STORED:
            live = dict(sorted(live.items(), key=lambda kv: kv[1].get("ts", 0))[-MAX_STORED:])
        _save(live)
    return {"accepted": accepted, "duplicate": duplicate, "rejected": rejected}


def incidents(*, now: float | None = None) -> list[dict[str, Any]]:
    """Active SOS calls with their latest status, newest first.

    Folding rules match the app: "going" counts responders, "rescued" (anyone)
    and "cancel" (only the person who sent the SOS) close it.
    """
    now = time.time() if now is None else now
    with _lock:
        store = _load()
    sos: dict[str, dict[str, Any]] = {}
    updates: list[dict[str, Any]] = []
    for m in store.values():
        if int(m.get("exp", 0)) <= now:
            continue
        try:
            p = json.loads(m.get("p", "{}"))
        except ValueError:
            continue
        if m.get("t") == "sos":
            sos[m["id"]] = {
                "id": m["id"], "from": m["o"], "sent_at": m["ts"], "expires_at": m["exp"],
                "hops": m.get("h", 0), "lat": p.get("lat"), "lon": p.get("lon"), "acc": p.get("acc"),
                "need": p.get("need"), "note": p.get("note"), "name": p.get("name"), "people": p.get("ppl"),
                "status": "active", "responders": [],
            }
        elif m.get("t") == "sos_upd":
            updates.append({**m, "_p": p})
    for u in sorted(updates, key=lambda x: x.get("ts", 0)):
        inc = sos.get(u["_p"].get("ref"))
        if not inc:
            continue
        st = u["_p"].get("st")
        if st == "going" and u["o"] not in inc["responders"]:
            inc["responders"].append(u["o"])
        elif st == "rescued":
            inc["status"] = "rescued"
        elif st == "cancel" and u["o"] == inc["from"]:
            inc["status"] = "cancelled"
    return sorted(sos.values(), key=lambda x: -int(x["sent_at"]))


def alert_message(alert: dict[str, Any], district: str, *, now: float | None = None) -> dict[str, Any] | None:
    """One official alert as a server-signed mesh message, or None if it has ended.

    The id comes from the alert itself, so a phone that already has it drops the
    copy another phone brings in.
    """
    now = int(time.time() if now is None else now)
    ident = str(alert.get("identifier") or alert.get("id") or "") or "|".join(
        str(alert.get(k, "")) for k in ("source", "hazard", "headline", "message", "issued_at"))
    msg_id = hashlib.sha256(f"{district}|{ident}".encode("utf-8")).digest()[:8].hex()
    until = alert.get("expires") or alert.get("valid_until")
    exp = now + RULES["alert"][1]
    if until:
        from datetime import datetime
        try:
            exp = min(exp, int(datetime.fromisoformat(str(until).replace("Z", "+00:00")).timestamp()))
        except ValueError:
            pass
    if exp <= now:
        return None
    payload = {
        "headline": str(alert.get("headline") or alert.get("message") or alert.get("hazard") or "Official alert")[:120],
        "hazard": str(alert.get("hazard") or alert.get("event") or "")[:40],
        "severity": str(alert.get("severity") or "").upper()[:12],
        "area": district[:40],
        "source": str(alert.get("source") or "")[:30],
    }
    return sign_message("alert", payload, msg_id=msg_id, ts=now, exp=exp)
