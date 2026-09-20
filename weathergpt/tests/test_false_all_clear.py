"""RULE H — the false all-clear gate.

The bug this guards: with the warning service unreachable, the LLM wrote

    "There is no active official warning from IMD for this area.
     The warning service status is listed as unavailable."

The all-clear is what a reader takes away; the caveat trails behind it. For a
farmer deciding whether to spray, or a fisherman deciding whether to put to sea,
that sentence is worse than saying nothing at all. Prompting alone did not stop
it, so the delivery gate checks for it directly.
"""
from backend.services.response_validator import validate, _false_all_clear

# What the backend sends when IMD could not be reached.
UNREACHABLE = {"verified": False, "warning_service": "unavailable"}


def test_blocks_the_exact_false_all_clear_that_shipped():
    answer = (
        "## Warnings\n\nThere is **no active official warning** from the India "
        "Meteorological Department (IMD) for this area. The warning service status "
        "is listed as unavailable.\n\n## Practical Advice\n\nKeep an umbrella ready."
    )
    sent, findings = validate(answer, UNREACHABLE, [], "en")
    assert findings, "a false all-clear must be caught"
    assert "false-all-clear" in findings[0]
    assert "no active official warning" in findings[0]
    # The offending line is rewritten to the honest statement.
    assert "could not be reached" in sent
    assert "no active official warning" not in sent
    # ...and the rest of the grounded answer survives, because the forecast the
    # user asked for is real and throwing it away helps nobody.
    assert "Keep an umbrella ready." in sent
    assert sent.startswith("## Warnings")


def test_surgical_repair_keeps_the_forecast_and_fixes_every_bad_line():
    answer = (
        "## Current Weather\n\nIt is 29 degrees and overcast.\n\n"
        "## Warnings\n\nThere are no warnings in effect.\n\n"
        "## Advice\n\nNo active warning is in force, so it is all clear today.\n"
    )
    sent, findings = validate(answer, UNREACHABLE, [29], "en")
    assert findings
    assert "It is 29 degrees and overcast." in sent
    assert "no warnings in effect" not in sent
    assert "all clear" not in sent
    # Both offending lines replaced, honest statement present.
    assert sent.count("could not be reached") == 2


def test_honest_unreachable_phrasing_is_not_flagged():
    """'We could not check' is the correct statement and must pass untouched.

    This is the case a backward negation window would get wrong: 'cannot'
    contains 'not', so a naive check would flag the very wording we want.
    """
    answer = (
        "The official warning service could not be reached, so we cannot confirm "
        "whether a warning is active for your area. Please check IMD or local "
        "authorities directly."
    )
    sent, findings = validate(answer, UNREACHABLE, [], "en")
    assert findings == []
    assert sent == answer


def test_honest_mentions_of_a_warning_are_not_flagged():
    for answer in (
        "We could not confirm if a warning is active. Please check IMD directly.",
        "No warning information was retrieved from the official service.",
        "A red warning is in effect until 20:29.",
        "Rain is expected tomorrow with 11.9 mm. Keep an umbrella ready.",
    ):
        assert _false_all_clear(answer) is None, answer


def test_catches_all_clear_phrasings_in_all_three_languages():
    for answer in (
        "There are no warnings in effect for your district.",
        "No active alert is in force.",
        "It is all clear today.",
        "Conditions are safe for travel.",
        "It is safe to sail this morning.",
        "कोई सक्रिय चेतावनी नहीं है।",
        "ఎటువంటి హెచ్చరిక లేదు.",
    ):
        assert _false_all_clear(answer) is not None, answer


def test_gate_is_inert_when_the_service_was_reachable():
    """A genuine all-clear is correct once the service answered with nothing.

    The gate must only fire on the unreachable case — otherwise a calm district
    could never be reported as calm.
    """
    reachable = {"verified": False, "warning_service": "available"}
    answer = "No active severe weather warning was found for your area."
    sent, findings = validate(answer, reachable, [], "en")
    assert findings == []
    assert sent == answer
