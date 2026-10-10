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
    "When discussing an emergency warning include the hazard, the place, and until when (in words).\n"
    # --- PLAIN LANGUAGE. Read by people who are not weather experts. ---
    "Use plain, everyday words. Use few numbers, rounded to whole numbers; prefer the\n"
    "words given in the data (light / moderate / heavy rain, wind_words, sea_words,\n"
    "uv_words, tomorrow_rain_words). Never quote millimetres, decimals or timestamps,\n"
    "and say rain chance in words (low / some / high chance) unless NUMBERS ALLOWED\n"
    "says otherwise below.\n"
    "Do not mention data sources, 'verified data', fallbacks, models or how the answer\n"
    "was produced: the app shows the sources under the answer.\n"
    "Keep it short and simple - the listener may be a fisherman or farmer with a basic phone.\n"
    # --- ADVICE. Users asked for answers they can act on, not facts alone. ---
    # The chat used to refuse all advice and point to the Advisory tab, so a
    # farmer asking "can I spray today?" got a forecast and no answer. Advice is
    # now given, but only as WeatherGPT guidance that follows from the data,
    # never as an official order, and never weaker than the rule-based
    # app_guidance or an official warning.
    "GIVE ADVICE. The user wants to know what to do. After the safety picture, give\n"
    "clear, practical advice for THEIR role and profile: what to do, the best and the\n"
    "worst time for it (use parts_of_day), and what to watch for. Answer 'can I / should\n"
    "I / is it safe' questions directly with a clear yes, no, or 'only if ...'.\n"
    "Every piece of advice must follow from a fact in the data. Do not invent hazards.\n"
    "app_guidance is the app's rule-based guidance for this user: stay consistent with\n"
    "it and never be less cautious than it.\n"
    "If an official warning is active, put it first and tell the user to follow IMD and\n"
    "local authority instructions; your advice comes after and must not contradict it.\n"
    "Never call anything safe (going to sea, travel, field work, outdoor work) when a\n"
    "warning is active, when the warning status could not be checked, or when the data\n"
    "shows strong wind or worse, rough sea or worse, heavy rain, or thunderstorms.\n"
    "Your advice is WeatherGPT guidance, not an official government instruction: never\n"
    "present it as one, and never write 'government orders' or 'official instruction'.\n"
    "If the data needed for a decision is missing, say so and give the cautious option.\n"
    "When a profile is given, the advice MUST use it exactly as written: name their\n"
    "crop and its stage, their boat or their vehicle, and fit their work hours. Only\n"
    "when the profile lists a health need (elderly, children, asthma, heart, pregnancy)\n"
    "add one line for that person; never invent profile details that are not given.\n"
    "When the warning status could not be checked, the opening sentence must say the\n"
    "plan cannot be confirmed safe, and no later line may call it safe, good,\n"
    "suitable or favourable. Every rule here applies equally in Hindi and Telugu.\n"
    # --- BREVITY. The answer is READ ALOUD to someone deciding whether to go out. ---
    # Without these rules the model padded every answer with a restatement of the
    # question, a summary of its own summary, and a second copy of practical
    # advice - roughly 1000 characters where ~350 carries the same facts.
    "LENGTH: at most 110 words total, in every language, and at most 4 list items in\n"
    "total. This is a hard limit, not a target. Talk only about the time asked about.\n"
    "Open with the direct answer - the hazard, the yes/no, or the can/cannot - in one\n"
    "short sentence of at most 20 words. Never open with 'Great question', 'Certainly',\n"
    "a restatement of what was asked, or a heading.\n"
    "DO NOT repeat yourself. Say each fact once. No closing summary.\n"
    "If the user's occupation needs the sea or coast but VERIFIED BACKEND DATA shows\n"
    "their district is not coastal, say so plainly before any other advice.\n"
    "Format the answer for a simple screen reader: short paragraphs separated by blank\n"
    "lines. You may use '**' around a few key words and lines starting with '- ' for a\n"
    "short list (used for the advice). No headings, bold section titles such as\n"
    "'Advice:' or 'Weather:', tables or code blocks.\n"
    "If the question asks about a different day or time of day, answer for that time\n"
    "from parts_of_day / outlook, not for right now.\n"
    "Earlier turns of this conversation come before the question: use them to\n"
    "understand follow-ups, but take every fact from the current data only.\n"
    "When asked 'will it rain tomorrow' or similar rain query, answer Yes/No first and say how much in words (tomorrow_rain_words), never in mm. If data missing, say 'rainfall forecast unavailable'.\n"
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
# An UNCLOSED trailing <think> (model hit max_tokens before </think>): strip
# from the opening tag to the end so chain-of-thought can never leak. The
# streaming path already drops unclosed spans at EOS; this keeps the
# non-streaming fallback identical (one pipeline, one truth).
_THINK_OPEN = re.compile(_LT + "think" + chr(62) + ".*", re.S)


