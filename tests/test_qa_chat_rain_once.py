"""QA: a rain question gets its yes/no EXACTLY once.

The reviewer's fix stopped the answer being given twice. QA found the mirror
defect still live: the guard suppressed prepending on ANY early `yes`/`no`
token, so an answer whose opening sentence merely mentioned one
("There is no active weather warning...") left the rain question with no
yes/no at all. "Exactly once" means not zero, either.

Both halves are pinned here, at the helper and at the endpoint.
"""
import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.api.chat import _ensure_rain_lead
from backend.main import app

RAIN_FORECAST = {"source": "IMD", "days": [{"rainfall": 1.0}, {"rainfall": 22.0}]}
DRY_FORECAST = {"source": "IMD", "days": [{"rainfall": 0.0}, {"rainfall": 0.0}]}
LEAD = "Yes — rain likely tomorrow (22.0 mm)."


# ---------------------------------------------------------------------------
# Pure helper
# ---------------------------------------------------------------------------
def test_no_lead_when_the_answer_already_answers():
    for answer in (
        "**Yes**, it will rain tomorrow.\n\nAround 22 mm is expected.",
        "Yes. Rain is likely tomorrow.",
        "No rain expected tomorrow.",
        "No, it will stay dry tomorrow.",
        "For Hyderabad: no, it will not rain tomorrow.",
    ):
        out = _ensure_rain_lead("Will it rain tomorrow?", RAIN_FORECAST, answer)
        assert out == answer, out


def test_lead_added_when_the_answer_does_not_answer():
    for answer in (
        "Temperatures will reach 31 C with high humidity.",
        "There is no active weather warning for your district right now.",
        "The IMD feed was unreachable, so the outlook is unconfirmed.",
    ):
        out = _ensure_rain_lead("Will it rain tomorrow?", RAIN_FORECAST, answer)
        assert out.startswith(LEAD), out


def test_no_lead_for_a_non_rain_question():
    answer = "Temperatures will reach 31 C."
    assert _ensure_rain_lead("How hot is it?", RAIN_FORECAST, answer) == answer


def test_dry_forecast_says_no():
    answer = "Temperatures will reach 31 C."
    out = _ensure_rain_lead("Will it rain tomorrow?", DRY_FORECAST, answer)
    assert out.startswith("No rain expected tomorrow."), out


def test_missing_forecast_never_invents_an_answer():
    answer = "Temperatures will reach 31 C."
    assert _ensure_rain_lead("Will it rain tomorrow?", None, answer) == answer


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@pytest.fixture()
def client(monkeypatch):
    config.DEMO_MODE = True

    async def fake_retrieve(loc):
        current = {"source": "IMD", "temperature": 28.0}
        verified = {"verified": False, "severity": "GREEN", "hazard": None}
        return current, RAIN_FORECAST, verified, [], {"source_name": "IMD"}

    async def fake_generate(self, evidence, question, language):
        return fake_generate.answer, False

    import backend.api.chat as chat
    monkeypatch.setattr(chat, "_retrieve_demo", fake_retrieve)
    monkeypatch.setattr(chat.LLMService, "generate", fake_generate)
    fake_generate.answer = ""
    with TestClient(app) as c:
        c.fake_generate = fake_generate
        yield c


def _ask(client, answer, message="Will it rain tomorrow?"):
    client.fake_generate.answer = answer
    r = client.post("/api/chat", json={"message": message, "user_type": "general"})
    assert r.status_code == 200, r.text
    return r.json()["answer"]


def test_endpoint_never_gives_the_rain_answer_twice(client):
    answer = _ask(client, "**Yes**, it will rain tomorrow.\n\nAround 22 mm is expected.")
    assert LEAD not in answer, answer
    assert answer.lower().count("yes") == 1, answer


def test_endpoint_gives_the_rain_answer_when_only_a_bare_no_is_present(client):
    answer = _ask(client, "There is no active weather warning for your district right now.")
    assert answer.startswith(LEAD), answer


def test_endpoint_still_adds_the_lead_when_the_answer_buries_it(client):
    answer = _ask(client, "Temperatures will reach 31 C with high humidity.")
    assert answer.startswith(LEAD), answer
