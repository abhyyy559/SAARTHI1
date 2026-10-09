"""Chat endpoint — full pipeline: parse -> resolve -> retrieve -> validate -> risk -> advisory -> LLM.

Demo mode: IMD fixtures (DEMO). Live mode: Open-Meteo + IMD-live + CAP (provenance
per fact). Both modes refuse to invent (§54/§59). Spec alias: POST /api/chat/query.
Token streaming: POST /api/chat/stream (NDJSON: meta, token*, final?, done).
"""
import asyncio
import json
import re
import time

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from .. import config
from ..adapters.registry import AdapterUnavailable
from ..models.chat import ChatRequest, ChatResponse
from ..rules.weather_rules import WeatherRules
from ..services.advisory_service import advisory_for
from ..services.alert_service import gather_alerts
from ..services.imd_service import IMDService
from ..services.llm_service import (RAINY_DAY_MM, LLMService, build_evidence_package, in_language,
                                    _template_answer)
from ..services.location_service import LocationService
from ..services.place_parser import asked_place
from ..services.response_validator import validate as validate_answer
from ..services.validation_service import ValidationService
from ..services.verdict_service import build_verdict
from ..utils.time import iso_now
from .weather import _live_current, _live_forecast

router = APIRouter()

UNAVAILABLE_ANSWERS = {
    "en": ("Weather information is temporarily unavailable. No verified warning, "
           "observation or forecast could be retrieved right now, so I cannot answer "
           "from data. Please try again shortly."),
    "hi": ("मौसम की जानकारी अभी उपलब्ध नहीं है। अभी कोई सत्यापित चेतावनी, माप या पूर्वानुमान "
           "नहीं मिला, इसलिए मैं आंकड़ों से जवाब नहीं दे सकता। कृपया थोड़ी देर बाद फिर कोशिश करें।"),
    "te": ("వాతావరణ సమాచారం ఇప్పుడు అందుబాటులో లేదు. ఇప్పుడు ఏ ధృవీకరించిన హెచ్చరిక, కొలత "
           "లేదా అంచనా అందలేదు, కాబట్టి డేటా ఆధారంగా సమాధానం చెప్పలేను. దయచేసి కొద్దిసేపట్లో మళ్లీ ప్రయత్నించండి."),
}


def _unavailable_answer(language: str) -> str:
    return UNAVAILABLE_ANSWERS.get(language, UNAVAILABLE_ANSWERS["en"])


def _chat_verdict(verified_dict: dict, notes: dict) -> dict:
    """The one severity for this turn — identical contract to the Alerts page.

    `notes` carries what `_retrieve_live` actually reached (see below). When a
    caller supplies only the validated-warning dict, availability is read off it
    so an unreachable service still cannot be mistaken for a calm district.
    """
    available = notes.get("warning_service_available")
    if available is None:
        available = (verified_dict or {}).get("warning_service") != "unavailable"
    return build_verdict(
        verified=verified_dict,
        warning=notes.get("warning_raw"),
        cap_alerts=notes.get("cap_alerts") or [],
        nearby_alerts=notes.get("nearby_alerts") or [],
        warning_service_available=bool(available),
        warning_matches_location=notes.get("warning_matches_location", True),
        checked_sources=notes.get("checked_sources"),
        unchecked_sources=notes.get("unchecked_sources"),
    )


def _risk_from_verdict(verdict: dict, verified_dict: dict) -> dict:
    """Label the verdict for this persona. Official severity is never re-graded."""
    level = "UNKNOWN" if verdict.get("basis") == "unavailable" else (verdict.get("level") or "UNKNOWN")
    return {
        "level": level,
        "hazard": verdict.get("hazard") or (verified_dict or {}).get("hazard") or "",
        "official_severity": verdict.get("severity"),
        "source": "WEATHERGPT",
    }


def _llm_warning_view(verified_dict: dict, verdict: dict) -> dict:
    """Warning facts the phrasing layer may restate.

    A relevant official CAP alert IS an active warning even when the IMD district
    feed is down; feeding the LLM `verified: False` would make the answer deny a
    warning the verdict confirms — the same contradiction this endpoint fixes.

    The unreachable case matters just as much in the other direction. When the
    warning service is down, `verified_dict` is None, and a null in the evidence
    reads to a language model as "no warning" — it then writes "there is no
    active official warning", which is the false all-clear this product exists to
    prevent. So an explicit, self-describing object is sent instead of None.
    """
    if verdict.get("basis") == "cap_alert":
        # The official alert IS the confirmation. Carrying the IMD call's
        # "warning_service: unavailable" alongside "verified: True" made the
        # model write that the warning "could not be confirmed".
        base = {k: v for k, v in (verified_dict or {}).items() if k not in ("warning_service", "note")}
        view = {**base, "verified": True,
                "severity": verdict.get("severity"), "hazard": verdict.get("hazard"),
                "source": verdict.get("source")}
        if (verified_dict or {}).get("warning_service") == "unavailable":
            view["note"] = ("Confirmed by an official NDMA SACHET alert for this place. The IMD "
                            "district service was not reachable; that does not change this warning.")
        return view
    if verdict.get("basis") == "unavailable":
        return {
            "verified": False,
            "warning_service": "unavailable",
            "note": (
                "The official warning service could NOT be reached, so no warning "
                "information was retrieved. This is not evidence that conditions are "
                "safe. Do not state or imply that there is no warning; say the warning "
                "status could not be checked and tell the user to confirm with IMD or "
                "local authorities."
            ),
        }
    if verdict.get("basis") == "none":
        # Checked and calm. The IMD call may have failed (verified_dict then
        # carries warning_service: unavailable), but the official SACHET feed
        # answered, so "could not be checked" would now be the false statement.
        return {
            "verified": False,
            "active_warning": False,
            "checked": True,
            "nearby_official_alerts_in_state": verdict.get("nearby_count", 0),
            "note": (
                "Official warning feeds (NDMA SACHET) were checked and have no active "
                "warning for this district."
            ),
        }
    return verified_dict


