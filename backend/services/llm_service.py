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
    # LATENCY: the phrasing layer only ever reasons about ~3 days; sending all
    # 7 inflates every prompt for no gain. Trim the evidence copy, never the
    # caller's dict.
    if len(days) > 3:
        forecast = {**forecast, "days": days[:3]}
        days = forecast["days"]
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


# Template phrasing per language. The rule-based answer must respect the user's
# language even when the LLM is disabled — a Hindi user must never receive an
# English-only answer. English strings are unchanged from the original template.
_TEMPLATE_PHRASES = {
    "en": {
        "active_warning": "There is an active official warning for {loc}: {severity} — {hazard}.",
        "valid_until": "It is valid until {valid_until}.",
        "unreachable": ("The official warning service for {loc} could not be reached, so we cannot "
                        "confirm whether a warning is active. Please check IMD or local authorities directly."),
        "no_warning": "No active severe weather warning was found for {loc}.",
        "rain_yes": "Rain is possible tomorrow in {loc} according to the latest {src} forecast (expected rainfall: {rain} mm).",
        "rain_no": "The {src} forecast shows no significant rainfall expected tomorrow.",
        "rain_na": "Tomorrow's forecast rainfall information is not available from the current data.",
        "temp": "Tomorrow's temperature range: {tmin}–{tmax}°C.",
        "risk": "WeatherGPT Risk Interpretation for you ({user_type}): {risk}.",
        "risk_note": "This is our interpretation, not an IMD rating.",
        "advisory_note": "For safety guidance, check the Advisory tab in the app.",
    },
    "hi": {
        "active_warning": "{loc} के लिए सक्रिय आधिकारिक चेतावनी है: {severity} — {hazard}।",
        "valid_until": "यह {valid_until} तक वैध है।",
        "unreachable": ("{loc} की आधिकारिक चेतावनी सेवा से संपर्क नहीं हो सका, इसलिए हम पुष्टि "
                        "नहीं कर सकते कि कोई चेतावनी सक्रिय है या नहीं। कृपया IMD या स्थानीय प्रशासन से सीधे जाँचें।"),
        "no_warning": "{loc} के लिए कोई सक्रिय गंभीर मौसम चेतावनी नहीं मिली।",
        "rain_yes": "ताज़ा {src} पूर्वानुमान के अनुसार कल {loc} में बारिश संभव है (अनुमानित वर्षा: {rain} मिमी)।",
        "rain_no": "{src} पूर्वानुमान के अनुसार कल कोई खास बारिश की उम्मीद नहीं है।",
        "rain_na": "कल की वर्षा की जानकारी वर्तमान आंकड़ों में उपलब्ध नहीं है।",
        "temp": "कल का तापमान: {tmin}–{tmax}°C।",
        "risk": "आपके लिए WeatherGPT जोखिम व्याख्या ({user_type}): {risk}।",
        "risk_note": "यह हमारी व्याख्या है, IMD की रेटिंग नहीं।",
        "advisory_note": "सुरक्षा सलाह के लिए ऐप में Advisory टैब देखें।",
    },
    "te": {
        "active_warning": "{loc} కోసం క్రియాశీల అధికారిక హెచ్చరిక ఉంది: {severity} — {hazard}.",
        "valid_until": "ఇది {valid_until} వరకు చెల్లుతుంది.",
        "unreachable": ("{loc} యొక్క అధికారిక హెచ్చరిక సేవను చేరుకోలేకపోయాం, కాబట్టి హెచ్చరిక "
                        "క్రియాశీలంగా ఉందో లేదో నిర్ధారించలేము. దయచేసి IMD లేదా స్థానిక అధికారులను నేరుగా సంప్రదించండి."),
        "no_warning": "{loc} కోసం క్రియాశీల తీవ్ర వాతావరణ హెచ్చరిక ఏదీ కనిపించలేదు.",
        "rain_yes": "తాజా {src} అంచనా ప్రకారం రేపు {loc}లో వర్షం పడే అవకాశం ఉంది (అంచనా వర్షపాతం: {rain} మిమీ).",
        "rain_no": "{src} అంచనా ప్రకారం రేపు గణనీయమైన వర్షం అంచనా లేదు.",
        "rain_na": "రేపటి వర్షపాత సమాచారం ప్రస్తుత డేటాలో అందుబాటులో లేదు.",
        "temp": "రేపటి ఉష్ణోగ్రత పరిధి: {tmin}–{tmax}°C.",
        "risk": "మీ కోసం WeatherGPT ప్రమాద వివరణ ({user_type}): {risk}.",
        "risk_note": "ఇది మా వివరణ, IMD రేటింగ్ కాదు.",
        "advisory_note": "భద్రతా మార్గదర్శనం కోసం యాప్‌లోని Advisory ట్యాబ్ చూడండి.",
    },
}


def _phrases(language: str) -> dict:
    return _TEMPLATE_PHRASES.get(language, _TEMPLATE_PHRASES["en"])