def _strip_think_blocks(text):
    return _THINK_OPEN.sub("", _THINK.sub("", text or "")).strip()


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
        # The same amount as IMD's rain category in words (none / a few drops /
        # light / moderate / heavy ...): what the answer should say.
        "tomorrow_rain_words": (rain_category(tomorrow_rainfall_mm) or "").replace("_", " ") or None,
        "tomorrow_rainfall_prob": tomorrow_rainfall_prob,
    }


# --- Plain-language rain -------------------------------------------------------
# IMD's own daily rainfall categories, so an answer can say "heavy rain" instead
# of "72.4 mm". Below 2.5 mm IMD does not even count a rainy day, so that is
# never a "yes".
_RAIN_WORDS = {
    "en": {"light": "light", "moderate": "moderate", "heavy": "heavy",
           "very_heavy": "very heavy", "extreme": "extremely heavy"},
    "hi": {"light": "हल्की", "moderate": "मध्यम", "heavy": "भारी",
           "very_heavy": "बहुत भारी", "extreme": "अत्यधिक भारी"},
    "te": {"light": "తేలికపాటి", "moderate": "మోస్తరు", "heavy": "భారీ",
           "very_heavy": "అతి భారీ", "extreme": "అత్యంత భారీ"},
}
_RAIN_SENTENCES = {
    "en": {"yes": "Yes — {word} rain is likely tomorrow.",
           "drops": "Mostly dry tomorrow — only a few drops are possible.",
           "no": "No rain expected tomorrow."},
    "hi": {"yes": "हाँ — कल {word} बारिश की संभावना है।",
           "drops": "कल ज़्यादातर सूखा रहेगा — बस कुछ बूँदें गिर सकती हैं।",
           "no": "कल बारिश की उम्मीद नहीं है।"},
    "te": {"yes": "అవును — రేపు {word} వర్షం పడే అవకాశం ఉంది.",
           "drops": "రేపు దాదాపు పొడిగా ఉంటుంది — కొన్ని చినుకులు మాత్రమే పడవచ్చు.",
           "no": "రేపు వర్షం అంచనా లేదు."},
}


def rain_category(mm) -> str | None:
    """IMD category for a day's rainfall: none | drops | light ... | extreme."""
    if not isinstance(mm, (int, float)) or isinstance(mm, bool):
        return None
    if mm < 0.1:
        return "none"
    if mm < 2.5:
        return "drops"
    if mm < 15.6:
        return "light"
    if mm < 64.5:
        return "moderate"
    if mm < 115.6:
        return "heavy"
    if mm < 204.5:
        return "very_heavy"
    return "extreme"


def rain_sentence(mm, language: str = "en") -> str | None:
    """Tomorrow's rain in words, in the user's language; None without data."""
    cat = rain_category(mm)
    if cat is None:
        return None
    lang = language if language in _RAIN_SENTENCES else "en"
    s = _RAIN_SENTENCES[lang]
    if cat == "none":
        return s["no"]
    if cat == "drops":
        return s["drops"]
    return s["yes"].format(word=_RAIN_WORDS[lang][cat])


_ASK_RAIN = ("rain", "barish", "baarish", "shower", "drizzle", "umbrella",
             "वर्षा", "बारिश", "వర్షం", "వాన")
_ASK_HEAT = ("hot", "heat", "cold", "temperature", "temp", "warm", "degree",
             "गर्मी", "ठंड", "तापमान", "వేడి", "చలి", "ఉష్ణోగ్రత")


def _round(v):
    return int(round(v)) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# Short answer phrasing per language. The rule-based answer must respect the