_RAIN_WORDS = ("rain", "barish", "वर्षा", "వర్షం", "बारिश")
# Yes/no tokens per supported language — a rain answer is a rain answer whether
# the reader asked in English, Hindi or Telugu. `\b` is not a safe token
# boundary after Indic combining marks (हाँ ends in a non-word mark, so `\b`
# fails before a following space); `(?!\w)` refuses a word-char continuation
# and behaves like `\b` for the Latin tokens too.
_YESNO_TOKENS = r"yes|no|हाँ|नहीं|అవును|కాదు|లేదు"
_YESNO = rf"(?:{_YESNO_TOKENS})(?!\w)"
# A yes/no that appears this early is the answer, not a mention of one.
_RAIN_ANSWER_WINDOW = 220
# ...but only when the yes/no is ABOUT rain, or when it OPENS the answer. A bare
# "no" in the middle of a sentence ("there is no active warning") is a mention,
# not an answer: treating it as one left the rain question with NO yes/no at all.
# A leading yes/no ("No, it will stay dry tomorrow.") is an answer even when the
# sentence does not repeat the word "rain".
_RAIN_ANSWER_RE = re.compile(
    rf"\b{_YESNO}[\s\S]{{0,80}}?(?:rain|barish|वर्षा|వర్షం|बारिश)"
    rf"|(?:rain|barish|वर्षा|వర్షం|बारिश)[\s\S]{{0,80}}?\b{_YESNO}",
    re.I,
)
_LEADING_MARKUP_RE = re.compile(r"^[\s#>*_`\-]+")
_LEADING_YESNO_RE = re.compile(rf"^{_YESNO}", re.I)


# A rain word with an amount ("వర్షం ... 0.6 mm") already answers the question.
# An IMD category in the opening ("Very light rain is expected tomorrow")
# already answers the question: adding our own line said it twice.
_RAIN_CATEGORY_RE = re.compile(
    r"\b(?:no|very light|light|moderate|heavy|very heavy|extremely heavy)\s+rain\b"
    r"|बहुत हल्की बारिश|हल्की बारिश|मध्यम बारिश|भारी बारिश|बारिश की उम्मीद नहीं|बारिश नहीं"
    r"|చాలా తేలికపాటి వర్షం|తేలికపాటి వర్షం|మోస్తరు వర్షం|భారీ వర్షం|వర్షం అంచనా లేదు|వర్షం లేదు",
    re.I)

_RAIN_AMOUNT_RE = re.compile(
    r"(?:rain|barish|वर्षा|వర్షం|బారిష్|बारिश|వర్షపాతం)[\s\S]{0,60}?\d+(?:\.\d+)?\s*(?:mm|మి\.?మీ|मिमी|millimet)",
    re.I)


def _answer_already_given(answer: str) -> bool:
    """True when the answer already commits to a rain yes/no (pure).

    Two shapes count: a yes/no tied to a rain word within the opening window, or
    a yes/no that opens the answer (after any leading markdown). Anything else —
    notably a mid-sentence "no" that is not about rain — does not, so the caller
    still adds the guaranteed line.
    """
    head = (answer or "")[:_RAIN_ANSWER_WINDOW]
    if _RAIN_ANSWER_RE.search(head):
        return True
    if _RAIN_AMOUNT_RE.search(head):
        return True
    if _RAIN_CATEGORY_RE.search(head):
        return True
    return bool(_LEADING_YESNO_RE.match(_LEADING_MARKUP_RE.sub("", answer or "")))


