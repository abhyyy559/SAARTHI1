"""Chat endpoint — full pipeline: parse -> resolve -> retrieve -> validate -> risk -> advisory -> LLM.

Demo mode: IMD fixtures (DEMO). Live mode: Open-Meteo + IMD-live + CAP (provenance
per fact). Both modes refuse to invent (§54/§59). Spec alias: POST /api/chat/query.
"""
import asyncio
import re

from fastapi import APIRouter

from .. import config
from ..adapters.registry import AdapterUnavailable
from ..models.chat import ChatRequest, ChatResponse
from ..rules.weather_rules import WeatherRules
from ..services.advisory_service import advisory_for
from ..services.alert_service import gather_alerts
from ..services.imd_service import IMDService
from ..services.llm_service import LLMService, build_evidence_package
from ..services.location_service import LocationService
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
        return {**(verified_dict or {}), "verified": True,
                "severity": verdict.get("severity"), "hazard": verdict.get("hazard"),
                "source": verdict.get("source")}
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
    return verified_dict


_RAIN_WORDS = ("rain", "barish", "वर्षा", "వర్షం", "बारिश")
# A yes/no that appears this early is the answer, not a mention of one.
_RAIN_ANSWER_WINDOW = 220
# ...but only when the yes/no is ABOUT rain, or when it OPENS the answer. A bare
# "no" in the middle of a sentence ("there is no active warning") is a mention,
# not an answer: treating it as one left the rain question with NO yes/no at all.
# A leading yes/no ("No, it will stay dry tomorrow.") is an answer even when the
# sentence does not repeat the word "rain".
_RAIN_ANSWER_RE = re.compile(
    r"\b(yes|no)\b[\s\S]{0,80}?(?:rain|barish|वर्षा|వర్షం|बारिश)"
    r"|(?:rain|barish|वर्षा|వర్షం|बारिश)[\s\S]{0,80}?\b(yes|no)\b",
    re.I,
)
_LEADING_MARKUP_RE = re.compile(r"^[\s#>*_`\-]+")
_LEADING_YESNO_RE = re.compile(r"(yes|no)\b", re.I)


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
    return bool(_LEADING_YESNO_RE.match(_LEADING_MARKUP_RE.sub("", answer or "")))


def _ensure_rain_lead(message: str, forecast_dict: dict | None, answer: str) -> str:
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
    line = f"Yes — rain likely tomorrow ({fc_rain} mm)." if fc_rain > 0 else "No rain expected tomorrow."
    if line in answer:
        return answer
    if _answer_already_given(answer):
        return answer
    return f"{line}\n\n{answer}"


def _build_response(loc, verified_dict, risk, current_dict, forecast_dict, answer,
                    advisory, language, weather_block, provenance_map, fallback=False, user_type="general",
                    verdict=None, response_time_ms=0) -> ChatResponse:
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


async def _retrieve_live(loc, lat, lon) -> tuple[dict | None, dict | None, dict, list, dict]:
    prov_notes: dict = {}
    try:
        current_dict, prov = await _live_current(lat, lon)
        prov_notes["current"] = prov
    except AdapterUnavailable:
        current_dict, prov_notes["current"] = None, "UNAVAILABLE"
    try:
        forecast_dict, prov = await _live_forecast(lat, lon)
        prov_notes["forecast"] = prov
    except AdapterUnavailable:
        forecast_dict, prov_notes["forecast"] = None, "UNAVAILABLE"

    imd = IMDService(adapter="live")
    warning, verified_dict = None, {"verified": False, "severity": "GREEN", "hazard": None, "source": "IMD"}
    warn_call_ok = False
    try:
        warning = await imd.get_district_warning(loc["district"])
        # The service ANSWERED. "Nothing to report" and "we could not check" are
        # different facts and must never be conflated (see verdict_service).
        warn_call_ok = True
        v = ValidationService(imd).validate_warning(warning, loc["district"]) if warning else None
        if v:
            verified_dict = v.model_dump(mode="json")
    except AdapterUnavailable:
        # Honesty: mark the warning service state so no downstream layer
        # reports "no active warning" while we actually could not check.
        verified_dict["warning_service"] = "unavailable"

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
    gathered = await gather_alerts(lat=lat, lon=lon, district=loc["district"],
                                   state=loc.get("state") or "")
    cap_alerts = gathered["relevant"]
    nearby_alerts = gathered["nearby"]
    for a in cap_alerts:
        ev.append({"source": a.get("provenance") or "NDMA-Sachet-CAP", "type": "cap_alert",
                   "issued_at": a.get("sent"), "valid_until": a.get("expires"),
                   "provenance": a.get("provenance") or gathered["provenance"]})

    # imd mode serves IMD facts or nothing, so the phrasing layer must not name
    # Open-Meteo as the source of an IMD observation (docs/SOURCE-MODES.md).
    source_name = "IMD" if config.current_source_mode() == "imd" else "Open-Meteo"
    notes = {"source_name": source_name, **prov_notes,
             "cap_alerts": cap_alerts, "nearby_alerts": nearby_alerts,
             "warning_raw": warning_d,
             "warning_service_available": warn_call_ok,
             "warning_matches_location": warn_matches_location}
    return current_dict, forecast_dict, verified_dict, ev, notes


async def _handle(req: ChatRequest) -> ChatResponse:
    import time
    t0 = time.perf_counter()
    rules = WeatherRules()
    rules.parse(req.message)
    loc = LocationService().resolve(req.latitude, req.longitude)
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
        # evidence of safety). The verdict is the authority for both.
        return _build_response(loc, verified_dict, risk, None, None,
                               _unavailable_answer(req.language),
                               advisory_for(verified_dict, req.user_type, req.language, verdict=verdict,
                                           coastal=loc.get("coastal"), district=loc.get("district")),
                               req.language, {"status": "unavailable", "provenance": "UNAVAILABLE"}, [], True,
                               user_type=req.user_type, verdict=verdict)

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

    llm = LLMService()
    answer, fallback = await llm.generate(evidence, req.message, req.language)

    # Post-LLM response validation (§10, §43): the gate before delivery.
    from ..services.response_validator import validate as validate_answer
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
    answer, findings = validate_answer(answer, llm_verified, numbers, req.language)
    if findings:
        evidence["validation_findings"] = findings
        fallback = True

    # Prepend a clear rain answer for "rain tomorrow" queries (T2.1 S2.1.4).
    # The template answer already does this; the LLM may phrase it differently or
    # bury it. `_ensure_rain_lead` owns that rule and refuses to add a second
    # yes/no when the answer already gave one — the inline copy that used to live
    # here compared the exact line text instead, so "Yes — rain likely tomorrow
    # (22.0 mm)." was prepended straight above "**Yes**, it will rain tomorrow."
    answer = _ensure_rain_lead(req.message, forecast_dict, answer)

    answer = f"{answer}\n\n{advisory}"

    weather_block = {"current": current_dict, "forecast_days": (forecast_dict or {}).get("days", [])[:3]}
    response_time_ms = int((time.perf_counter() - t0) * 1000)
    return _build_response(loc, verified_dict, risk, current_dict or {}, forecast_dict or {},
                           answer, advisory, req.language, weather_block, ev, fallback,
                           user_type=req.user_type, verdict=verdict, response_time_ms=response_time_ms)


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