# user's language even when the LLM is disabled — a Hindi user must never
# receive an English-only answer. Kept plain on purpose: the direct answer
# first, one line on official warnings, few numbers, no explanation of where
# the data came from (the app shows the sources under the answer).
_SHORT_PHRASES = {
    "en": {
        "active_warning": "Official warning for {loc}: {severity} — {hazard}.",
        "unreachable": "Official warnings could not be checked right now — please confirm with IMD or local officials.",
        "no_warning": "No official weather warning for {loc} right now.",
        "now": "Right now in {loc}: {temp}°C, {cond}.",
        "now_temp": "Right now in {loc}: {temp}°C.",
        "tomorrow_temp": "Tomorrow: {tmin} to {tmax}°C.",
        "rain_na": "Tomorrow's rain forecast is not available right now.",
    },
    "hi": {
        "active_warning": "{loc} के लिए आधिकारिक चेतावनी: {severity} — {hazard}।",
        "unreachable": "आधिकारिक चेतावनी अभी जाँची नहीं जा सकी — कृपया IMD या स्थानीय अधिकारियों से पुष्टि करें।",
        "no_warning": "{loc} के लिए अभी कोई आधिकारिक मौसम चेतावनी नहीं है।",
        "now": "{loc} में अभी: {temp}°C, {cond}।",
        "now_temp": "{loc} में अभी: {temp}°C।",
        "tomorrow_temp": "कल: {tmin} से {tmax}°C।",
        "rain_na": "कल की बारिश का पूर्वानुमान अभी उपलब्ध नहीं है।",
    },
    "te": {
        "active_warning": "{loc}కు అధికారిక హెచ్చరిక: {severity} — {hazard}.",
        "unreachable": "అధికారిక హెచ్చరికలను ఇప్పుడు తనిఖీ చేయలేకపోయాం — దయచేసి IMD లేదా స్థానిక అధికారులతో నిర్ధారించుకోండి.",
        "no_warning": "{loc}కు ఇప్పుడు అధికారిక వాతావరణ హెచ్చరిక లేదు.",
        "now": "{loc}లో ఇప్పుడు: {temp}°C, {cond}.",
        "now_temp": "{loc}లో ఇప్పుడు: {temp}°C.",
        "tomorrow_temp": "రేపు: {tmin} నుండి {tmax}°C.",
        "rain_na": "రేపటి వర్ష అంచనా ఇప్పుడు అందుబాటులో లేదు.",
    },
}


def _template_answer(evidence: dict, language: str = "en", question: str = "") -> str:
    """Rule-based grounded answer. Used when the LLM is disabled or unreachable.

    Short and plain on purpose: the direct answer to what was asked first, one
    line on official warnings, rounded numbers only where they help, and nothing
    about how the answer was produced or where the data came from (the app shows
    the sources under every answer). An active official warning still comes
    first: safety before the forecast.
    """
    verified = evidence.get("verified_warning") or {}
    forecast = evidence.get("forecast") or {}
    current = evidence.get("current_weather") or {}
    location = evidence.get("location") or {}
    loc = location.get("city") or location.get("district") or "your area"
    lang = language if language in _SHORT_PHRASES else "en"
    P = _SHORT_PHRASES[lang]

    days = forecast.get("days") or []
    tomorrow = days[1] if len(days) > 1 else (days[0] if days else {})
    rain_line = rain_sentence((tomorrow or {}).get("rainfall"), lang) or P["rain_na"]
    tmin = _round((tomorrow or {}).get("min_temperature"))
    tmax = _round((tomorrow or {}).get("max_temperature"))
    temp_now = _round(current.get("temperature"))
    cond = str(current.get("condition") or "").strip().lower()

    q = (question or "").lower()
    asks_rain = any(w in q for w in _ASK_RAIN)
    asks_heat = any(w in q for w in _ASK_HEAT)

    answer: list[str] = []
    if asks_rain:
        answer.append(rain_line)
    elif asks_heat:
        if temp_now is not None:
            answer.append(P["now_temp"].format(loc=loc, temp=temp_now))
        if tmin is not None and tmax is not None:
            answer.append(P["tomorrow_temp"].format(tmin=tmin, tmax=tmax))
        if not answer:
            answer.append(rain_line)
    else:
        if temp_now is not None:
            answer.append((P["now"] if cond else P["now_temp"]).format(loc=loc, temp=temp_now, cond=cond))
        answer.append(rain_line)

    # Honesty: "we could not check" is a different statement from "there is no
    # warning". Saying "no warning" while the warning service is down is a
    # false all-clear — the one thing this product must never emit.
    # Advice the user asked for ("can I spray?", "is it safe to go out?") comes
    # from the rule-based advisory the app already built for this persona, so
    # the fallback still answers the question instead of only stating facts.
    advice = _guidance_lines(evidence.get("app_guidance"), q)
    if verified.get("verified"):
        warning = P["active_warning"].format(
            loc=loc, severity=verified.get("severity"), hazard=verified.get("hazard") or "")
        return " ".join([warning, *answer, *advice])
    if verified.get("warning_service") == "unavailable":
        return " ".join([*answer, P["unreachable"], *advice])
    return " ".join([*answer, P["no_warning"].format(loc=loc), *advice])