# Rain lead lines in the user's language — the guaranteed yes/no must obey the
# same language contract as the rest of the answer.
_RAIN_LEAD = {
    "en": ("Yes — rain likely tomorrow ({rain} mm).", "No rain expected tomorrow.",
           "Only very light rain expected tomorrow ({rain} mm), not a rainy day."),
    "hi": ("हाँ — कल बारिश की संभावना है ({rain} मिमी)।", "कल बारिश की उम्मीद नहीं है।",
           "कल सिर्फ़ बहुत हल्की बारिश ({rain} मिमी) की उम्मीद है, बारिश वाला दिन नहीं।"),
    "te": ("అవును — రేపు వర్షం పడే అవకాశం ఉంది ({rain} మిమీ).", "రేపు వర్షం అంచనా లేదు.",
           "రేపు చాలా తేలికపాటి వర్షం మాత్రమే ({rain} మిమీ), వర్షపు రోజు కాదు."),
}


def _ensure_rain_lead(message: str, forecast_dict: dict | None, answer: str, language: str = "en") -> str:
    """Guarantee a rain question opens with a plain yes/no, exactly once.

    The template answer already does this; the LLM may phrase it differently or
    bury it. Prepending is only safe when the answer has NOT already committed
    to a yes/no — otherwise the reader gets two consecutive answers, which is
    exactly what shipped: "Yes — rain likely tomorrow (22.0 mm)." immediately
    followed by "**Yes**, it will rain tomorrow." The old literal
    `rain_line not in answer` check could never catch that, because the wording
    differed while the answer was the same.

    "Exactly once" cuts both ways: the answer must not be given twice, and it
    must not be missing. Suppressing on any early `yes`/`no` token silently
    dropped the answer whenever the opening sentence merely mentioned one
    ("there is no active warning"), so the token now has to be an answer —
    see `_answer_already_given`.
    """
    if not forecast_dict:
        return answer
    msg = (message or "").lower()
    if not any(w in msg for w in _RAIN_WORDS):
        return answer
    days = forecast_dict.get("days") or []
    tomorrow = days[1] if len(days) > 1 else (days[0] if days else {})
    fc_rain = (tomorrow or {}).get("rainfall")
    if fc_rain is None:
        return answer
    lead_yes, lead_no, lead_trace = _RAIN_LEAD.get(language, _RAIN_LEAD["en"])
    # IMD: a rainy day is 2.5 mm or more. A trace is said as a trace, never "yes".
    if fc_rain >= RAINY_DAY_MM:
        line = lead_yes.format(rain=fc_rain)
    elif fc_rain > 0:
        line = lead_trace.format(rain=fc_rain)
    else:
        line = lead_no
    if line in answer:
        return answer
    if _answer_already_given(answer):
        return answer
    return f"{line}\n\n{answer}"


# Sea/coast words — a "can I go to sea / is sailing safe" question from an
# inland district must lead with the plain fact that there is no coast here,
# not with an unrelated thunderstorm warning. Mirrors _ensure_rain_lead.
_SEA_WORDS = ("sea", "ocean", "sailing", "sail", "boat", "ship", "beach",
              "coast", "samudra", "समुद्र", "समुंदर", "సముద్రం", "नाव")

_SEA_INLAND_LEAD = {
    "en": "{district} is not a coastal district, so sea and marine warnings do not apply here.",
    "hi": "{district} एक तटीय जिला नहीं है, इसलिए समुद्री चेतावनियाँ यहाँ लागू नहीं होतीं।",
    "te": "{district} తీర ప్రాంత జిల్లా కాదు, కాబట్టి సముద్ర హెచ్చరికలు ఇక్కడ వర్తించవు.",
}


def _ensure_sea_lead(message: str, loc: dict | None, answer: str, language: str = "en") -> str:
    """Prepend the inland lead for sea questions asked from an inland district.

    Only fires when we KNOW the district is inland (coastal is False). An
    unknown district (coastal=None) keeps the normal answer rather than a
    guess. Exactly-once: skipped when the answer already carries the lead.
    """
    msg = (message or "").lower()
    if not any(w in msg for w in _SEA_WORDS):
        return answer
    loc = loc or {}
    if loc.get("coastal") is not False:
        return answer
    district = loc.get("district") or loc.get("city") or ""
    lead = _SEA_INLAND_LEAD.get(language, _SEA_INLAND_LEAD["en"]).format(district=district)
    if lead in answer:
        return answer
    return f"{lead}\n\n{answer}"


# "Can I go to sea / is it safe" is a safety decision, not a yes/no weather fact.
# A spoken "Yes" opening the answer reads as permission even when it answers
# something else ("Yes, 0.6 mm rain tomorrow" — shipped, in Telugu, to a
# fisherman). Such answers must open with the facts instead.
_PERMISSION_WORDS = _SEA_WORDS + ("safe", "सुरक्षित", "సురక్షిత", "fishing", "मछली", "చేపల")
# Only a STANDALONE yes/no (punctuation after it) is an answer. "No warning is
# active" is a fact whose "No" must never be stripped — that flips its meaning.
_LEADING_YESNO_ANY = re.compile(rf"^(\W*?)(?:{_YESNO_TOKENS})(?!\w)\s*[,.!:;\-—–]+\s*", re.I)


