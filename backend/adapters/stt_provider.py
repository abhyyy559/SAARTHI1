"""STT provider — Sarvam-compatible HTTP with honest browser fallback.

Env: SARVAM_API_KEY, SARVAM_STT_URL (default https://api.sarvam.ai/speech-to-text),
SARVAM_STT_MODEL (default saarika:v2.5), SARVAM_STT_WS_URL (optional override for
the streaming endpoint; derived from SARVAM_STT_URL when unset). Without a key
the provider reports BROWSER_FALLBACK and the frontend uses Web Speech API —
badge shows the truth.

Two paths:
- transcribe(): batch REST — record-then-upload, final transcript only.
- open_stream(): WebSocket streaming (Sarvam speech-to-text/ws) — partial
  transcripts arrive while the user is still speaking, which is what makes the
  < 1 s first-interim budget reachable. The wire protocol below mirrors the
  official sarvamai SDK (speech_to_text_streaming): connect
  wss://<host>/speech-to-text/ws with query params language-code / model /
  mode=transcribe / sample_rate=16000 / high_vad_sensitivity / flush_signal /
  input_audio_codec=pcm_s16le and header Api-Subscription-Key; audio frames are
  {"audio": {"data": "<base64>", "sample_rate": 16000, "encoding": "audio/wav"}};
  flush is {"type": "flush"}; responses are {"type": "data"|"error"|"events",
  "data": {"transcript": ..., "metrics": ...}}.

  The WebSocket client is stdlib-only (asyncio + ssl) so no new dependency is
  needed. Latency tuning: high_vad_sensitivity=true makes end-of-speech fire
  sooner, flush_signal=true lets the server finalize on demand instead of
  waiting out its own VAD window, and 16 kHz PCM keeps frames small.

HTTP latency: a single module-level httpx.AsyncClient is reused so every
transcribe() call skips the TCP+TLS handshake (~100-300 ms to api.sarvam.ai).
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import ssl
import urllib.parse

import httpx

from .. import config
from .registry import LIVE, UNCONFIGURED, AdapterUnavailable, report

logger = logging.getLogger(__name__)

NAME = "stt"
BROWSER_FALLBACK = "browser-fallback"
_WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def provider_name() -> str:
    return "sarvam-live" if config.SARVAM_API_KEY else BROWSER_FALLBACK


def streaming_available() -> bool:
    """True when a key is configured, i.e. the streaming relay can be offered."""
    return bool(config.SARVAM_API_KEY)


# --- shared HTTP client (connection reuse) ---------------------------------

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


async def transcribe(audio_bytes: bytes, filename: str, language: str = "en-IN") -> tuple[str, str]:
    key = config.SARVAM_API_KEY
    if not key:
        report(NAME, UNCONFIGURED, "SARVAM_API_KEY not set — browser fallback")
        raise AdapterUnavailable("browser-fallback")
    # Sarvam language codes: en-IN, hi-IN, te-IN, ...
    lang = {"en": "en-IN", "hi": "hi-IN", "te": "te-IN"}.get(language, language)
    # Batch API latency audit (2026-09-21): the request carries only model +
    # language_code. No diarization flag (defaults off — good, diarization adds
    # seconds), no VAD/silence knobs exist on the batch endpoint, multipart is
    # required by the API. saarika:v2.5 is Sarvam's current low-latency model.
    # The remaining lever is the streaming endpoint (open_stream below).
    try:
        resp = await _http().post(
            config.SARVAM_STT_URL,
            headers={"api-subscription-key": key},
            data={"model": config.SARVAM_STT_MODEL, "language_code": lang},
            files={"file": (filename or "audio.webm", audio_bytes)},
        )
        resp.raise_for_status()
        text = (resp.json().get("transcript") or "").strip()
    except Exception as exc:
        report(NAME, UNCONFIGURED, f"provider error: {type(exc).__name__} — browser fallback")
        raise AdapterUnavailable(f"STT provider failed: {exc}") from exc
    report(NAME, LIVE, f"transcribed {len(text)} chars ({lang})")
    return text, "sarvam-live"


# --- minimal stdlib WebSocket client (RFC 6455, client side) ----------------

class _WsClosed(Exception):
    pass


class _WsError(Exception):
    pass


class _RawWebSocket:
    """Just enough WebSocket for the Sarvam streaming relay: masked text
    frames out, text/ping/pong/close frames in. stdlib only."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self._r = reader
        self._w = writer

    @classmethod
    async def connect(cls, url: str, headers: dict[str, str], timeout: float = 10.0) -> "_RawWebSocket":
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ("ws", "wss"):
            raise _WsError(f"unsupported scheme {parts.scheme}")
        host = parts.hostname or ""
        port = parts.port or (443 if parts.scheme == "wss" else 80)
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        ssl_ctx = None
        if parts.scheme == "wss":
            ssl_ctx = ssl.create_default_context()
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port, ssl=ssl_ctx, server_hostname=host if ssl_ctx else None),
                timeout,
            )
        except Exception as exc:
            raise _WsError(f"tcp connect failed: {exc}") from exc
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        lines = [
            f"GET {path} HTTP/1.1",
            f"Host: {host}",
            "Upgrade: websocket",
            "Connection: Upgrade",
            f"Sec-WebSocket-Key: {key}",
            "Sec-WebSocket-Version: 13",
            *(f"{k}: {v}" for k, v in headers.items()),
            "", "",
        ]
        writer.write("\r\n".join(lines).encode("latin-1"))
        await writer.drain()
        head = await cls._read_http_head(reader, timeout)
        status = head.split("\r\n", 1)[0]
        if "101" not in status:
            writer.close()
            raise _WsError(f"websocket upgrade rejected: {status[:80]}")
        accept = hashlib.sha1((key + _WS_GUID).encode()).digest()
        if base64.b64encode(accept).decode() not in head:
            writer.close()
            raise _WsError("bad Sec-WebSocket-Accept")
        return cls(reader, writer)

    @staticmethod
    async def _read_http_head(reader: asyncio.StreamReader, timeout: float) -> str:
        buf = b""
        async def _read():
            nonlocal buf
            while b"\r\n\r\n" not in buf:
                chunk = await reader.read(4096)
                if not chunk:
                    break
                buf += chunk
            return buf
        raw = await asyncio.wait_for(_read(), timeout)
        return raw.split(b"\r\n\r\n", 1)[0].decode("latin-1", "replace")

    async def _read_exact(self, n: int) -> bytes:
        data = await self._r.readexactly(n)
        return data

    async def send_text(self, text: str) -> None:
        payload = text.encode("utf-8")
        mask = os.urandom(4)
        frame = bytearray([0x81])
        n = len(payload)
        if n < 126:
            frame.append(0x80 | n)
        elif n < 65536:
            frame.append(0x80 | 126)
            frame += n.to_bytes(2, "big")
        else:
            frame.append(0x80 | 127)
            frame += n.to_bytes(8, "big")
        frame += mask
        frame += bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self._w.write(bytes(frame))
        await self._w.drain()

    async def _send_pong(self, payload: bytes) -> None:
        self._w.write(bytes([0x8A, len(payload)]) + payload)
        await self._w.drain()

    async def recv_text(self) -> str:
        """Next text message; answers pings, raises _WsClosed on close."""
        chunks = []
        while True:
            hdr = await self._read_exact(2)
            fin = hdr[0] & 0x80
            opcode = hdr[0] & 0x0F
            masked = hdr[1] & 0x80
            length = hdr[1] & 0x7F
            if length == 126:
                length = int.from_bytes(await self._read_exact(2), "big")
            elif length == 127:
                length = int.from_bytes(await self._read_exact(8), "big")
            mask = await self._read_exact(4) if masked else None
            payload = await self._read_exact(length) if length else b""
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:
                raise _WsClosed("server closed")
            if opcode == 0x9:
                await self._send_pong(payload)
                continue
            if opcode == 0xA:
                continue
            if opcode in (0x1, 0x2, 0x0):
                chunks.append(payload)
                if fin:
                    return b"".join(chunks).decode("utf-8", "replace")
                continue
            # unknown opcode: ignore

    async def close(self) -> None:
        try:
            self._w.write(bytes([0x88, 0x00]))
            await self._w.drain()
        except Exception:
            pass
        try:
            self._w.close()
        except Exception:
            pass


