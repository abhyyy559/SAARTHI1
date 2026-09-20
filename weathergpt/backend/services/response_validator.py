"""Post-LLM response validation (§10 pipeline stage, §43 AI safety rules).

The LLM explains reality; this gate checks the explanation before delivery:
RULE A/B (no invented/escalated severity), RULE C (no invented timestamps),
RULE D (no invented government instructions), RULE G (no invented certainty).
Violations -> safe fallback built from verified data only (RULE F).
"""
from __future__ import annotations

import re

SEVERITIES = ("GREEN", "YELLOW", "ORANGE", "RED")
_RANK = {s: i for i, s in enumerate(SEVERITIES)}
_PCT = re.compile(r"(\d{1,3})\s*%")

_NEGATION = ("no ", "not ", "n't ", "neither", "without")

_FALLBACKS = {
    True: {
        "en": "There is an active official warning: {sev} - {haz}. Valid until {until}. Follow local authority instructions.",
        "hi": "एक सरकारी चेतावनी सक्रिय है: {sev} - {haz}. यह {until} तक लागू है। स्थानीय प्रशासन के निर्देश मानें।",
        "te": "ఒక అధికారిక హెచ్చరిక సక్రియంగా ఉంది: {sev} - {haz}. ఇది {until} వరకు అమలులో ఉంటుంది. స్థానిక అధికారుల సూచనలు పాటించండి.",
    },
    False: {
        "en": "No active verified warning was found for your area based on currently available data.",
        "hi": "उपलब्ध आंकड़ों के आधार पर आपके क्षेत्र के लिए कोई सक्रिय सत्यापित चेतावनी नहीं मिली।",
        "te": "అందుబాటులో ఉన్న డేటా ప్రకారం మీ ప్రాంతానికి ఎటువంటి సక్రియ ధృవీకరించిన హెచ్చరిక లేదు.",
    },
}

# The warning service was unreachable. This is NOT a calm and must never be
# phrased as one — "we could not check" and "there is nothing" are different facts.
_UNREACHABLE_FALLBACK = {
    "en": "The official warning service could not be reached, so we cannot confirm whether a warning is active for your area. Please check IMD or local authorities directly.",
    "hi": "सरकारी चेतावनी सेवा उपलब्ध नहीं हो सकी, इसलिए हम पुष्टि नहीं कर सकते कि आपके क्षेत्र में चेतावनी सक्रिय है या नहीं। कृपया IMD या स्थानीय प्रशासन से सीधे जाँचें।",
    "te": "అధికారిక హెచ్చరిక సేవను చేరుకోలేకపోయాం, కాబట్టి మీ ప్రాంతానికి హెచ్చరిక ఉందో లేదో ధృవీకరించలేము. దయచేసి IMD లేదా స్థానిక అధికారులను నేరుగా సంప్రదించండి.",
}

# RULE H — the false all-clear.
#
# Prompting alone did not stop this: with an unreachable warning service the
# model wrote "There is no active official warning from IMD for this area. The
# warning service status is listed as unavailable." The all-clear lands and the
# caveat trails behind it. So the gate checks for it directly.
#
# These match the *existential* claim ("no warning exists"), not a bare mention
# of a warning. That distinction matters: an honest answer says "we cannot
# confirm whether a warning is active", and a backward negation window would
# wrongly flag that — "cannot" contains "not". Only an explicit "no ... warning"
# construction is a violation.
_FALSE_ALL_CLEAR = (
    # "no active official warning", "no severe weather alert", "no warnings" …
    # The lookahead spares the honest "no warning information was retrieved".
    re.compile(r"\bno\s+(?:active\s+)?(?:official\s+)?(?:severe\s+weather\s+)?(?:weather\s+)?(?:warning|warnings|alert|alerts)\b(?!\s+(?:information|service|data))", re.I),
    re.compile(r"\b(?:all\s+clear|conditions\s+are\s+safe|no\s+danger|nothing\s+to\s+worry)\b", re.I),
    re.compile(r"\bsafe\s+to\s+(?:go|travel|sail|fish|venture)\b", re.I),
)
# Hindi and Telugu carry the negation inside the phrase, so these are matched
# literally rather than through an English negation window.
_FALSE_ALL_CLEAR_OTHER = (
    "कोई सक्रिय चेतावनी नहीं", "कोई चेतावनी नहीं", "कोई अलर्ट नहीं", "कोई खतरा नहीं",
    "ఎటువంటి హెచ్చరిక లేదు", "సక్రియ హెచ్చరిక లేదు", "ఎలాంటి హెచ్చరిక లేదు", "ప్రమాదం లేదు",
)