def _drop_permission_yesno(message: str, answer: str) -> str:
    """Strip a leading yes/no from answers to safety-permission questions."""
    msg = (message or "").lower()
    if not any(w in msg for w in _PERMISSION_WORDS) or any(w in msg for w in _RAIN_WORDS):
        return answer
    return _LEADING_YESNO_ANY.sub(lambda m: m.group(1), answer, count=1)


def _build_response(loc, verified_dict, risk, current_dict, forecast_dict, answer,
                    advisory, language, weather_block, provenance_map, fallback=False, user_type="general",
                    verdict=None, response_time_ms=0, model_error="") -> ChatResponse:
    from ..services.advisory_service import caveat_for
    warn = verified_dict or {}
    return ChatResponse(
        answer=answer,
        location={"city": loc.get("city"), "district": loc.get("district"), "state": loc.get("state")},
        weather=weather_block,
        risk={"level": risk.get("level"), "hazard": risk.get("hazard", ""), "source": risk.get("source")},
        verdict=verdict or {},
        warning={
            "status": warn.get("warning_service", "available"),
            "active": bool(warn.get("verified", False)),
            "severity": warn.get("severity"),
            "hazard": warn.get("hazard"),
            "official": True,
            "source": warn.get("source"),
            "valid_until": warn.get("valid_until"),
        },
        advisory=advisory,
        caveat=caveat_for(user_type, language),
        evidence=[
            {"source": e["source"], "type": e["type"], "issued_at": e.get("issued_at"),
             "valid_until": e.get("valid_until"), "provenance": e.get("provenance", "DEMO")}
            for e in provenance_map
        ],
        language=language,
        structured_fallback=bool(fallback),
        model_error=model_error or "",
        generated_at=iso_now(),
        response_time_ms=response_time_ms,
    )


async def _retrieve_demo(loc) -> tuple[dict, dict, dict, list, dict]:
    imd = IMDService(adapter="demo")
    current, forecast, warning = await asyncio.gather(
        imd.get_current_weather(loc["latitude"], loc["longitude"]),
        imd.get_forecast(loc["latitude"], loc["longitude"]),
        imd.get_district_warning(loc["district"]),
    )
    val = ValidationService(imd)
    verified = val.validate_warning(warning, loc["district"]) if warning else None
    verified_dict = verified.model_dump(mode="json") if verified else {"verified": False, "severity": "GREEN", "hazard": None}
    current_dict = current.model_dump(mode="json")
    forecast_dict = forecast.model_dump(mode="json")
    ev = [
        {"source": "IMD", "type": "district_warning", "issued_at": verified_dict.get("source_timestamp"),
         "valid_until": verified_dict.get("valid_until"), "provenance": "DEMO"},
        {"source": "IMD", "type": "city_forecast", "issued_at": forecast_dict.get("issued_at"), "provenance": "DEMO"},
        {"source": "IMD", "type": "current_observation", "issued_at": current_dict.get("observed_at"), "provenance": "DEMO"},
    ]
    return current_dict, forecast_dict, verified_dict, ev, {"source_name": "IMD"}


async def _fetch_current_safe(lat: float, lon: float) -> tuple[dict | None, str]:
    """_live_current with the AdapterUnavailable contract, for gather()."""
    try:
        return await _live_current(lat, lon)
    except AdapterUnavailable:
        return None, "UNAVAILABLE"


async def _fetch_forecast_safe(lat: float, lon: float) -> tuple[dict | None, str]:
    """_live_forecast with the AdapterUnavailable contract, for gather()."""
    try:
        return await _live_forecast(lat, lon)
    except AdapterUnavailable:
        return None, "UNAVAILABLE"


async def _fetch_warning_safe(imd, district: str) -> tuple[object | None, dict, bool]:
    """District warning fetch + validation. Returns (warning, verified_dict, ok).

    On AdapterUnavailable the warning service is marked unavailable — identical
    semantics to the old sequential code, just fetchable concurrently.
    """
    verified_dict = {"verified": False, "severity": "GREEN", "hazard": None, "source": "IMD"}
    try:
        warning = await imd.get_district_warning(district)
        # The service ANSWERED. "Nothing to report" and "we could not check" are
        # different facts and must never be conflated (see verdict_service).
        v = ValidationService(imd).validate_warning(warning, district) if warning else None
        if v:
            verified_dict = v.model_dump(mode="json")
        return warning, verified_dict, True
    except AdapterUnavailable:
        # Honesty: mark the warning service state so no downstream layer
        # reports "no active warning" while we actually could not check.
        verified_dict["warning_service"] = "unavailable"
        return None, verified_dict, False