_ASK_ADVICE = ("should", "can i", "could i", "safe", "advice", "advise", "what to do",
               "what do i", "what should", "ok to", "okay to", "good time", "best time",
               "suggest", "recommend", "go out", "go to sea", "spray", "irrigat", "harvest",
               "sow", "travel", "drive", "umbrella", "carry", "wear", "plan",
               "क्या करूं", "क्या करें", "सलाह", "सुरक्षित", "जाऊं", "जा सकता",
               "ఏం చేయాలి", "సలహా", "సురక్షిత", "వెళ్ల")


def _guidance_lines(guidance, question: str, limit: int = 2) -> list[str]:
    """Up to `limit` sentences of app guidance when the question asks for advice."""
    if not guidance or not isinstance(guidance, str):
        return []
    q = (question or "").lower()
    if not any(w in q for w in _ASK_ADVICE):
        return []
    sentences = [x.strip() for x in re.split(r"(?<=[.!?।])\s+", guidance.strip()) if x.strip()]
    return sentences[:limit]


def _models() -> list[str]:
    """The configured model, then the rate-limit fallback (its own minute budget)."""
    models = [config.LLM_MODEL]
    fb = getattr(config, "LLM_FALLBACK_MODEL", "")
    if fb and fb != config.LLM_MODEL:
        models.append(fb)
    return models


def _payload(model: str, messages: list[dict], stream: bool = False) -> dict:
    body = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        # ~110 words of answer plus a short reasoning pass on gpt-oss models.
        "max_tokens": 480,
    }
    if model.startswith("openai/gpt-oss"):
        # Low effort keeps reasoning short: faster first token and fewer tokens
        # against the per-minute budget, with no loss on a data-bound answer.
        body["reasoning_effort"] = "low"
    if stream:
        body["stream"] = True
    return body


def build_messages(evidence: dict, question: str, language: str,
                   history: list | None = None) -> list[dict]:
    """System rules + who the user is + earlier turns + the data and question."""
    from .chat_context import NUMERIC_PERSONAS, PERSONA_FOCUS

    user_type = evidence.get("user_type") or "general"
    directive = LANG_DIRECTIVE.get(language, LANG_DIRECTIVE["en"])
    role = user_type.replace("_", " ").replace("-", " ")
    parts = [
        SYSTEM_RULES,
        directive,
        f"The user is a {role}. What matters to them: "
        f"{PERSONA_FOCUS.get(user_type, PERSONA_FOCUS['general'])}",
    ]
    if evidence.get("profile"):
        parts.append("Their own details are in 'profile' (from their settings): tailor the answer "
                     "and the advice to them.")
    if user_type in NUMERIC_PERSONAS:
        parts.append("NUMBERS ALLOWED: up to five rounded numbers, e.g. wind and gusts in km/h, "
                     "wave height in metres, rain chance as a percentage.")
    else:
        parts.append("NUMBERS ALLOWED: at most three rounded numbers (temperature or wind), "
                     "no percentages.")
    asked = evidence.get("asked_place")
    if asked:
        parts.append(f"This question is about {asked}, not the user's home area "
                     f"({evidence.get('home_place') or 'their location'}). Answer for {asked}.")
    focus = evidence.get("time_focus")
    if focus:
        parts.append(f"The question is about: {focus.replace('_', ' ')}.")

    messages = [{"role": "system", "content": "\n".join(parts)}]
    for turn in history or []:
        if turn.get("role") in ("user", "assistant") and turn.get("text"):
            messages.append({"role": turn["role"], "content": turn["text"]})
    messages.append({"role": "user", "content": (
        "VERIFIED BACKEND DATA (the only source of facts):\n"
        f"{json.dumps(evidence, ensure_ascii=False, default=str)}\n\n"
        f"USER QUESTION: {question}\n"
        "Answer from the data above and give advice for this user. If a fact is missing, "
        "say it is not available."
    )})
    return messages