# --- streaming STT session ---------------------------------------------------

def _stream_url() -> str:
    override = os.environ.get("SARVAM_STT_WS_URL")
    if override:
        return override
    base = (config.SARVAM_STT_URL or "https://api.sarvam.ai/speech-to-text").rstrip("/")
    ws_base = base.replace("https://", "wss://").replace("http://", "ws://")
    return ws_base + "/ws"


class SttStreamSession:
    """One streaming transcription turn. Async-iterate for ("partial"|"error",
    text) events while audio streams; send_audio() streams base64 16 kHz PCM;
    flush() finalizes and returns the final transcript."""

    def __init__(self, ws: _RawWebSocket):
        self._ws = ws
        self._queue: asyncio.Queue = asyncio.Queue()
        self._finalized = False
        self._final_text: str | None = None
        self._final_error: str | None = None
        self._final_evt = asyncio.Event()
        self._reader = asyncio.ensure_future(self._pump())

    def _lang_code(self, language: str) -> str:
        return {"en": "en-IN", "hi": "hi-IN", "te": "te-IN"}.get(language, language)

    async def _pump(self) -> None:
        try:
            while True:
                raw = await self._ws.recv_text()
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                mtype = msg.get("type")
                data = msg.get("data") or {}
                if mtype == "data" and isinstance(data.get("transcript"), str):
                    if self._finalized:
                        # Post-flush transcript: the final. It goes to flush()
                        # via the event, not the iterator queue (two consumers
                        # on one queue race — verified by mock test 2026-09-21).
                        self._final_text = data["transcript"]
                        self._final_evt.set()
                        await self._queue.put(("closed", ""))
                        return
                    await self._queue.put(("partial", data["transcript"]))
                elif mtype == "error":
                    err = data.get("message") or data.get("error") or "provider error"
                    self._final_error = str(err)
                    self._final_evt.set()
                    await self._queue.put(("error", str(err)))
                    await self._queue.put(("closed", ""))
                    return
                # "events" (VAD signals) are informational only.
        except _WsClosed:
            if self._final_error is None and self._final_text is None:
                self._final_error = "stream closed before final transcript"
            self._final_evt.set()
            await self._queue.put(("closed", ""))
        except Exception as exc:  # never let the pump die silently
            logger.warning("stt stream pump ended: %s", exc)
            if self._final_error is None and self._final_text is None:
                self._final_error = f"stream pump failed: {exc}"
            self._final_evt.set()
            await self._queue.put(("closed", ""))

    def __aiter__(self):
        return self._drain()

    async def _drain(self):
        while True:
            kind, text = await self._queue.get()
            if kind == "closed":
                return
            yield kind, text

    async def send_audio(self, audio_b64: str) -> None:
        await self._ws.send_text(json.dumps({
            "audio": {"data": audio_b64, "sample_rate": 16000, "encoding": "audio/wav"},
        }))

    async def flush(self, timeout: float = 15.0) -> str:
        """Ask the server to finalize now; returns the final transcript."""
        # Set before the frame goes out: a partial already in flight when we
        # flush is still usable as the final text.
        self._finalized = True
        await self._ws.send_text(json.dumps({"type": "flush"}))
        try:
            await asyncio.wait_for(self._final_evt.wait(), timeout)
        except (asyncio.TimeoutError, TimeoutError) as exc:
            raise AdapterUnavailable("STT stream flush timed out") from exc
        if self._final_error:
            raise AdapterUnavailable(f"STT stream error: {self._final_error}")
        return self._final_text or ""

    async def aclose(self) -> None:
        self._reader.cancel()
        try:
            await self._reader
        except (asyncio.CancelledError, Exception):
            pass
        await self._ws.close()