async def _retrieve_live(loc, lat, lon) -> tuple[dict | None, dict | None, dict, list, dict]:
    # LATENCY: the four retrievals are independent network calls and run
    # CONCURRENTLY. Sequentially they cost the sum of their latencies before
    # the verdict can render — roughly halved on a healthy network, and the
    # worst-case stall (all timeouts) is also roughly halved. Concurrency is
    # about when we fetch, not what the caller gets: every tuple below carries
    # the same provenance/failure contract the sequential code had.
    imd = IMDService(adapter="live")
    (current_dict, cur_prov), (forecast_dict, fc_prov), (warning, verified_dict, warn_call_ok), gathered = \
        await asyncio.gather(
            _fetch_current_safe(lat, lon),
            _fetch_forecast_safe(lat, lon),
            _fetch_warning_safe(imd, loc["district"]),
            gather_alerts(lat=lat, lon=lon, district=loc["district"], state=loc.get("state") or ""),
        )
    prov_notes: dict = {"current": cur_prov, "forecast": fc_prov}

    warning_d = warning.model_dump(mode="json") if warning is not None else None
    # A warning for a different district is context, not this district's warning.
    warn_matches_location = (
        (verified_dict or {}).get("validation", {}).get("location", "PASS") == "PASS"
        if warning_d else True
    )

    ev = []
    if current_dict:
        ev.append({"source": current_dict.get("source", "Open-Meteo"), "type": "current_observation",
                   "issued_at": current_dict.get("observed_at"), "provenance": prov_notes["current"]})
    if forecast_dict:
        ev.append({"source": forecast_dict.get("source", "Open-Meteo"), "type": "city_forecast",
                   "issued_at": forecast_dict.get("issued_at"), "provenance": prov_notes["forecast"]})
    if warning is not None and verified_dict.get("verified"):
        ev.append({"source": "IMD", "type": "district_warning",
                   "issued_at": verified_dict.get("source_timestamp"),
                   "valid_until": verified_dict.get("valid_until"), "provenance": "LIVE"})

    # Official CAP/SACHET alerts are authoritative, not decoration: they feed the
    # verdict, so chat and the Alerts page can never disagree about severity.
    # This used to call cap_adapter directly and so missed the commercial chain
    # that api/weather.py merges in — meaning the Alerts page could show an alert
    # the chat verdict had never seen. Both now share one gatherer.
    cap_alerts = gathered["relevant"]
    nearby_alerts = gathered["nearby"]
    for a in cap_alerts:
        ev.append({"source": a.get("provenance") or "NDMA-Sachet-CAP", "type": "cap_alert",
                   "issued_at": a.get("sent"), "valid_until": a.get("expires"),
                   "provenance": a.get("provenance") or gathered["provenance"]})

    # Name the source that actually supplied the numbers. The chain falls
    # through IMD -> Open-Meteo -> OWM, so "imd mode" does not mean IMD data.
    source_name = ((current_dict or {}).get("source")
                   or (forecast_dict or {}).get("source") or "Open-Meteo")
    notes = {"source_name": source_name, **prov_notes,
             "cap_alerts": cap_alerts, "nearby_alerts": nearby_alerts,
             "warning_raw": warning_d,
             # Checked = IMD answered, or SACHET answered live (see weather.py).
             "warning_service_available": warn_call_ok or bool(gathered.get("official_available")),
             "checked_sources": (["IMD"] if warn_call_ok else []) + (
                 ["NDMA-SACHET"] if gathered.get("official_available") else []),
             "unchecked_sources": [] if warn_call_ok else ["IMD"],
             "warning_matches_location": warn_matches_location}
    return current_dict, forecast_dict, verified_dict, ev, notes


# "Is this year hotter than usual?" is a climate question (PS feature 7): it is
# answered from 20 years of ERA5 reanalysis, the same series as the app's
# "20 years at this place" card, never from the 3-day forecast.
_CLIMATE_RE = re.compile(
    r"\b(?:usual|normal|average|climate|last year|past years?|previous years?|hotter|colder|"
    r"wetter|drier|trend|history|historical)\b|सामान्य|औसत|पिछले साल|जलवायु|సాధారణ|సగటు|"
    r"గత సంవత్సర|వాతావరణ మార్పు", re.I)


async def _climate_evidence(lat: float, lon: float) -> tuple[dict | str, list[float]]:
    """Climate block for the phrasing layer, and its numbers for the validator."""
    from . import climate as climate_api
    try:
        d = await climate_api.climate_trends(lat, lon)
    except Exception:  # noqa: BLE001 - a climate question must not break the chat
        return "unavailable", []
    tr = d.get("trends") or {}
    years = tr.get("yearly") or []
    base_r, last_r = tr.get("baseline_rain_mm"), tr.get("latest_rain_mm")
    if len(years) < 6 or base_r in (None, 0) or last_r is None:
        return "unavailable", []
    pct = round((last_r - base_r) / base_r * 100)
    block = {
        "source": "ERA5 reanalysis (Open-Meteo archive)",
        "last_complete_year": years[-1]["year"],
        "normal_period": f"{years[0]['year']}-{years[max(0, len(years) - 6)]['year']}",
        "rain_last_year_mm": last_r, "rain_normal_mm": base_r, "rain_change_percent": pct,
        "mean_temp_last_year_c": tr.get("latest_temp_c"), "mean_temp_normal_c": tr.get("baseline_temp_c"),
        "temp_difference_c": tr.get("temp_anomaly_c"),
        "temp_trend_c_per_decade": round((tr.get("temp_trend_c_per_year") or 0) * 10, 2),
        "note": "Complete calendar years only; the current year is not included.",
    }
    nums = [float(v) for v in block.values() if isinstance(v, (int, float))]
    return block, nums


