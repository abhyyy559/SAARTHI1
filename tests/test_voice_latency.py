"""Voice latency + honesty tests.

Covers the streaming TTS endpoint (POST /api/voice/synthesize-stream),
the X-TTFB-Ms instrumentation, and the honest browser-fallback contract:
without SARVAM_API_KEY the API must NEVER claim "sarvam-live".

The provider seam is mocked (async sleep per call); no real Sarvam key or
network is touched.
"""
import base64
import json
import logging
import time

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.adapters import stt_provider, tts_provider

THREE_SENTENCES = (
    "Heavy rainfall is expected in Hyderabad district over the next six hours according to the official bulletin. "
    "Farmers should postpone pesticide spraying and secure harvested grain under waterproof covers immediately. "
    "Fishermen must avoid venturing into the sea as wind speeds may gust up to sixty kilometres per hour. "
    "Commuters should plan extra travel time and avoid waterlogged underpasses on low lying roads today. "
    "Schools in low lying areas will remain closed tomorrow as a precautionary measure announced officially. "
    "Keep emergency contacts handy and monitor official alerts for further updates through the night."
)

FAKE_B64 = base64.b64encode(b"FAKEWAVDATA").decode("ascii")


@pytest.fixture
def client():
    from backend.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture
def live_tts(monkeypatch):
    """Mocked Sarvam: realistic 300ms per chunk call, chunk-aware."""
    calls = []

    async def fake_synthesize(text, language="en-IN"):
        import asyncio
        calls.append(text)
        await asyncio.sleep(0.3)
        return FAKE_B64, "sarvam-live"

    monkeypatch.setattr(tts_provider, "synthesize", fake_synthesize)
    monkeypatch.setattr(config, "SARVAM_API_KEY", "test-key", raising=False)
    return calls


@pytest.fixture
def live_stt(monkeypatch):
    async def fake_transcribe(audio_bytes, filename, language="en-IN"):
        return ("heavy rain expected this evening", "sarvam-live")

    monkeypatch.setattr(stt_provider, "transcribe", fake_transcribe)
    monkeypatch.setattr(config, "SARVAM_API_KEY", "test-key", raising=False)


def _stream_lines(client, text, language="en"):
    """POST the stream endpoint, returning (response, parsed ndjson lines)."""
    lines = []
    with client.stream(
        "POST", "/api/voice/synthesize-stream",
        json={"text": text, "language": language},
    ) as r:
        assert r.status_code == 200, r.text
        for line in r.iter_lines():
            if line.strip():
                lines.append(json.loads(line))
    return r, lines


def test_stream_emits_chunks_with_done_trailer(client, live_tts):
    """Streaming endpoint: >=2 chunk lines, each with audio, then done trailer."""
    r, lines = _stream_lines(client, THREE_SENTENCES)
    chunks = [ln for ln in lines if not ln.get("done")]
    trailers = [ln for ln in lines if ln.get("done")]
    assert len(chunks) >= 2, f"expected >=2 chunks, got {len(chunks)}: {lines}"
    for i, ch in enumerate(chunks):
        assert ch["audio_base64"] == FAKE_B64
        assert ch["mime"] == "audio/wav"
        assert ch["provider"] == "sarvam-live"
        assert ch["chunk"] == i
    assert len(trailers) == 1
    trailer = trailers[0]
    assert trailer["provider"] == "sarvam-live"
    assert trailer["chunks"] == len(chunks)
    assert trailer["streaming"] == "sentence-chunked"  # honest: not provider streaming
    assert "x-ttfb-ms" in {k.lower() for k in r.headers}
    assert r.headers["content-type"].startswith("application/x-ndjson")


def test_stream_ttfb_header_measures_first_chunk(client, live_tts, caplog):
    """X-TTFB-Ms is present, numeric, and a structured voice_ttfb_ms log fires."""
    with caplog.at_level(logging.INFO, logger="backend.api.voice"):
        r, lines = _stream_lines(client, THREE_SENTENCES)
    ttfb_ms = float(r.headers["x-ttfb-ms"])
    assert 0 <= ttfb_ms < 3000, f"implausible TTFB: {ttfb_ms}"
    # One 300ms provider call makes the first chunk: TTFB ~= one call.
    assert ttfb_ms >= 250, f"TTFB {ttfb_ms}ms < one mocked provider call"
    assert any("voice_ttfb_ms=" in rec.getMessage() for rec in caplog.records), \
        "missing structured voice_ttfb_ms log line"