class LLMService:
    def __init__(self) -> None:
        self.enabled = bool(config.LLM_API_KEY)

    def generate_grounded_response(self, evidence: dict) -> tuple[str, bool]:
        """Rule-based answer (sync path kept for tests/offline). (answer, structured_fallback)"""
        return _template_answer(evidence), not self.enabled

    async def generate(self, evidence: dict, question: str, language: str,
                       history: list | None = None) -> tuple[str, bool]:
        """Real LLM answer in the user's language, grounded in evidence only.

        Returns (answer, structured_fallback). Any failure falls back to the
        rule-based template — the user still gets a grounded answer.
        """
        if not self.enabled:
            return _template_answer(evidence, language, question), True

        if not config.LLM_MODEL_KNOWN:
            # FAIL LOUD: a misconfigured model name used to degrade silently into the
            # template fallback. Surface the misconfiguration instead of hiding it.
            raise RuntimeError(
                f"Invalid LLM_MODEL '{config.LLM_MODEL}': not a known model on the "
                "configured endpoint. Fix LLM_MODEL (default: 'openai/gpt-oss-120b') "
                "or unset it to use the default."
            )

        messages = build_messages(evidence, question, language, history)
        content = ""
        for model in _models():
            try:
                async with httpx.AsyncClient(timeout=config.LLM_TIMEOUT) as client:
                    resp = await client.post(
                        f"{config.LLM_BASE_URL}/chat/completions",
                        headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
                        json=_payload(model, messages),
                    )
                    resp.raise_for_status()
                    content = (resp.json().get("choices") or [{}])[0].get("message", {}).get("content", "")
                break
            except httpx.HTTPStatusError as exc:
                if exc.response is not None and exc.response.status_code == 429:
                    continue  # this model's minute budget is spent: try the next
                return _template_answer(evidence, language, question), True
            except Exception:
                return _template_answer(evidence, language, question), True
        else:
            return _template_answer(evidence, language, question), True

        content = _strip_think_blocks(content)
        if not content:
            return _template_answer(evidence, language, question), True
        return content, False

    async def generate_stream(self, evidence: dict, question: str, language: str,
                              history: list | None = None):
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
            yield {"type": "token", "text": _template_answer(evidence, language, question)}
            yield {"type": "end", "fallback": True, "model_error": "", "truncated": False}
            return
        if not config.LLM_MODEL_KNOWN:
            model_error = (
                f"Invalid LLM_MODEL '{config.LLM_MODEL}': not a known model on the "
                "configured endpoint. Fix LLM_MODEL (default: 'openai/gpt-oss-120b') "
                "or unset it to use the default."
            )
            yield {"type": "token", "text": _template_answer(evidence, language, question)}
            yield {"type": "end", "fallback": True, "model_error": model_error, "truncated": False}
            return

        messages = build_messages(evidence, question, language, history)
        sent_any = False
        models = _models()
        try:
            for attempt, model in enumerate(models):
                async with httpx.AsyncClient(timeout=config.LLM_TIMEOUT) as client:
                    async with client.stream(
                        "POST",
                        f"{config.LLM_BASE_URL}/chat/completions",
                        headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
                        json=_payload(model, messages, stream=True),
                    ) as resp:
                        if resp.status_code == 429 and attempt + 1 < len(models):
                            continue  # minute budget spent on this model: next one
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
                break  # one complete answer: do not ask the next model
        except Exception:
            if not sent_any:
                yield {"type": "token", "text": _template_answer(evidence, language, question)}
                yield {"type": "end", "fallback": True, "model_error": "", "truncated": False}
            else:
                yield {"type": "end", "fallback": True, "model_error": "", "truncated": True}
            return
        if not sent_any:
            yield {"type": "token", "text": _template_answer(evidence, language, question)}
            yield {"type": "end", "fallback": True, "model_error": "", "truncated": False}
            return
        yield {"type": "end", "fallback": False, "model_error": "", "truncated": False}