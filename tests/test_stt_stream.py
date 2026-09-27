"""Streaming STT session tests (mock WebSocket, no Sarvam key or network).

The /api/voice/transcribe-stream relay was dead code end-to-end: fully
implemented but with zero tests and zero frontend references. These tests pin
the SttStreamSession contract — partial pump, flush finalization, error
propagation, and frame shapes — against a scripted fake socket so the relay
can be wired to the UI with confidence once a key is available.
"""
import asyncio
import json

import pytest

from backend import config
from backend.adapters.registry import AdapterUnavailable
from backend.adapters.stt_provider import (
    SttStreamSession,
    _WsClosed,
    open_stream,
    streaming_available,
)


class FakeWs:
    """Scripted stand-in for _RawWebSocket: replays incoming messages, then
    raises _WsClosed. Records every frame sent."""

    def __init__(self, incoming):
        self.incoming = list(incoming)
        self.sent = []
        self.closed = False

    async def send_text(self, text):
        self.sent.append(text)

    async def recv_text(self):
        if not self.incoming:
            raise _WsClosed("server closed")
        item = self.incoming.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    async def close(self):
        self.closed = True


def data_msg(transcript):
    return json.dumps({"type": "data", "data": {"transcript": transcript}})


def error_msg(message):
    return json.dumps({"type": "error", "data": {"message": message}})


def test_streaming_unavailable_without_key(monkeypatch):
    monkeypatch.setattr(config, "SARVAM_API_KEY", "", raising=False)
    assert streaming_available() is False
    with pytest.raises(AdapterUnavailable):
        asyncio.run(open_stream("en"))


def test_partials_yielded_in_order():
    async def main():
        ws = FakeWs([data_msg("hello"), data_msg("hello world")])
        session = SttStreamSession(ws)
        got = []
        async for kind, text in session:
            got.append((kind, text))
        await session.aclose()
        return got, ws

    got, ws = asyncio.run(main())
    assert got == [("partial", "hello"), ("partial", "hello world")]
    assert ws.closed is True


def test_flush_returns_final_transcript():
    async def main():
        ws = FakeWs([data_msg("final transcript here")])
        session = SttStreamSession(ws)
        final = await session.flush()
        await session.aclose()
        return final, ws

    final, ws = asyncio.run(main())
    assert final == "final transcript here"
    # The flush frame must go out on the wire.
    assert any(json.loads(f).get("type") == "flush" for f in ws.sent)


def test_flush_propagates_provider_error():
    async def main():
        ws = FakeWs([error_msg("quota exceeded")])
        session = SttStreamSession(ws)
        with pytest.raises(AdapterUnavailable, match="quota exceeded"):
            await session.flush()
        await session.aclose()

    asyncio.run(main())


def test_flush_timeout_raises():
    async def main():
        ws = FakeWs([])

        async def hang():
            await asyncio.sleep(60)

        ws.recv_text = hang  # server never answers -> exercises the timeout
        session = SttStreamSession(ws)
        try:
            with pytest.raises(AdapterUnavailable, match="timed out"):
                await session.flush(timeout=0.05)
        finally:
            await session.aclose()

    asyncio.run(main())


def test_iterator_yields_error_then_stops():
    async def main():
        ws = FakeWs([data_msg("partial one"), error_msg("boom")])
        session = SttStreamSession(ws)
        got = []
        async for kind, text in session:
            got.append((kind, text))
        await session.aclose()
        return got

    assert asyncio.run(main()) == [("partial", "partial one"), ("error", "boom")]


def test_send_audio_frame_shape():
    async def main():
        ws = FakeWs([])
        session = SttStreamSession(ws)
        await session.send_audio("QUJD")
        await session.aclose()
        return ws

    ws = asyncio.run(main())
    frame = json.loads(ws.sent[0])
    assert frame["audio"]["data"] == "QUJD"
    assert frame["audio"]["sample_rate"] == 16000
    assert frame["audio"]["encoding"] == "audio/wav"


def test_events_messages_are_ignored():
    """VAD "events" frames are informational — they must not surface as
    partials or disturb finalization."""
    async def main():
        ws = FakeWs([
            json.dumps({"type": "events", "data": {"vad": "speech-start"}}),
            data_msg("spoken words"),
        ])
        session = SttStreamSession(ws)
        got = []
        async for kind, text in session:
            got.append((kind, text))
        await session.aclose()
        return got

    assert asyncio.run(main()) == [("partial", "spoken words")]
