"""Groq's free tier allows 8,000 tokens a minute per model (~4 answers). A
burst must spill over to the second model, and repeats must come from the
answer cache, before anyone gets the plainer template answer."""
import asyncio
import json

import httpx

from backend import config
from backend.api import chat as chat_api
from backend.services import llm_service

EVIDENCE = {"location": {"district": "Medak"}, "user_type": "farmer", "forecast": {"days": []},
            "verified_warning": {"verified": False}, "current_weather": {}}


def _fake_groq(monkeypatch, busy=("openai/gpt-oss-120b",)):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        model = body["model"]
        calls.append(model)
        if model in busy:
            return httpx.Response(429, json={"error": {"message": "rate limit"}})
        if body.get("stream"):
            sse = ('data: {"choices":[{"delta":{"content":"Answer from %s"}}]}\n\ndata: [DONE]\n\n' % model)
            return httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"choices": [{"message": {"content": f"Answer from {model}"}}]})

    real = httpx.AsyncClient
    monkeypatch.setattr(llm_service.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(config, "LLM_API_KEY", "test-key")
    monkeypatch.setattr(config, "LLM_MODEL", "openai/gpt-oss-120b")
    monkeypatch.setattr(config, "LLM_FALLBACK_MODEL", "openai/gpt-oss-20b")
    monkeypatch.setattr(config, "LLM_MODEL_KNOWN", True)
    return calls


def test_rate_limited_model_spills_over(monkeypatch):
    calls = _fake_groq(monkeypatch)
    answer, fallback = asyncio.run(llm_service.LLMService().generate(EVIDENCE, "rain?", "en"))
    assert (answer, fallback) == ("Answer from openai/gpt-oss-20b", False)
    assert calls == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]


def test_rate_limited_stream_spills_over(monkeypatch):
    calls = _fake_groq(monkeypatch)

    async def collect():
        return [ev async for ev in llm_service.LLMService().generate_stream(EVIDENCE, "rain?", "en")]

    events = asyncio.run(collect())
    assert "".join(e["text"] for e in events if e["type"] == "token") == "Answer from openai/gpt-oss-20b"
    assert events[-1] == {"type": "end", "fallback": False, "model_error": "", "truncated": False}
    assert calls == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]


def test_both_models_busy_gives_the_template(monkeypatch):
    _fake_groq(monkeypatch, busy=("openai/gpt-oss-120b", "openai/gpt-oss-20b"))
    answer, fallback = asyncio.run(llm_service.LLMService().generate(EVIDENCE, "rain?", "en"))
    assert fallback is True and answer


def test_first_model_answers_alone_when_not_busy(monkeypatch):
    calls = _fake_groq(monkeypatch, busy=())
    answer, _ = asyncio.run(llm_service.LLMService().generate(EVIDENCE, "rain?", "en"))
    assert answer == "Answer from openai/gpt-oss-120b" and calls == ["openai/gpt-oss-120b"]


def test_repeat_question_with_same_data_reuses_the_answer():
    ctx = {"message": "Will it rain  tomorrow?", "loc": {"district": "Medak", "state": "Telangana"},
           "language": "en", "user_type": "farmer", "verdict": {"level": "LOW"},
           "current_dict": {"temperature": 30}, "forecast_dict": {"days": [{}, {"rainfall": 0.1}]},
           "evidence": {}}
    assert chat_api._cached_answer(ctx) is None
    chat_api._remember_answer(ctx, "cached answer")
    assert chat_api._cached_answer({**ctx, "message": "will it rain tomorrow?"}) == "cached answer"
    # New data or another place asks again.
    assert chat_api._cached_answer({**ctx, "forecast_dict": {"days": [{}, {"rainfall": 12}]}}) is None
    assert chat_api._cached_answer({**ctx, "loc": {"district": "Patna", "state": "Bihar"}}) is None