async def _prepare(req: ChatRequest) -> dict:
    """Run everything before the LLM call. Returns a ctx dict.

    ctx["early"] is a ChatResponse when the pipeline short-circuits on total
    data failure (the honest unavailable answer); otherwise None, and the
    remaining keys carry the pipeline state both /api/chat and /api/chat/stream
    need. Severity/advisory/evidence are identical for both endpoints — one
    payload can never carry two verdicts.
    """
    rules = WeatherRules()
    rules.parse(req.message)
    home = LocationService().resolve(req.latitude, req.longitude)
    # "Will it rain in Patna?" is about Patna, whatever the saved place is.
    asked = asked_place(req.message, req.history, home)
    loc = asked or home
    lat, lon = loc["latitude"], loc["longitude"]

    if config.DEMO_MODE:
        current_dict, forecast_dict, verified_dict, ev, notes = await _retrieve_demo(loc)
    else:
        current_dict, forecast_dict, verified_dict, ev, notes = await _retrieve_live(loc, lat, lon)
    # Severity is decided once, here, by verdict_service — the same call the
    # Alerts page makes, so one payload can never carry two verdicts.
    verdict = _chat_verdict(verified_dict, notes)
    risk = _risk_from_verdict(verdict, verified_dict)

    if (current_dict is None and forecast_dict is None
            and not verified_dict.get("verified") and not notes.get("cap_alerts")):
        # Total failure of the live chain. The answer says so; the advisory must
        # say "we could not check", NEVER "no warning" (absence of data is not
        # evidence of safety). The verdict is the authority for both. The
        # verified payload is marked unavailable so advisory_for reports
        # "service unreachable", never the dishonest "no warning found".
        early = _build_response(loc, verified_dict, risk, None, None,
                                _unavailable_answer(req.language),
                                advisory_for({**verified_dict, "warning_service": "unavailable"},
                                             req.user_type, req.language, verdict=verdict,
                                             coastal=loc.get("coastal"), district=loc.get("district")),
                                req.language, {"status": "unavailable", "provenance": "UNAVAILABLE"}, [], True,
                                user_type=req.user_type, verdict=verdict)
        return {"early": early}

    advisory = advisory_for(verified_dict, req.user_type, req.language, verdict=verdict,
                            coastal=loc.get("coastal"), district=loc.get("district"))
    # Weather-grounded rule layer (T2.1 S2.1.3): APPEND-ONLY. The floor above
    # is authoritative; rule lines cite observed/forecast numbers and can never
    # soften it (official alerts pre-authorized, auto-ingest, no human gate).
    from ..services.advisory_service import weather_advisories, weather_advisories_text
    advisory += weather_advisories_text(
        weather_advisories(current_dict, forecast_dict, req.user_type, req.language),
        req.language)
    # The phrasing layer and its validator both work from the verdict-consistent
    # view of the warning, so a CAP-confirmed hazard is neither denied nor
    # flagged as an escalation.
    llm_verified = _llm_warning_view(verified_dict, verdict)
    evidence = build_evidence_package(
        location=loc, current=current_dict or {}, forecast=forecast_dict or {},
        verified=llm_verified, risk=risk, user_type=req.user_type,
        source_name=notes.get("source_name", "IMD"),
    )
    if asked:
        evidence["asked_place"] = f"{loc.get('district')}, {loc.get('state')}"
    if req.history:
        evidence["earlier_questions"] = req.history
    climate_numbers: list[float] = []
    if _CLIMATE_RE.search(req.message or ""):
        evidence["climate_trend"], climate_numbers = await _climate_evidence(lat, lon)
        if climate_numbers:
            # The answer's "Based on" line must name the series the numbers came from.
            ev = [*ev, {"source": "ERA5 (Open-Meteo archive)", "type": "climate_trend",
                        "provenance": "LIVE"}]

    # Numbers the post-LLM response validator (§10, §43) may check.
    numbers: list[float] = []
    for blob in (current_dict, forecast_dict):
        if not isinstance(blob, dict):
            continue  # current or forecast may be None when a source is down
        for v in blob.values():
            if isinstance(v, (int, float)):
                numbers.append(float(v))
        for day in blob.get("days", []):
            for v in (day or {}).values():
                if isinstance(v, (int, float)):
                    numbers.append(float(v))

    numbers.extend(climate_numbers)

    weather_block = {"current": current_dict, "forecast_days": (forecast_dict or {}).get("days", [])[:3]}
    return {
        "early": None,
        "loc": loc,
        "verified_dict": verified_dict,
        "risk": risk,
        "current_dict": current_dict,
        "forecast_dict": forecast_dict,
        "advisory": advisory,
        "language": req.language,
        "user_type": req.user_type,
        "weather_block": weather_block,
        "ev": ev,
        "verdict": verdict,
        "evidence": evidence,
        "llm_verified": llm_verified,
        "numbers": numbers,
        "message": req.message,
    }