async def open_stream(language: str = "en") -> SttStreamSession:
    """Open a streaming STT session. Raises AdapterUnavailable when unconfigured
    or the provider cannot be reached (caller falls back to batch/browser)."""
    key = config.SARVAM_API_KEY
    if not key:
        report(NAME, UNCONFIGURED, "SARVAM_API_KEY not set — streaming unavailable")
        raise AdapterUnavailable("browser-fallback")
    lang = {"en": "en-IN", "hi": "hi-IN", "te": "te-IN"}.get(language, language)
    # Low-latency VAD config: high sensitivity ends speech sooner, flush_signal
    # lets us finalize on demand, 16 kHz PCM keeps frames small. Param names
    # mirror the official SDK (language-code hyphenated, sample_rate underscored).
    params = urllib.parse.urlencode({
        "language-code": lang,
        "model": config.SARVAM_STT_MODEL,
        "mode": "transcribe",
        "sample_rate": 16000,
        "high_vad_sensitivity": "true",
        "flush_signal": "true",
        "input_audio_codec": "pcm_s16le",
    })
    url = f"{_stream_url()}?{params}"
    try:
        ws = await _RawWebSocket.connect(url, {"Api-Subscription-Key": key})
    except Exception as exc:
        report(NAME, UNCONFIGURED, f"streaming connect failed: {type(exc).__name__}")
        raise AdapterUnavailable(f"STT streaming unavailable: {exc}") from exc
    report(NAME, LIVE, f"streaming session opened ({lang})")
    return SttStreamSession(ws)
