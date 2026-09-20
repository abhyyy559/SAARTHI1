"""The chat answer must not answer the same question twice.

Regression guard for a duplication that shipped: a rain question came back as

    Yes — rain likely tomorrow (22.0 mm).

    ## Warning Status
    **Yes**, it will rain tomorrow. ...

Two consecutive answers to the same yes/no question, because the server
prepended its guaranteed rain line without checking whether the LLM had already
answered. The old guard compared the exact line text, which could not catch a
differently-worded but identical answer.
"""
from backend.api.chat import _ensure_rain_lead

FORECAST = {"days": [{"rainfall": 1.0}, {"rainfall": 22.0}, {"rainfall": 0.0}]}
DRY = {"days": [{"rainfall": 0.0}, {"rainfall": 0.0}]}


def test_does_not_prepend_when_the_answer_already_says_yes():
    """The exact shipped bug: the LLM answered, and we prepended anyway."""
    answer = "## Warning Status\n\n**Yes**, it will rain tomorrow.\n\n22 mm expected."
    out = _ensure_rain_lead("Will it rain tomorrow?", FORECAST, answer)
    assert out == answer, "the answer was already given; it must not be given twice"
    assert out.count("Yes") == 1


def test_does_not_prepend_when_the_answer_already_says_no():
    answer = "No, it will stay dry tomorrow."
    out = _ensure_rain_lead("Will it rain tomorrow?", DRY, answer)
    assert out == answer


def test_prepends_when_the_answer_buries_the_rain_verdict():
    """No yes/no up front -> the plain answer is added, once."""
    answer = "Temperatures will reach 31 C with high humidity across the district."
    out = _ensure_rain_lead("Will it rain tomorrow?", FORECAST, answer)
    assert out.startswith("Yes — rain likely tomorrow (22.0 mm).")
    assert out.endswith(answer)
    assert out.count("rain likely tomorrow") == 1


def test_dry_forecast_says_no_rain():
    answer = "Conditions look settled."
    out = _ensure_rain_lead("Will it rain tomorrow?", DRY, answer)
    assert out.startswith("No rain expected tomorrow.")


def test_non_rain_question_is_left_alone():
    answer = "A YELLOW thunderstorm warning is active until 5 PM."
    assert _ensure_rain_lead("Is there a red alert now?", FORECAST, answer) == answer


def test_missing_forecast_is_left_alone():
    """No data means no invented answer."""
    answer = "Rainfall forecast unavailable."
    assert _ensure_rain_lead("Will it rain tomorrow?", None, answer) == answer
    assert _ensure_rain_lead("Will it rain tomorrow?", {"days": []}, answer) == answer


def test_localised_rain_words_are_recognised():
    answer = "मौसम साफ़ रहेगा।"
    out = _ensure_rain_lead("कल बारिश होगी?", FORECAST, answer)
    assert out.startswith("Yes — rain likely tomorrow")