# CJK ideographs, kana, hangul: never part of an EN/HI/TE answer.
_FOREIGN_SCRIPT = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]")


def _finalize_answer(ctx: dict, raw: str, fallback: bool = False) -> tuple[str, bool]:
    """Post-LLM validation (§10, §43) + rain-lead guarantee on the full text.

    Returns (answer, structured_fallback). Shared by /api/chat and
    /api/chat/stream so the streamed answer and the JSON answer are identical.
    """
    answer, findings = validate_answer(raw, ctx["llm_verified"], ctx["numbers"], ctx["language"])
    fallback = fallback or bool(findings)
    if findings:
        ctx["evidence"]["validation_findings"] = findings

    # gpt-oss occasionally leaks a stray CJK token ("Light Drizzle予"). No
    # supported language uses those scripts, and TTS would try to read it.
    answer = _FOREIGN_SCRIPT.sub("", answer)

    # A Telugu or Hindi reader must not get an English answer: the model
    # sometimes ignores the language directive. The grounded template speaks
    # every supported language, so it replaces an answer in the wrong script.
    if not in_language(answer, ctx["language"]):
        answer = _template_answer(ctx["evidence"], ctx["message"], ctx["language"])
        fallback = True

    # Prepend a clear rain answer for "rain tomorrow" queries (T2.1 S2.1.4).
    # The template answer already does this; the LLM may phrase it differently or
    # bury it. `_ensure_rain_lead` owns that rule and refuses to add a second
    # yes/no when the answer already gave one — the inline copy that used to live
    # here compared the exact line text instead, so "Yes — rain likely tomorrow
    # (22.0 mm)." was prepended straight above "**Yes**, it will rain tomorrow."
    answer = _ensure_rain_lead(ctx["message"], ctx["forecast_dict"], answer, ctx["language"])
    # Sea questions from an inland district lead with the no-coast fact.
    answer = _ensure_sea_lead(ctx["message"], ctx.get("loc"), answer, ctx["language"])
    answer = _drop_permission_yesno(ctx["message"], answer)
    return answer, fallback


# Same question, same place, same data, within 10 minutes: the same answer.
# Judges tap the same chip questions; on Groq's free tier (8,000 tokens a
# minute, ~1,900 per answer) every repeat would otherwise spend the budget and
# push the next new question onto the plainer template answer. The key holds
# the facts the answer was built from, so any change in them asks again.
_ANSWER_TTL_S = 600
_ANSWER_MAX = 300
_answers: dict[tuple, tuple[float, str]] = {}


def _answer_key(ctx: dict) -> tuple:
    cur = ctx.get("current_dict") or {}
    days = (ctx.get("forecast_dict") or {}).get("days") or []
    tomorrow = days[1] if len(days) > 1 else {}
    v = ctx.get("verdict") or {}
    loc = ctx.get("loc") or {}
    return (" ".join(str(ctx.get("message") or "").lower().split()), loc.get("district"), loc.get("state"),
            ctx.get("language"), ctx.get("user_type"), v.get("level"), v.get("severity"), v.get("hazard"),
            cur.get("temperature"), cur.get("condition"), tomorrow.get("rainfall"),
            tuple((ctx.get("evidence") or {}).get("earlier_questions") or ()),
            str((ctx.get("evidence") or {}).get("climate_trend") or ""))


def _cached_answer(ctx: dict) -> str | None:
    hit = _answers.get(_answer_key(ctx))
    if hit and time.monotonic() - hit[0] < _ANSWER_TTL_S:
        return hit[1]
    return None


def _remember_answer(ctx: dict, answer: str) -> None:
    while len(_answers) >= _ANSWER_MAX:
        _answers.pop(next(iter(_answers)))
    _answers[_answer_key(ctx)] = (time.monotonic(), answer)


async def _handle(req: ChatRequest) -> ChatResponse:
    t0 = time.perf_counter()
    ctx = await _prepare(req)
    if ctx["early"] is not None:
        return ctx["early"]

    cached = _cached_answer(ctx)
    if cached is not None:
        return _build_response(ctx["loc"], ctx["verified_dict"], ctx["risk"], ctx["current_dict"] or {},
                               ctx["forecast_dict"] or {}, cached, ctx["advisory"], ctx["language"],
                               ctx["weather_block"], ctx["ev"], False,
                               user_type=ctx["user_type"], verdict=ctx["verdict"],
                               response_time_ms=int((time.perf_counter() - t0) * 1000))

    llm = LLMService()
    model_error = ""
    try:
        answer, fallback = await llm.generate(ctx["evidence"], ctx["message"], ctx["language"])
    except RuntimeError as exc:
        # Honest degradation: an invalid LLM_MODEL must never 500 /api/chat.
        # The user gets the grounded template answer with a visible model_error
        # naming the misconfiguration; the [WeatherGPT CONFIG ERROR] banner at
        # startup already shouted about it on stderr.
        model_error = str(exc)
        answer, fallback = _template_answer(ctx["evidence"], ctx["message"], ctx["language"]), True

    # Post-LLM response validation (§10, §43): the gate before delivery.
    # NOTE: advisory is NOT appended to the chat answer. Chat is facts-only;
    # guidance lives in the separate Advisory surface (see ChatResponse.advisory).
    answer, fallback = _finalize_answer(ctx, answer, fallback)
    if not fallback:
        _remember_answer(ctx, answer)

    response_time_ms = int((time.perf_counter() - t0) * 1000)
    return _build_response(ctx["loc"], ctx["verified_dict"], ctx["risk"], ctx["current_dict"] or {},
                           ctx["forecast_dict"] or {}, answer, ctx["advisory"], ctx["language"],
                           ctx["weather_block"], ctx["ev"], fallback,
                           user_type=ctx["user_type"], verdict=ctx["verdict"],
                           response_time_ms=response_time_ms, model_error=model_error)


