"""Grounded LLM service — evidence package -> real LLM call (Groq/OpenAI-compatible).

LLM is the rehearsal/delivery layer only: it may phrase and explain, never invent.
If no key, or the call fails, the rule-based template answer guarantees grounding.
Language is enforced here: the answer is composed in the user's language.
"""
import json
import re

import httpx

from .. import config

SYSTEM_RULES = (
    "You are the conversational intelligence layer of WeatherGPT.\n"
    "Use only the VERIFIED BACKEND DATA given in the user message for weather facts.\n"
    "Do not invent weather observations, forecasts or warnings.\n"
    "Do not create emergency warnings.\n"
    "Do not modify official warning severity.\n"
    "Do not claim that a warning exists unless the verified backend contains an active warning.\n"
    "Always distinguish between official meteorological information and WeatherGPT interpretation.\n"
    "If information is unavailable, stale or incomplete, say so plainly.\n"
    "When discussing an emergency warning include: hazard, affected location, validity, source.\n"
    "Give practical actions suited to the user's occupation.\n"
    "Never present AI-generated advice as an official government instruction.\n"
    "Keep it short and simple - the listener may be a fisherman or farmer with a basic phone.\n"
)

# Language is a hard requirement, not a hint.
LANG_DIRECTIVE = {
    "en": "Answer in simple English. No other language anywhere in the answer.",
    "hi": "पूरा उत्तर सरल हिंदी (देवनागरी लिपि) में दें। अंग्रेज़ी शब्द सिर्फ़ ज़रूरी होने पर। कोई और भाषा नहीं।",
    "te": "పూర్తి సమాధానం సరళ తెలుగులో ఇవ్వండి. ఇతర భాషలు వాడకండి.",
}

# Strip <think>...</think> reasoning blocks (qwen/gpt-oss emit them).
_LT = chr(60)  # "<"
_THINK = re.compile(_LT + "think" + chr(62) + ".*?" + _LT + "/think" + chr(62), re.S)


def build_evidence_package(*, location: dict, current: dict, forecast: dict, verified: dict, risk: dict, user_type: str) -> dict:
    return {
        "source": "IMD",
        "source_type": ["current_observation", "city_forecast", "district_warning"],
        "location": location,
        "current_weather": current,
        "forecast": forecast,
        "verified_warning": verified,
        "weathergpt_risk": risk.get("level"),
        "user_type": user_type,
    }


def _template_answer(evidence: dict) -> str:
    """Rule-based grounded answer. Used when the LLM is disabled or unreachable."""
    verified = evidence.get("verified_warning", {})
    forecast = evidence.get("forecast", {})
    risk = evidence.get("weathergpt_risk", "LOW")
    location_name = evidence.get("location", {}).get("city") or evidence.get("location", {}).get("district")
    loc = location_name or "your area"
    user_type = evidence.get("user_type", "general")
    src = evidence.get("source_name", evidence.get("source", "IMD"))

    days = forecast.get("days") or []
    tomorrow = days[1] if len(days) > 1 else (days[0] if days else {})
    fc_rain = tomorrow.get("rainfall")
    fc_min = tomorrow.get("min_temperature")
    fc_max = tomorrow.get("max_temperature")

    lines = []
    warn = verified.get("verified", False)

    if warn:
        lines.append(
            f"There is an active official warning for {loc}: {verified.get('severity')} — {verified.get('hazard')}."
        )
        if verified.get("valid_until"):
            lines.append(f"It is valid until {verified.get('valid_until')}.")
    else:
        lines.append(f"No active severe weather warning was found for {loc}.")

    if fc_rain is not None and fc_rain > 0:
        lines.append(f"Rain is possible tomorrow in {loc} according to the latest {src} forecast (expected rainfall: {fc_rain} mm).")
    elif fc_rain == 0:
        lines.append(f"The {src} forecast shows no significant rainfall expected tomorrow.")
    else:
        lines.append("Tomorrow's forecast rainfall information is not available from the current data.")

    if fc_min is not None and fc_max is not None:
        lines.append(f"Tomorrow's temperature range: {fc_min}–{fc_max}°C.")

    if warn:
        lines.append(
            "What you can do: stay alert, follow local authority instructions, and avoid exposed areas during the warning period."
        )

    lines.append(f"WeatherGPT Risk Interpretation for you ({user_type}): {risk}.")
    lines.append("This is our interpretation, not an IMD rating.")
    return " ".join(lines)


class LLMService:
    def __init__(self) -> None:
        self.enabled = bool(config.LLM_API_KEY)

    def generate_grounded_response(self, evidence: dict) -> tuple[str, bool]:
        """Rule-based answer (sync path kept for tests/offline). (answer, structured_fallback)"""
        return _template_answer(evidence), not self.enabled

    async def generate(self, evidence: dict, question: str, language: str) -> tuple[str, bool]:
        """Real LLM answer in the user's language, grounded in evidence only.

        Returns (answer, structured_fallback). Any failure falls back to the
        rule-based template — the user still gets a grounded answer.
        """
        if not self.enabled:
            return _template_answer(evidence), True

        user_type = evidence.get("user_type", "general")
        directive = LANG_DIRECTIVE.get(language, LANG_DIRECTIVE["en"])
        system = (
            f"{SYSTEM_RULES}\n{directive}\n"
            f"The user is a {user_type}. Shape the practical advice for that occupation."
        )
        user = (
            "VERIFIED BACKEND DATA (the only source of facts):\n"
            f"{json.dumps(evidence, ensure_ascii=False, default=str)}\n\n"
            f"USER QUESTION: {question}\n"
            "Answer from the data above. If a fact is missing, say it is not available."
        )
        try:
            async with httpx.AsyncClient(timeout=config.LLM_TIMEOUT) as client:
                resp = await client.post(
                    f"{config.LLM_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
                    json={
                        "model": config.LLM_MODEL,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "temperature": 0.2,
                        "max_tokens": 700,
                    },
                )
                resp.raise_for_status()
                content = (resp.json().get("choices") or [{}])[0].get("message", {}).get("content", "")
        except Exception:
            return _template_answer(evidence), True

        content = _THINK.sub("", content or "").strip()
        if not content:
            return _template_answer(evidence), True
        return content, False