def _false_all_clear(answer: str) -> str | None:
    """The offending phrase when the answer claims no warning exists, else None."""
    for rx in _FALSE_ALL_CLEAR:
        m = rx.search(answer)
        if m:
            return m.group(0)
    for phrase in _FALSE_ALL_CLEAR_OTHER:
        if phrase in answer:
            return phrase
    return None


def _neutralise_false_all_clear(answer: str, language: str = "en") -> str:
    """Replace the offending line, keep the rest of the answer.

    Discarding a whole grounded answer because one clause is unsafe is a bad
    trade: the forecast the user asked for is real, verified and useful. Only the
    line carrying the false all-clear is rewritten, and it is rewritten to the
    honest statement rather than deleted, so the warning status stays visible.
    """
    lang = language if language in ("en", "hi", "te") else "en"
    honest = _UNREACHABLE_FALLBACK[lang]
    lines = answer.split("\n")
    for i, line in enumerate(lines):
        if _false_all_clear(line):
            lines[i] = honest
    return "\n".join(lines)


def _negated(answer: str, pos: int) -> bool:
    window = answer[max(0, pos - 12):pos].lower()
    return any(neg in window for neg in _NEGATION)


def validate(answer: str, verified: dict, evidence_numbers: list[float], language: str = "en") -> tuple[str, list[str]]:
    """Returns (answer_to_send, findings). Findings empty when clean."""
    findings: list[str] = []
    official = (verified.get("severity") or "GREEN").upper()
    active = bool(verified.get("verified"))

    mentioned = []
    for s in SEVERITIES:
        for m in re.finditer(rf"\b{s}\b", answer):
            if not _negated(answer, m.start()):
                mentioned.append(s)
                break
    escalated = [s for s in mentioned if _RANK.get(s, 0) > _RANK.get(official, 0)]
    if escalated and official in SEVERITIES:
        findings.append(f"severity-escalation: answer mentions {escalated}, official is {official}")

    for m in _PCT.finditer(answer):
        if float(m.group(1)) not in [float(n) for n in evidence_numbers]:
            findings.append(f"invented-probability: {m.group(0)} not in evidence")
            break

    low = answer.lower()
    if (not active) and any(p in low for p in ("imd has issued", "red alert is active", "warning is in effect", "alert has been issued")):
        findings.append("unverified-warning-claim without active verified warning")

    # RULE H: a broken feed must never be delivered as a calm.
    if verified.get("warning_service") == "unavailable":
        hit = _false_all_clear(answer)
        if hit:
            findings.append(
                f"false-all-clear: claims no warning while the warning service is unreachable ({hit!r})"
            )

    if any(p in low for p in ("government orders", "as per government order", "official instruction:")) and not verified.get("official_instruction"):
        findings.append("fake-government-instruction")

    if findings:
        # A false all-clear on its own is repaired in place, so the verified
        # forecast the user asked for survives. Anything else — or an all-clear
        # alongside another violation — falls back to verified data only.
        if all(f.startswith("false-all-clear:") for f in findings):
            return _neutralise_false_all_clear(answer, language), findings
        return _safe_fallback(verified, language), findings
    return answer, findings


def _safe_fallback(verified: dict, language: str = "en") -> str:
    lang = language if language in ("en", "hi", "te") else "en"
    if verified.get("verified"):
        text = _FALLBACKS[True].get(lang, _FALLBACKS[True]["en"]).format(
            sev=verified.get("severity"), haz=verified.get("hazard", "Severe weather"),
            until=verified.get("valid_until"))
    elif verified.get("warning_service") == "unavailable":
        # Never let the safe fallback itself become a false all-clear.
        text = _UNREACHABLE_FALLBACK[lang]
    else:
        text = _FALLBACKS[False].get(lang, _FALLBACKS[False]["en"])
    return f"[STRUCTURED] {text}"
