"""Sarvam + LLM wiring defaults (2026-09-27).

Pins the conversational-agent configuration choices so they cannot silently
regress:
- STT default model is saaras:v3 (saarika:v2.5 is deprecated/legacy)
- STT streaming URL derives to /speech-to-text-translate/streaming
- GPT-OSS calls use reasoning_effort=low + 400-token headroom (TTFB + no truncation)
- the system prompt brands SAARTHI, never WeatherGPT
"""
import asyncio
import os
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_stt_model_defaults_to_saaras_v3():
    # config reads the default at import time, so check it in a clean env.
    env = {k: v for k, v in os.environ.items() if k != "SARVAM_STT_MODEL"}
    code = (
        "import sys; sys.path.insert(0, %r);"
        "from backend import config;"
        "print(config.SARVAM_STT_MODEL)"
    ) % ROOT
    out = subprocess.run(
        [sys.executable, "-c", code], env=env, capture_output=True,
        text=True, timeout=30,
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "saaras:v3", \
        f"default STT model must be saaras:v3, got {out.stdout.strip()!r}"


def test_stt_streaming_url_derives_correctly(monkeypatch):
    sys.path.insert(0, ROOT)
    from backend import config
    from backend.adapters import stt_provider

    monkeypatch.delenv("SARVAM_STT_WS_URL", raising=False)
    monkeypatch.setattr(config, "SARVAM_STT_URL", "https://api.sarvam.ai/speech-to-text")
    assert stt_provider._stream_url() == \
        "wss://api.sarvam.ai/speech-to-text-translate/streaming"

    # Explicit override still wins.
    monkeypatch.setenv("SARVAM_STT_WS_URL", "wss://custom.example/stream")
    assert stt_provider._stream_url() == "wss://custom.example/stream"


def _fake_llm_response(captured):
    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": "Sunny, 32°C."}}]}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            captured["json"] = json
            return FakeResp()

    return FakeClient


def test_gpt_oss_payload_low_latency_params(monkeypatch):
    sys.path.insert(0, ROOT)
    import httpx
    from backend import config
    from backend.services.llm_service import LLMService

    monkeypatch.setattr(config, "LLM_API_KEY", "test-key")
    monkeypatch.setattr(config, "LLM_MODEL", "openai/gpt-oss-120b")
    monkeypatch.setattr(config, "LLM_MODEL_KNOWN", True)
    captured = {}
    monkeypatch.setattr(httpx, "AsyncClient", _fake_llm_response(captured))

    evidence = {"weather": {"verified": True}, "question_kind": "current"}
    answer, fallback = asyncio.run(
        LLMService().generate(evidence, "How is the weather?", "en"))

    payload = captured["json"]
    # gpt-oss is a reasoning model: low effort cuts time-to-first-token, and
    # 400 tokens leaves headroom because the model spends part of max_tokens
    # on hidden reasoning (240 truncated visible answers).
    assert payload["reasoning_effort"] == "low"
    assert payload["max_tokens"] == 400
    assert payload["temperature"] == 0.2
    assert payload["messages"][0]["role"] == "system"
    assert not fallback
    assert answer == "Sunny, 32°C."


def test_gpt_oss_stream_payload_low_latency_params(monkeypatch):
    sys.path.insert(0, ROOT)
    import httpx
    from backend import config
    from backend.services.llm_service import LLMService

    monkeypatch.setattr(config, "LLM_API_KEY", "test-key")
    monkeypatch.setattr(config, "LLM_MODEL", "openai/gpt-oss-120b")
    monkeypatch.setattr(config, "LLM_MODEL_KNOWN", True)
    captured = {}

    class FakeStreamResp:
        def raise_for_status(self):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def aiter_lines(self):
            yield 'data: {"choices": [{"delta": {"content": "Sunny"}}]}'
            yield 'data: [DONE]'

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, method, url, headers=None, json=None):
            captured["json"] = json
            return FakeStreamResp()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)

    evidence = {"weather": {"verified": True}, "question_kind": "current"}

    async def drain():
        texts = []
        async for ev in LLMService().generate_stream(
                evidence, "How is the weather?", "en"):
            if ev.get("type") == "token":
                texts.append(ev["text"])
        return texts

    texts = asyncio.run(drain())
    payload = captured["json"]
    assert payload["reasoning_effort"] == "low"
    assert payload["max_tokens"] == 400
    assert payload["stream"] is True
    assert texts == ["Sunny"]


def test_system_prompt_brands_saarthi():
    sys.path.insert(0, ROOT)
    from backend.services import llm_service

    prompt = llm_service.SYSTEM_RULES
    assert prompt.startswith("You are SAARTHI,"), \
        "the system prompt must open with the SAARTHI identity"
    assert "WeatherGPT" not in prompt, \
        "the old WeatherGPT branding must not leak into the system prompt"
    # The grounding rules the safety architecture depends on are untouched.
    assert "Do not create emergency warnings" in prompt
    assert "Silence from a broken service is not an all-clear" in prompt
