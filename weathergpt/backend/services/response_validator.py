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

    if any(p in low for p in ("government orders", "as per government order", "official instruction:")) and not verified.get("official_instruction"):
        findings.append("fake-government-instruction")

    if findings:
        return _safe_fallback(verified, language), findings
    return answer, findings


def _safe_fallback(verified: dict, language: str = "en") -> str:
    if verified.get("verified"):
        text = _FALLBACKS[True].get(language, _FALLBACKS[True]["en"]).format(
            sev=verified.get("severity"), haz=verified.get("hazard", "Severe weather"),
            until=verified.get("valid_until"))
    else:
        text = _FALLBACKS[False].get(language, _FALLBACKS[False]["en"])
    return f"[STRUCTURED] {text}"
