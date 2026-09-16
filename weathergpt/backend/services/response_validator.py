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


def validate(answer: str, verified: dict, evidence_numbers: list[float]) -> tuple[str, list[str]]:
    """Returns (answer_to_send, findings). Findings empty when clean."""
    findings: list[str] = []
    official = (verified.get("severity") or "GREEN").upper()
    active = bool(verified.get("verified"))

    mentioned = [s for s in SEVERITIES if re.search(rf"\b{s}\b", answer)]
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
        safe = _safe_fallback(verified)
        return safe, findings
    return answer, findings


def _safe_fallback(verified: dict) -> str:
    if verified.get("verified"):
        return (
            f"[STRUCTURED] There is an active official warning: {verified.get('severity')} — "
            f"{verified.get('hazard', 'Severe weather')}. Valid until {verified.get('valid_until')}. "
            f"Follow local authority instructions."
        )
    return "[STRUCTURED] No active verified warning was found for your area based on currently available data."