def test_ttfb_header_on_compat_endpoints(client, live_tts, live_stt):
    """Non-streaming transcribe/synthesize also carry X-TTFB-Ms."""
    r = client.post("/api/voice/synthesize", json={"text": "Hello world.", "language": "en"})
    assert r.status_code == 200
    assert float(r.headers["x-ttfb-ms"]) >= 250
    assert r.json()["provider"] == "sarvam-live"

    r = client.post("/api/voice/transcribe?language=en",
                    files={"file": ("s.webm", b"\x00" * 100, "audio/webm")})
    assert r.status_code == 200
    assert "x-ttfb-ms" in {k.lower() for k in r.headers}
    assert r.json()["provider"] == "sarvam-live"


def test_fallback_honesty_no_key(client, monkeypatch):
    """No key -> provider=browser-fallback everywhere, never sarvam-live."""
    monkeypatch.setattr(config, "SARVAM_API_KEY", None, raising=False)

    # Stream endpoint answers with honest fallback JSON (not a stream).
    r = client.post("/api/voice/synthesize-stream",
                    json={"text": THREE_SENTENCES, "language": "en"})
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "browser-fallback"
    assert body["client_speech"] is True
    assert "sarvam-live" not in json.dumps(body)
    assert "x-ttfb-ms" in {k.lower() for k in r.headers}

    # Compat endpoint stays honest too.
    r = client.post("/api/voice/synthesize", json={"text": "Hello.", "language": "en"})
    assert r.json()["provider"] == "browser-fallback"

    # Status endpoint names the fallback.
    r = client.get("/api/voice/status")
    assert r.json() == {"stt": "browser-fallback", "tts": "browser-fallback"}


def test_413_limits_intact(client, live_tts):
    """Size limits still enforced on stream + compat + transcribe paths."""
    long_text = "x" * 2001
    r = client.post("/api/voice/synthesize-stream", json={"text": long_text, "language": "en"})
    assert r.status_code == 413
    r = client.post("/api/voice/synthesize", json={"text": long_text, "language": "en"})
    assert r.status_code == 413
    r = client.post("/api/voice/transcribe?language=en",
                    files={"file": ("s.webm", b"\x00" * (10 * 1024 * 1024 + 1), "audio/webm")})
    assert r.status_code == 413


def test_sanitize_applied_on_stream_path(client, live_tts):
    """Markdown/URLs are stripped before the provider sees each stream chunk."""
    dirty = ("# Alert **today**! Visit https://example.com/alerts for details. "
             "Stay safe and follow official guidance.")
    r, lines = _stream_lines(client, dirty)
    chunks = [ln for ln in lines if not ln.get("done")]
    assert chunks, "expected chunk lines"
    for sent in live_tts:
        assert "https://" not in sent, f"URL leaked to provider: {sent!r}"
        assert "#" not in sent and "**" not in sent, f"markdown leaked: {sent!r}"
    assert any("Alert today" in sent for sent in live_tts)


def test_first_chunk_before_total(client, live_tts):
    """Progressive emission: first chunk arrives well before the stream ends.

    Uses a raw ASGI call because httpx/TestClient streaming harnesses buffer
    the whole body before yielding lines — the harness artifact, not the app.
    """
    import asyncio

    from backend.main import app

    async def run():
        body = json.dumps({"text": THREE_SENTENCES, "language": "en"}).encode()
        scope = {
            "type": "http", "http_version": "1.1", "method": "POST",
            "path": "/api/voice/synthesize-stream", "query_string": b"",
            "headers": [(b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode())],
        }
        sent = False

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            await asyncio.sleep(3600)
            return {"type": "http.disconnect"}

        t0 = time.perf_counter()
        first = None
        lines = 0

        async def send(msg):
            nonlocal first, lines
            if msg["type"] == "http.response.body" and msg.get("body"):
                lines += msg["body"].count(b"\n")
                if first is None:
                    first = time.perf_counter() - t0

        await app(scope, receive, send)
        return first, time.perf_counter() - t0, lines

    first, total, lines = asyncio.run(run())
    assert lines >= 3, f"expected >=2 chunks + trailer, got {lines} lines"
    assert first is not None, "no chunk lines received"
    assert first < total, "first chunk did not arrive before stream end"
    # 2 chunks x 300ms: first ~0.3s, total ~0.6s
    assert first < total * 0.75, f"not progressive: first={first:.3f}s total={total:.3f}s"
