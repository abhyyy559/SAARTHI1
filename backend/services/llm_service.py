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
    "State ONLY facts that appear in the VERIFIED BACKEND DATA given in the user message.\n"
    "Do not invent weather observations, forecasts or warnings.\n"
    "Do not create emergency warnings.\n"
    "Do not modify official warning severity.\n"
    "Do not claim that a warning exists unless the verified backend contains an active warning.\n"
    "Equally: never say, write or imply that there is NO warning, that conditions are\n"
    "safe, or that no alert is in force, unless the verified backend actually reports\n"
    "that the warning service was reached and returned nothing. When the warning\n"
    "service is unreachable or its status is 'unavailable', you must say that warnings\n"
    "could not be checked and that the user should confirm with IMD or local\n"
    "authorities. Silence from a broken service is not an all-clear.\n"
    "Always distinguish between official meteorological information and WeatherGPT interpretation.\n"
    "If information is unavailable, stale or incomplete, say so plainly.\n"
    "Lead with the safety picture: the warning status and any hazard. Never open the\n"
    "answer with temperature, and never let temperature be the most prominent number.\n"
    "The reader is deciding whether it is safe to go out, farm or put to sea.\n"
    "When discussing an emergency warning include: hazard, affected location, validity, source.\n"
    "Never present AI-generated advice as an official government instruction.\n"
    "NEVER give advice, recommendations, instructions, tips, suggestions, or practical actions of any kind.\n"
    "NEVER tell the user what they should do, avoid, prepare for, wear, carry, check, or cancel.\n"
    "NEVER phrase a fact as an instruction (e.g. 'expect heavy rain' is a fact; 'stay indoors' is forbidden advice).\n"
    "If the user asks what to do or for guidance, give the facts and say: "
    "'For guidance, check the Advisory tab in the app.' That tab is the ONLY place for guidance.\n"
    "Keep it short and simple - the listener may be a fisherman or farmer with a basic phone.\n"
    # --- BREVITY. The answer is READ ALOUD to someone deciding whether to go out. ---
    # Without these rules the model padded every answer with a restatement of the
    # question, a summary of its own summary, and a second copy of practical
    # advice - roughly 1000 characters where ~350 carries the same facts.
    # NOTE: the server does NOT append an advisory block to chat answers.
    # Chat answers are facts-only; advisory guidance travels separately in the
    # 'advisory' field of the /api/chat response (the app's Advisory tab).
    "LENGTH: at most 120 words total. This is a hard limit, not a target.\n"
    "Open with the safety answer itself - the hazard or the yes/no - in one short\n"
    "sentence of at most 20 words. Never open with 'Great question', 'Certainly',\n"
    "a restatement of what was asked, or a heading.\n"
    "DO NOT give practical actions, precautions, or 'what you can do' advice: that\n"
    "is delivered separately as the advisory and would be duplicated. State facts\n"
    "and the safety picture only.\n"
    "DO NOT repeat yourself. Say each fact once. No closing summary.\n"
    "Use at most 2 short sections, and at most 3 list items in total.\n"
    "If the user's occupation needs the sea or coast but VERIFIED BACKEND DATA shows\n"
    "their district is not coastal, say so plainly before any other advice.\n"
    "Format the answer for a simple screen reader: short paragraphs separated by blank\n"
    "lines. You may use '## ' at the start of a line for a section heading, '**' around\n"
    "a few key words, and lines starting with '- ' for a short list (max 4 items).\n"
    "No other markdown, no tables, no code blocks.\n"
    "When asked 'will it rain tomorrow' or similar rain query, answer Yes/No first with mm amount from tomorrow_rainfall_mm. If data missing, say 'rainfall forecast unavailable'.\n"
    "Answer the rain yes/no ONCE, in that opening sentence. Do not add a second\n"
    "'yes it will rain' later in the answer."
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


def build_evidence_package(*, location: dict, current: dict, forecast: dict, verified: dict, risk: dict, user_type: str,
                           source_name: str = "IMD") -> dict:
    # source_name is the source that actually supplied the forecast facts
    # (Open-Meteo in live mode, IMD in demo). Warnings always carry their own
    # source inside `verified`. Never default this to IMD blindly.
    days = forecast.get("days") or []
    tomorrow = days[1] if len(days) > 1 else (days[0] if days else {})
    tomorrow_rainfall_mm = tomorrow.get("rainfall")
    tomorrow_rainfall_prob = tomorrow.get("precipitation_probability")
    return {
        "source": source_name,
        "source_name": source_name,
        "source_type": ["current_observation", "city_forecast", "district_warning"],
        "location": location,
        "current_weather": current,
        "forecast": forecast,
        "verified_warning": verified,
        "weathergpt_risk": risk.get("level"),
        "user_type": user_type,
        "tomorrow_rainfall_mm": tomorrow_rainfall_mm,
        "tomorrow_rainfall_prob": tomorrow_rainfall_prob,
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
    # Honesty: "we could not check" is a different statement from "there is no
    # warning". Saying "no warning was found" while the warning service is down
    # is a false all-clear — the one thing this product must never emit.
    service_unreachable = verified.get("warning_service") == "unavailable"

    if warn:
        lines.append(
            f"There is an active official warning for {loc}: {verified.get('severity')} — {verified.get('hazard')}."
        )
        if verified.get("valid_until"):
            lines.append(f"It is valid until {verified.get('valid_until')}.")
    elif service_unreachable:
        lines.append(
            f"The official warning service for {loc} could not be reached, so we cannot "
            "confirm whether a warning is active. Please check IMD or local authorities directly."
        )
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

    lines.append(f"WeatherGPT Risk Interpretation for you ({user_type}): {risk}.")
    lines.append("This is our interpretation, not an IMD rating.")
    # Facts only on the chat surface: no advice here — guidance lives in the Advisory tab.
    lines.append("For safety guidance, check the Advisory tab in the app.")
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

        if not config.LLM_MODEL_KNOWN:
            # FAIL LOUD: a misconfigured model name used to degrade silently into the
            # template fallback. Surface the misconfiguration instead of hiding it.
            raise RuntimeError(
                f"Invalid LLM_MODEL '{config.LLM_MODEL}': not a known model on the "
                "configured endpoint. Fix LLM_MODEL (default: 'openai/gpt-oss-120b') "
                "or unset it to use the default."
            )

        user_type = evidence.get("user_type", "general")
        directive = LANG_DIRECTIVE.get(language, LANG_DIRECTIVE["en"])
        system = (
            f"{SYSTEM_RULES}\n{directive}\n"
            f"The user is a {user_type}: keep the facts simple and relevant to them, but give no advice."
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
                        # ~240 tokens is a comfortable ceiling for a 120-word
                        # answer plus headings; 400 invited padding.
                        "max_tokens": 240,
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