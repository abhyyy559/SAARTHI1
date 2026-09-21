"""POST /api/chat/stream — NDJSON token streaming for the chat UI.

Pinned behaviours:
(a) the stream emits meta (every ChatResponse field except the answer),
    then token lines, then done — all as NDJSON;
(b) the streamed answer is IDENTICAL to the non-streaming /api/chat answer
    for the same request (same pipeline, same validation, same rain-lead);
(c) no Tamil script appears anywhere in the streamed lines.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import backend.config as config  # noqa: E402
import backend.api.weather as weather_mod  # noqa: E402
from backend.main import app  # noqa: E402
from backend.services.cache_service import CacheService  # noqa: E402

_TAMIL = re.compile(r"[\u0B80-\u0BFF]")


def _text_lines(lines):
    return [json.dumps(ln, ensure_ascii=False) for ln in lines]


@pytest.fixture(autouse=True)
def _isolate_runtime_stores(tmp_path, monkeypatch):
    """Never read/write the developer's real cache; force demo mode."""
    cache_file = str(tmp_path / "weathergpt_cache.json")
    monkeypatch.setattr(config, "CACHE_FILE", cache_file)
    monkeypatch.setattr(weather_mod, "cache", CacheService(cache_file))
    monkeypatch.setattr(config, "DEMO_MODE", True)


def _stream_lines(client, body):
    r = client.post("/api/chat/stream", json=body)
    assert r.status_code == 200, r.text
    assert "x-ndjson" in (r.headers.get("content-type") or "")
    lines = [json.loads(ln) for ln in r.text.splitlines() if ln.strip()]
    assert lines, "stream must emit at least one line"
    return lines


def test_stream_shape_meta_tokens_done():
    client = TestClient(app)
    lines = _stream_lines(client, {"message": "Will it rain tomorrow?", "language": "en"})
    kinds = [ln["type"] for ln in lines]
    assert kinds[0] == "meta", f"first line must be meta, got {kinds}"
    assert kinds[-1] == "done", f"last line must be done, got {kinds}"
    assert "token" in kinds, "stream must carry at least one token"
    meta = lines[0]
    assert "answer" not in meta, "meta must not carry the answer (it streams)"
    for field in ("verdict", "evidence", "warning", "risk", "language"):
        assert field in meta, f"meta must carry {field}"
    done = lines[-1]
    for field in ("structured_fallback", "model_error", "response_time_ms"):
        assert field in done, f"done must carry {field}"
    assert not any(_TAMIL.search(ln) for ln in _text_lines(lines))


def _norm(s):
    # The template stamps a generation timestamp; normalize it away so the
    # comparison checks the pipeline, not the clock.
    return re.sub(r"\d{2}:\d{2}:\d{2}(?:\.\d+)?", "<time>", s)


def test_stream_answer_matches_non_streaming():
    """The streamed answer and /api/chat must agree — one pipeline, one truth."""
    client = TestClient(app)
    body = {"message": "Will it rain tomorrow?", "language": "en"}
    lines = _stream_lines(client, body)
    streamed = "".join(ln.get("text", "") for ln in lines if ln["type"] == "token")
    finals = [ln for ln in lines if ln["type"] == "final"]
    answer = finals[0]["answer"] if finals else streamed
    assert answer.strip(), "streamed answer must not be empty"

    r = client.post("/api/chat", json=body)
    assert r.status_code == 200, r.text
    assert _norm(r.json()["answer"]) == _norm(answer), "stream and non-stream answers must be identical"