def _ndjson(obj: dict) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, default=str) + "\n").encode("utf-8")


@router.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    """Token-streaming chat (NDJSON lines): meta, token*, final?, done.

    `meta` carries every ChatResponse field except the answer; `token` lines
    append to the answer as the model produces them (real first-token latency);
    `final` (only when post-LLM validation corrected the streamed text, or the
    stream broke mid-flight) replaces the streamed text; `done` closes with
    structured_fallback / model_error / response_time_ms. Validation, the
    rain-lead rule, and the honesty gates are identical to /api/chat.
    """
    async def gen():
        t0 = time.perf_counter()
        ctx = await _prepare(req)
        if ctx["early"] is not None:
            d = ctx["early"].model_dump(mode="json")
            answer = d.pop("answer", "")
            yield _ndjson({"type": "meta", **d})
            if answer:
                yield _ndjson({"type": "token", "text": answer})
            yield _ndjson({"type": "done", "structured_fallback": True, "model_error": "",
                           "response_time_ms": int((time.perf_counter() - t0) * 1000)})
            return

        resp = _build_response(ctx["loc"], ctx["verified_dict"], ctx["risk"],
                               ctx["current_dict"] or {}, ctx["forecast_dict"] or {},
                               "", ctx["advisory"], ctx["language"], ctx["weather_block"],
                               ctx["ev"], False,
                               user_type=ctx["user_type"], verdict=ctx["verdict"])
        d = resp.model_dump(mode="json")
        d.pop("answer", None)
        yield _ndjson({"type": "meta", **d})

        cached = _cached_answer(ctx)
        if cached is not None:
            yield _ndjson({"type": "token", "text": cached})
            yield _ndjson({"type": "done", "structured_fallback": False, "model_error": "",
                           "response_time_ms": int((time.perf_counter() - t0) * 1000)})
            return

        llm = LLMService()
        parts: list[str] = []
        fallback = False
        model_error = ""
        truncated = False
        async for ev in llm.generate_stream(ctx["evidence"], ctx["message"], ctx["language"]):
            if ev.get("type") == "token":
                text = ev.get("text", "")
                parts.append(text)
                yield _ndjson({"type": "token", "text": text})
            elif ev.get("type") == "end":
                fallback = bool(ev.get("fallback"))
                model_error = ev.get("model_error", "")
                truncated = bool(ev.get("truncated"))
        raw = "".join(parts)
        streamed = raw  # what the client has already rendered, token by token
        if truncated or not raw.strip():
            # The live answer broke mid-flight: substitute the grounded template,
            # flagged as fallback — never deliver a half answer as if complete.
            raw = _template_answer(ctx["evidence"], ctx["message"], ctx["language"])
            fallback = True
        answer, validated_fallback = _finalize_answer(ctx, raw)
        fallback = fallback or validated_fallback
        if not fallback:
            _remember_answer(ctx, answer)
        # Compare against what the client actually saw, not the substituted
        # raw: on truncation the client holds partial text, so it must get a
        # `final` event carrying the complete template answer to swap in.
        if answer != streamed:
            yield _ndjson({"type": "final", "answer": answer,
                           "structured_fallback": fallback})
        yield _ndjson({"type": "done", "structured_fallback": fallback,
                       "model_error": model_error,
                       "response_time_ms": int((time.perf_counter() - t0) * 1000)})

    return StreamingResponse(gen(), media_type="application/x-ndjson")


from fastapi import Response

@router.post("/api/chat")
async def chat(req: ChatRequest, response: Response = None) -> ChatResponse:
    result = await _handle(req)
    if response is not None:
        response.headers["X-Resp-Ms"] = str(result.response_time_ms)
    return result


@router.post("/api/chat/query")
async def chat_query(req: ChatRequest, response: Response = None) -> ChatResponse:
    """Spec §51 alias."""
    result = await _handle(req)
    if response is not None:
        response.headers["X-Resp-Ms"] = str(result.response_time_ms)
    return result