def _template_answer(evidence: dict, language: str = "en") -> str:
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
    P = _phrases(language)
    # Honesty: "we could not check" is a different statement from "there is no
    # warning". Saying "no warning was found" while the warning service is down
    # is a false all-clear — the one thing this product must never emit.
    service_unreachable = verified.get("warning_service") == "unavailable"

    if warn:
        lines.append(
            P["active_warning"].format(loc=loc, severity=verified.get('severity'), hazard=verified.get('hazard'))
        )
        if verified.get("valid_until"):
            lines.append(P["valid_until"].format(valid_until=verified.get('valid_until')))
    elif service_unreachable:
        lines.append(P["unreachable"].format(loc=loc))
    else:
        lines.append(P["no_warning"].format(loc=loc))

    if fc_rain is not None and fc_rain > 0:
        lines.append(P["rain_yes"].format(loc=loc, src=src, rain=fc_rain))
    elif fc_rain == 0:
        lines.append(P["rain_no"].format(src=src))
    else:
        lines.append(P["rain_na"])

    if fc_min is not None and fc_max is not None:
        lines.append(P["temp"].format(tmin=fc_min, tmax=fc_max))

    lines.append(P["risk"].format(user_type=user_type, risk=risk))
    lines.append(P["risk_note"])
    # Facts only on the chat surface: no advice here — guidance lives in the Advisory tab.
    lines.append(P["advisory_note"])
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
            return _template_answer(evidence, language), True

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
            return _template_answer(evidence, language), True

        content = _THINK.sub("", content or "").strip()
        if not content:
            return _template_answer(evidence, language), True
        return content, False

    async def generate_stream(self, evidence: dict, question: str, language: str):
        """Yield {"type": "token", "text": delta} as the model produces them, then
        {"type": "end", "fallback": bool, "model_error": str, "truncated": bool}.

        Token streaming for the chat UI's live reveal — the first token reaches
        the user without waiting for the full response. Any failure degrades to
        the grounded template answer (single token, fallback=True); a mid-stream
        failure ends with truncated=True so the caller substitutes the template.
        <think>...</think> spans are filtered incrementally so model reasoning
        can never leak into the visible stream.
        """
        if not self.enabled:
            yield {"type": "token", "text": _template_answer(evidence, language)}
            yield {"type": "end", "fallback": True, "model_error": "", "truncated": False}
            return
        if not config.LLM_MODEL_KNOWN:
            model_error = (
                f"Invalid LLM_MODEL '{config.LLM_MODEL}': not a known model on the "
                "configured endpoint. Fix LLM_MODEL (default: 'openai/gpt-oss-120b') "
                "or unset it to use the default."
            )
            yield {"type": "token", "text": _template_answer(evidence, language)}
            yield {"type": "end", "fallback": True, "model_error": model_error, "truncated": False}
            return

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
        payload = {
            "model": config.LLM_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "max_tokens": 240,
            "stream": True,
        }
        sent_any = False
        try:
            async with httpx.AsyncClient(timeout=config.LLM_TIMEOUT) as client:
                async with client.stream(
                    "POST",
                    f"{config.LLM_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
                    json=payload,
                ) as resp:
                    resp.raise_for_status()
                    buf = ""
                    thinking = False
                    async for line in resp.aiter_lines():
                        s = line.strip()
                        if not s.startswith("data:"):
                            continue
                        data = s[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                        except Exception:
                            continue
                        delta = (obj.get("choices") or [{}])[0].get("delta", {}).get("content") or ""
                        if not delta:
                            continue
                        buf += delta
                        # Incremental <think> filter: hold everything from an
                        # opening tag until its close tag; drop the span.
                        out = []
                        while buf:
                            if not thinking:
                                i = buf.find("<think>")
                                if i < 0:
                                    # Hold a trailing partial tag ("<", "<th", …)
                                    # so a tag split across chunks can't leak.
                                    hold = 0
                                    for k in range(1, min(len(buf), 7) + 1):
                                        if buf[-k:] == "<think>"[:k]:
                                            hold = k
                                    out.append(buf[:len(buf) - hold] if hold else buf)
                                    buf = buf[len(buf) - hold:] if hold else ""
                                else:
                                    out.append(buf[:i])
                                    buf = buf[i:]
                                    thinking = True
                            else:
                                j = buf.find("</think>")
                                if j < 0:
                                    break  # hold until the close tag (or EOS)
                                buf = buf[j + len("</think>"):]
                                thinking = False
                        if out:
                            sent_any = True
                            yield {"type": "token", "text": "".join(out)}
                    # Flush the tail; an unclosed <think> at EOS means a
                    # reasoning fragment — dropped, never shown.
                    if not thinking and buf:
                        sent_any = True
                        yield {"type": "token", "text": buf}
        except Exception:
            if not sent_any:
                yield {"type": "token", "text": _template_answer(evidence, language)}
                yield {"type": "end", "fallback": True, "model_error": "", "truncated": False}
            else:
                yield {"type": "end", "fallback": True, "model_error": "", "truncated": True}
            return
        if not sent_any:
            yield {"type": "token", "text": _template_answer(evidence, language)}
            yield {"type": "end", "fallback": True, "model_error": "", "truncated": False}
            return
        yield {"type": "end", "fallback": False, "model_error": "", "truncated": False}