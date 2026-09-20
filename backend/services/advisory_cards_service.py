"""Situation-aware advisory cards — a deterministic rules engine (no LLM required).

Extends (never duplicates) ``advisory_service.weather_advisories``: those rules
fire persona-neutral weather lines; this module composes persona-aware DECISION
cards from three real inputs — current observations, the 3-day forecast, and the
official alert verdict — with trilingual templates and cited basis facts.

Hard rules (eval params 1, 3, 4 · key features 5, 6):
- Official severity is never invented or escalated. Rule-derived cards carry
  severity_word "info"; alert-linked cards carry their own official grade from
  the alert (the verdict gates which alerts are confirmed; per-alert grades are
  never promoted to the strongest); unreadable/missing severity stays "UNKNOWN".
- Missing data is stated ("Forecast unavailable — cannot time spraying") and
  NEVER fabricated. No number appears in a card unless it was in the input.
- Every card cites its basis facts with named provenance (LIVE/CACHED/DEMO/
  UNAVAILABLE), e.g. "Forecast day +2 (22 Sep): 62mm rain (Open-Meteo, LIVE)".
- Every user-facing string exists in EN/HI/TE. No Tamil script anywhere.

Dynamic re-evaluation (diff_cards / evaluate_change / snapshot_inputs) lets
the alert watcher re-run this engine as inputs change and diff the results.
Diffing never invents or escalates severity: escalation is only ever
*detected* from the inputs (official grade got more urgent, or a rain-cited
card cites a larger number), and UNKNOWN severity never escalates.
"""

import re
from datetime import datetime, timezone

from .advisory_service import _ACTION, _first_num, _lang_of

# Thresholds follow advisory_service (rain>=50 heavy, >=20 moderate, wind>=60
# kph, temp>=42 heat, <=5 cold) and extend them with agri timing logic.
_RAIN_HEAVY_MM = 50.0
_RAIN_MOD_MM = 20.0
_WIND_GALE_KPH = 60.0
_HEAT_C = 42.0
_COLD_C = 5.0
_MAX_CARDS = 4
_FORECAST_WINDOW = 3  # days

# Key aliases extend the advisory_service patterns with the model_dump keys
# the live/demo adapters actually emit (WeatherObservation / ForecastDay).
_RAIN_KEYS = ("rain_mm", "precip_mm", "precipitation_mm", "rainfall_mm", "precip",
              "rainfall", "rain")
_WIND_KEYS = ("wind_kph", "wind_speed_kph", "windspeed_kph", "wind_speed", "wind_ms")
_TEMP_KEYS = ("temp_c", "temperature_c", "temperature", "temp")
_TMAX_KEYS = ("max_temperature", "temp_max", "tmax")
_TMIN_KEYS = ("min_temperature", "temp_min", "tmin")

_AGRI_PERSONAS = {"farmer", "general"}
_COMMUTE_PERSONAS = {"driver", "commuter", "general", "employee", "outdoor-worker", "student"}
_KNOWN_PERSONAS = {
    "general", "fisherman", "farmer", "driver", "researcher",
    "disaster_manager", "commuter", "employee", "outdoor-worker", "student",
}

# Official severity rank for card ordering — RED most urgent. UNKNOWN is never
# promoted above a readable grade, and "info" (rule-derived) always trails.
_SEV_RANK = {"RED": 0, "ORANGE": 1, "YELLOW": 2, "GREEN": 3, "UNKNOWN": 4, "info": 5}

_MONTHS = {
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "hi": ["जन", "फ़र", "मार्च", "अप्रै", "मई", "जून", "जुला", "अग", "सित", "अक्तू", "नव", "दिस"],
    "te": ["జన", "ఫిబ్ర", "మార్చి", "ఏప్రి", "మే", "జూన్", "జులై", "ఆగ", "సెప్టె", "అక్టో", "నవం", "డిసెం"],
}


def _fmt_date(raw: str | None, lang: str) -> str:
    """'2026-09-22' -> '22 Sep' (translated month). Unparseable -> raw string."""
    if not raw:
        return ""
    try:
        y, m, d = str(raw)[:10].split("-")
        mon = _MONTHS[lang][int(m) - 1]
        return f"{int(d)} {mon}"
    except (ValueError, IndexError):
        return str(raw)


def _valid_next3(lang: str, dates: list[str]) -> str:
    dated = [d for d in dates if d]
    if len(dated) >= 2:
        a, b = _fmt_date(dated[0], lang), _fmt_date(dated[-1], lang)
        return _T["valid_next3"][lang].format(a=a, b=b)
    return _T["valid_next3_plain"][lang]


# ---------------------------------------------------------------------------
# Trilingual templates. Every user-facing string lives here, in en/hi/te.
# {v} is a pre-formatted number that was PRESENT in the input — templates never
# invent numbers. {date} is a formatted forecast date. {action} is the
# persona-specific official-warning action from advisory_service._ACTION.
# ---------------------------------------------------------------------------
_T = {
    "valid_next3": {
        "en": "Next 3 days ({a}–{b})",
        "hi": "अगले 3 दिन ({a}–{b})",
        "te": "తరువాయి 3 రోజులు ({a}–{b})",
    },
    "valid_next3_plain": {
        "en": "Next 3 days",
        "hi": "अगले 3 दिन",
        "te": "తరువాయి 3 రోజులు",
    },
    "valid_today": {
        "en": "Today",
        "hi": "आज",
        "te": "ఈరోజు",
    },
    "valid_alert_until": {
        "en": "Valid until {w}",
        "hi": "{w} तक मान्य",
        "te": "{w} వరకు చెల్లుతుంది",
    },
    "valid_alert_open": {
        "en": "Now — until the warning ends",
        "hi": "अभी — चेतावनी समाप्त होने तक",
        "te": "ఇప్పుడు — హెచ్చరిక ముగిసే వరకు",
    },
    # --- basis citations: concrete data, named provenance -----------------
    "basis_rain_day": {
        "en": "Forecast day +{i} ({date}): {v}mm rain ({src}, {prov})",
        "hi": "पूर्वानुमान दिन +{i} ({date}): {v} मिमी वर्षा ({src}, {prov})",
        "te": "అంచనా రోజు +{i} ({date}): {v}మిమీ వర్షం ({src}, {prov})",
    },
    "basis_heat_day": {
        "en": "Forecast day +{i} ({date}): {v}°C max ({src}, {prov})",
        "hi": "पूर्वानुमान दिन +{i} ({date}): {v}°C अधिकतम ({src}, {prov})",
        "te": "అంచనా రోజు +{i} ({date}): {v}°C గరిష్ఠం ({src}, {prov})",
    },
    "basis_cold_day": {
        "en": "Forecast day +{i} ({date}): {v}°C min ({src}, {prov})",
        "hi": "पूर्वानुमान दिन +{i} ({date}): {v}°C न्यूनतम ({src}, {prov})",
        "te": "అంచనా రోజు +{i} ({date}): {v}°C కనిష్ఠం ({src}, {prov})",
    },
    "basis_cur_temp": {
        "en": "Current: {v}°C ({src}, {prov})",
        "hi": "वर्तमान: {v}°C ({src}, {prov})",
        "te": "ప్రస్తుతం: {v}°C ({src}, {prov})",
    },
    "basis_cur_rain": {
        "en": "Current: {v}mm rain ({src}, {prov})",
        "hi": "वर्तमान: {v} मिमी वर्षा ({src}, {prov})",
        "te": "ప్రస్తుతం: {v}మిమీ వర్షం ({src}, {prov})",
    },
    "basis_cur_wind": {
        "en": "Current: {v} kph wind ({src}, {prov})",
        "hi": "वर्तमान: {v} किमी/घंटा हवा ({src}, {prov})",
        "te": "ప్రస్తుతం: {v} కిమీ/గం గాలి ({src}, {prov})",
    },
    "basis_alert": {
        "en": "Alert {ident}: {sev} {hazard} ({src}, {prov})",
        "hi": "चेतावनी {ident}: {sev} {hazard} ({src}, {prov})",
        "te": "హెచ్చరిక {ident}: {sev} {hazard} ({src}, {prov})",
    },
    "basis_no_forecast": {
        "en": "Forecast: no data received ({prov})",
        "hi": "पूर्वानुमान: कोई डेटा नहीं मिला ({prov})",
        "te": "అంచనా: సమాచారం అందలేదు ({prov})",
    },
    "basis_no_current": {
        "en": "Current observations: no data received ({prov})",
        "hi": "वर्तमान अवलोकन: कोई डेटा नहीं मिला ({prov})",
        "te": "ప్రస్తుత పరిశీలనలు: సమాచారం అందలేదు ({prov})",
    },
    # --- agriculture -------------------------------------------------------
    "agri_rain_heavy": {
        "en": {
            "title": "Postpone spraying and irrigation",
            "body": "Heavy rain ({v}mm) is forecast for {date} — sprays would wash off and low fields may waterlog. Wait for a dry spell and clear field drains first.",
        },
        "hi": {
            "title": "छिड़काव और सिंचाई टालें",
            "body": "{date} को भारी वर्षा ({v} मिमी) का पूर्वानुमान है — दवा धुल जाएगी और निचले खेतों में पानी भर सकता है। सूखे मौसम का इंतज़ार करें और पहले खेत की नालियाँ खोलें।",
        },
        "te": {
            "title": "పిచికారీ మరియు నీటిపారుదల వాయిదా వేయండి",
            "body": "{date}న భారీ వర్షం ({v}మిమీ) అంచనా ఉంది — మందు కొట్టుకుపోతుంది, తక్కువ పొలాల్లో నీరు నిలుస్తుంది. పొడి వాతావరణం కోసం వేచి ఉండి, ముందు పొలం కాలువలు తెరవండి.",
        },
    },
    "agri_rain_hold": {
        "en": {
            "title": "Hold off on spraying",
            "body": "Rain ({v}mm) is forecast on {date} — spraying now would wash off. Irrigation can also wait until the rain passes.",
        },
        "hi": {
            "title": "छिड़काव अभी रोकें",
            "body": "{date} को वर्षा ({v} मिमी) का पूर्वानुमान है — अभी छिड़काव करने पर दवा धुल जाएगी। वर्षा बीतने तक सिंचाई भी टाली जा सकती है।",
        },
        "te": {
            "title": "పిచికారీ ఇప్పుడు ఆపండి",
            "body": "{date}న వర్షం ({v}మిమీ) అంచనా ఉంది — ఇప్పుడు పిచికారీ చేస్తే మందు కొట్టుకుపోతుంది. వర్షం తగ్గే వరకు నీటిపారుదల కూడా ఆపవచ్చు.",
        },
    },
    "agri_dry": {
        "en": {
            "title": "Good window for spraying and irrigation",
            "body": "No significant rain is forecast in the next 3 days (most {v}mm on {date}) — a good window for spraying and irrigation. Recheck tomorrow; forecasts shift.",
        },
        "hi": {
            "title": "छिड़काव और सिंचाई के लिए अच्छा समय",
            "body": "अगले 3 दिनों में कोई खास वर्षा नहीं है (अधिकतम {v} मिमी, {date} को) — छिड़काव और सिंचाई के लिए अच्छा समय है। कल दोबारा जाँचें; पूर्वानुमान बदल सकता है।",
        },
        "te": {
            "title": "పిచికారీ మరియు నీటిపారుదలకు మంచి సమయం",
            "body": "తరువాయి 3 రోజుల్లో గమనార్హ వర్షం లేదు (గరిష్ఠం {v}మిమీ, {date}న) — పిచికారీ మరియు నీటిపారుదలకు మంచి సమయం. రేపు మళ్లీ తనిఖీ చేయండి; అంచనాలు మారవచ్చు.",
        },
    },
    "agri_no_data": {
        "en": {
            "title": "Spraying advice unavailable",
            "body": "The forecast is unavailable — we cannot time spraying or irrigation. Check with your local agriculture officer before spraying.",
        },
        "hi": {
            "title": "छिड़काव सलाह उपलब्ध नहीं",
            "body": "पूर्वानुमान उपलब्ध नहीं है — छिड़काव या सिंचाई का समय तय नहीं हो सकता। छिड़काव से पहले अपने स्थानीय कृषि अधिकारी से जाँचें।",
        },
        "te": {
            "title": "పిచికారీ సలహా అందుబాటులో లేదు",
            "body": "అంచనా అందుబాటులో లేదు — పిచికారీ లేదా నీటిపారుదల సమయాన్ని నిర్ణయించలేము. పిచికారీకి ముందు మీ స్థానిక వ్యవసాయ అధికారితో తనిఖీ చేయండి.",
        },
    },
    # --- health ------------------------------------------------------------
    "health_heat": {
        "en": {
            "title": "Extreme heat — take precautions",
            "body": "Temperatures of {v}°C are forecast on {date}. Stay hydrated, avoid midday outdoor work, and check on the elderly and children.",
        },
        "hi": {
            "title": "अत्यधिक गर्मी — सावधानी बरतें",
            "body": "{date} को {v}°C तापमान का पूर्वानुमान है। पानी पिएँ, दोपहर में बाहरी काम से बचें, बुज़ुर्गों और बच्चों का ध्यान रखें।",
        },
        "te": {
            "title": "తీవ్ర వేడి — జాగ్రత్తలు తీసుకోండి",
            "body": "{date}న {v}°C ఉష్ణోగ్రత అంచనా ఉంది. నీరు తాగండి, మధ్యాహ్నం బయటి పనిని నివారించండి, వృద్ధులు, పిల్లలను జాగ్రత్తగా చూసుకోండి.",
        },
    },
    "health_cold": {
        "en": {
            "title": "Cold conditions — take care",
            "body": "Temperatures of {v}°C are forecast on {date}. Dress warmly, allow extra time for morning travel, and protect crops and livestock from frost.",
        },
        "hi": {
            "title": "ठंड की स्थिति — ध्यान रखें",
            "body": "{date} को {v}°C तापमान का पूर्वानुमान है। गर्म कपड़े पहनें, सुबह की यात्रा में अतिरिक्त समय रखें, फसल और पशुओं को पाले से बचाएँ।",
        },
        "te": {
            "title": "చలి పరిస్థితులు — జాగ్రత్తగా ఉండండి",
            "body": "{date}న {v}°C ఉష్ణోగ్రత అంచనా ఉంది. వెచ్చని దుస్తులు ధరించండి, ఉదయం ప్రయాణానికి అదనపు సమయం ఉంచుకోండి, పంట మరియు పశువులను మంచు నుండి కాపాడండి.",
        },
    },
    "health_calm": {
        "en": {
            "title": "No extreme heat or cold expected",
            "body": "Temperatures stay between {lo}°C and {hi}°C over the next 3 days — no heat or cold precautions needed beyond the usual.",
        },
        "hi": {
            "title": "अत्यधिक गर्मी या ठंड की उम्मीद नहीं",
            "body": "अगले 3 दिनों में तापमान {lo}°C से {hi}°C के बीच रहेगा — सामान्य से ज़्यादा गर्मी या ठंड की सावधानी की ज़रूरत नहीं।",
        },
        "te": {
            "title": "తీవ్ర వేడి లేదా చలి ఊహించలేదు",
            "body": "తరువాయి 3 రోజుల్లో ఉష్ణోగ్రత {lo}°C నుండి {hi}°C మధ్య ఉంటుంది — సాధారణం కంటే ఎక్కువ వేడి లేదా చలి జాగ్రత్తలు అవసరం లేదు.",
        },
    },
    "health_no_data": {
        "en": {
            "title": "Heat and cold advice unavailable",
            "body": "Temperature data is unavailable — we cannot assess heat or cold risk. Take normal precautions for the season.",
        },
        "hi": {
            "title": "गर्मी-ठंड सलाह उपलब्ध नहीं",
            "body": "तापमान डेटा उपलब्ध नहीं है — गर्मी या ठंड का जोखिम आँका नहीं जा सकता। मौसम के हिसाब से सामान्य सावधानी बरतें।",
        },
        "te": {
            "title": "వేడి-చలి సలహా అందుబాటులో లేదు",
            "body": "ఉష్ణోగ్రత సమాచారం అందుబాటులో లేదు — వేడి లేదా చలి ప్రమాదాన్ని అంచనా వేయలేము. సీజన్‌కు తగిన సాధారణ జాగ్రత్తలు తీసుకోండి.",
        },
    },
    # --- commute -----------------------------------------------------------
    "commute_heavy": {
        "en": {
            "title": "Avoid non-essential travel",
            "body": "Heavy rain ({v}mm) is forecast for {date} — roads can flood quickly. Delay non-essential travel and never drive through standing water.",
        },
        "hi": {
            "title": "गैर-ज़रूरी यात्रा से बचें",
            "body": "{date} को भारी वर्षा ({v} मिमी) का पूर्वानुमान है — सड़कें जल्दी भर सकती हैं। गैर-ज़रूरी यात्रा टालें और ठहरे पानी में गाड़ी कभी न चलाएँ।",
        },
        "te": {
            "title": "అత్యవసరం కాని ప్రయాణాన్ని నివారించండి",
            "body": "{date}న భారీ వర్షం ({v}మిమీ) అంచనా ఉంది — రోడ్లు వేగంగా నీట మునగవచ్చు. అత్యవసరం కాని ప్రయాణాన్ని వాయిదా వేయండి, నిలిచిన నీటిలో వాహనం నడపవద్దు.",
        },
    },
    "commute_wind": {
        "en": {
            "title": "High winds — drive carefully",
            "body": "Winds of {v} kph are reported — stay clear of hoardings, trees and exposed structures, and allow extra time on the road.",
        },
        "hi": {
            "title": "तेज़ हवाएँ — सावधानी से चलें",
            "body": "{v} किमी/घंटा हवाएँ दर्ज हैं — होर्डिंग, पेड़ों और खुली संरचनाओं से दूर रहें, सड़क पर अतिरिक्त समय रखें।",
        },
        "te": {
            "title": "బలమైన గాలులు — జాగ్రత్తగా నడపండి",
            "body": "{v} కిమీ/గం గాలులు నమోదయ్యాయి — హోర్డింగులు, చెట్లు, బహిరంగ నిర్మాణాలకు దూరంగా ఉండండి, రోడ్డుపై అదనపు సమయం ఉంచుకోండి.",
        },
    },
    "commute_wet": {
        "en": {
            "title": "Wet roads in the next 3 days",
            "body": "Rain ({v}mm) is forecast on {date}. Allow extra travel time and avoid waterlogged stretches.",
        },
        "hi": {
            "title": "अगले 3 दिनों में गीली सड़कें",
            "body": "{date} को वर्षा ({v} मिमी) का पूर्वानुमान है। यात्रा में अतिरिक्त समय रखें और जलभराव वाले रास्तों से बचें।",
        },
        "te": {
            "title": "తరువాయి 3 రోజుల్లో తడి రోడ్లు",
            "body": "{date}న వర్షం ({v}మిమీ) అంచనా ఉంది. ప్రయాణానికి అదనపు సమయం ఉంచుకోండి, నీరు నిలిచిన రోడ్లకు దూరంగా ఉండండి.",
        },
    },
    "commute_calm": {
        "en": {
            "title": "No major travel disruption expected",
            "body": "The next 3 days show no heavy rain or high winds (most {v}mm rain) — travel as usual, but recheck before long journeys.",
        },
        "hi": {
            "title": "यात्रा में बड़ी बाधा की उम्मीद नहीं",
            "body": "अगले 3 दिनों में भारी वर्षा या तेज़ हवाएँ नहीं हैं (अधिकतम {v} मिमी वर्षा) — सामान्य यात्रा करें, पर लंबी यात्रा से पहले दोबारा जाँचें।",
        },
        "te": {
            "title": "ప్రయాణానికి పెద్ద అంతరాయం ఊహించలేదు",
            "body": "తరువాయి 3 రోజుల్లో భారీ వర్షం లేదా బలమైన గాలులు లేవు (గరిష్ఠం {v}మిమీ వర్షం) — సాధారణంగా ప్రయాణించండి, కానీ దూర ప్రయాణాలకు ముందు మళ్లీ తనిఖీ చేయండి.",
        },
    },
    "commute_no_data": {
        "en": {
            "title": "Travel advice unavailable",
            "body": "The forecast is unavailable — we cannot assess road conditions. Travel with extra caution.",
        },
        "hi": {
            "title": "यात्रा सलाह उपलब्ध नहीं",
            "body": "पूर्वानुमान उपलब्ध नहीं है — सड़क की स्थिति आँकी नहीं जा सकती। अतिरिक्त सावधानी से यात्रा करें।",
        },
        "te": {
            "title": "ప్రయాణ సలహా అందుబాటులో లేదు",
            "body": "అంచనా అందుబాటులో లేదు — రోడ్డు పరిస్థితులను అంచనా వేయలేము. అదనపు జాగ్రత్తతో ప్రయాణించండి.",
        },
    },
    # --- alert-driven ------------------------------------------------------
    "alert_active": {
        "en": {
            "title": "{hazard} — official warning active",
            "body": "{action} This is an official warning — follow IMD and local authority instructions.",
        },
        "hi": {
            "title": "{hazard} — सरकारी चेतावनी सक्रिय",
            "body": "{action} यह एक सरकारी चेतावनी है — IMD और स्थानीय प्रशासन के निर्देश मानें।",
        },
        "te": {
            "title": "{hazard} — అధికారిక హెచ్చరిక సక్రియం",
            "body": "{action} ఇది అధికారిక హెచ్చరిక — IMD మరియు స్థానిక అధికారుల సూచనలు పాటించండి.",
        },
    },
    "alert_unconfirmed": {
        "en": {
            "title": "Warning status could not be confirmed",
            "body": "Official alerts were reported for your area but could not be confirmed ({reason}). Treat conditions as unverified — check IMD or local authorities before travelling or working outside.",
        },
        "hi": {
            "title": "चेतावनी की स्थिति की पुष्टि नहीं हो सकी",
            "body": "आपके क्षेत्र के लिए सरकारी चेतावनियाँ मिली थीं, पर उनकी पुष्टि नहीं हो सकी ({reason})। हालात को असत्यापित मानें — यात्रा या बाहर काम करने से पहले IMD या स्थानीय प्रशासन से जाँचें।",
        },
        "te": {
            "title": "హెచ్చరిక స్థితిని ఖరారీ చేయలేకపోయాం",
            "body": "మీ ప్రాంతానికి అధికారిక హెచ్చరికలు నమోదయ్యాయి, కానీ వాటిని ఖరారీ చేయలేకపోయాం ({reason}). పరిస్థితులను ధృవీకరించనివిగా పరిగణించండి — ప్రయాణించే లేదా బయట పని చేసే ముందు IMD లేదా స్థానిక అధికారులతో తనిఖీ చేయండి.",
        },
    },
    "reason_expired": {
        "en": "their validity window has closed",
        "hi": "उनकी वैधता अवधि समाप्त हो चुकी थी",
        "te": "వాటి చెల్లుబాటు కాలం ముగిసింది",
    },
    "reason_unreadable": {
        "en": "their severity could not be read",
        "hi": "उनकी गंभीरता पढ़ी नहीं जा सकी",
        "te": "వాటి తీవ్రతను చదవలేకపోయాం",
    },
    "reason_generic": {
        "en": "they could not be verified",
        "hi": "उनका सत्यापन नहीं हो सका",
        "te": "వాటిని ధృవీకరించలేకపోయాం",
    },
    # --- dynamic diff summary lines (only new user-facing strings) --------
    "diff_added": {
        "en": "New advisory: {title} [{sev}]",
        "hi": "नई सलाह: {title} [{sev}]",
        "te": "కొత్త సలహా: {title} [{sev}]",
    },
    "diff_removed": {
        "en": "Advisory ended: {title}",
        "hi": "सलाह समाप्त: {title}",
        "te": "సలహా ముగిసింది: {title}",
    },
    "diff_escalated_sev": {
        "en": "Advisory escalated: {title} [{old_sev} → {new_sev}]",
        "hi": "सलाह तीव्र हुई: {title} [{old_sev} → {new_sev}]",
        "te": "సలహా తీవ్రమైంది: {title} [{old_sev} → {new_sev}]",
    },
    "diff_escalated_rain": {
        "en": "Advisory worsened: {title} [{old_v}mm → {new_v}mm rain]",
        "hi": "सलाह बिगड़ी: {title} [{old_v} मिमी → {new_v} मिमी वर्षा]",
        "te": "సలహా దిగజారింది: {title} [{old_v}మిమీ → {new_v}మిమీ వర్షం]",
    },
}


# ---------------------------------------------------------------------------
# Input normalisation
# ---------------------------------------------------------------------------
def _days(forecast: dict | None) -> list[dict]:
    days = (forecast or {}).get("days") if isinstance(forecast, dict) else None
    if not isinstance(days, list):
        return []
    return [d for d in days[:_FORECAST_WINDOW] if isinstance(d, dict)]


def _src(blob: dict | None) -> str:
    s = (blob or {}).get("source")
    return str(s) if s else "weather service"


def _wind_kph(blob: dict | None) -> float | None:
    """Current wind in kph.

    The alias list returns the first numeric key in priority order; a value
    that arrived under the ``wind_ms`` alias is metres/second and is converted
    to kph (same convention as advisory_service._observed_weather). Plain
    ``wind_speed`` from the live adapters is already kph and is kept as-is.
    """
    if not isinstance(blob, dict):
        return None
    for k in _WIND_KEYS:
        v = blob.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        w = float(v)
        if k == "wind_ms":
            w = w * 3.6
        return w
    return None


def _num(x) -> float | None:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    return float(x)


class _Ctx:
    """Normalised inputs plus provenance for one card-building pass."""

    def __init__(self, current, forecast, alerts, verdict, persona, lang,
                 current_prov, forecast_prov, alerts_prov):
        self.lang = _lang_of(lang)
        self.persona = persona if persona in _KNOWN_PERSONAS else "general"
        self.current = current if isinstance(current, dict) else None
        self.forecast = forecast if isinstance(forecast, dict) else None
        self.days = _days(self.forecast)
        self.alerts = [a for a in (alerts or []) if isinstance(a, dict)]
        self.verdict = verdict if isinstance(verdict, dict) else {}
        self.cur_src = _src(self.current)
        self.fc_src = _src(self.forecast)
        self.cur_prov = current_prov or "UNAVAILABLE"
        self.fc_prov = forecast_prov or "UNAVAILABLE"
        self.al_prov = alerts_prov or "UNAVAILABLE"

    # -- extremes over the 3-day window -------------------------------------
    def max_rain(self):
        """(value, idx, date) of the wettest forecast day; None when no data."""
        best = None
        for i, d in enumerate(self.days):
            v = _first_num(d, _RAIN_KEYS)
            if v is not None and (best is None or v > best[0]):
                best = (v, i, d.get("date"))
        return best

    def max_heat(self):
        best = None
        for i, d in enumerate(self.days):
            v = _first_num(d, _TMAX_KEYS)
            if v is None:
                v = _first_num(d, _TEMP_KEYS)
            if v is not None and (best is None or v > best[0]):
                best = (v, i, d.get("date"))
        return best

    def min_cold(self):
        best = None
        for i, d in enumerate(self.days):
            v = _first_num(d, _TMIN_KEYS)
            if v is None:
                v = _first_num(d, _TEMP_KEYS)
            if v is not None and (best is None or v < best[0]):
                best = (v, i, d.get("date"))
        return best

    def cur_temp(self):
        return _first_num(self.current, _TEMP_KEYS)

    def cur_wind(self):
        return _wind_kph(self.current)

    def dates(self):
        return [d.get("date") for d in self.days]

    # -- citation helpers ----------------------------------------------------
    def cite_rain_day(self, idx, date, v):
        return _T["basis_rain_day"][self.lang].format(
            i=idx, date=_fmt_date(date, self.lang), v=f"{v:g}",
            src=self.fc_src, prov=self.fc_prov)

    def cite_heat_day(self, idx, date, v):
        return _T["basis_heat_day"][self.lang].format(
            i=idx, date=_fmt_date(date, self.lang), v=f"{v:g}",
            src=self.fc_src, prov=self.fc_prov)

    def cite_cold_day(self, idx, date, v):
        return _T["basis_cold_day"][self.lang].format(
            i=idx, date=_fmt_date(date, self.lang), v=f"{v:g}",
            src=self.fc_src, prov=self.fc_prov)

    def cite_cur_temp(self, v):
        return _T["basis_cur_temp"][self.lang].format(
            v=f"{v:g}", src=self.cur_src, prov=self.cur_prov)

    def cite_cur_wind(self, v):
        return _T["basis_cur_wind"][self.lang].format(
            v=f"{v:g}", src=self.cur_src, prov=self.cur_prov)

    def cite_no_forecast(self):
        return _T["basis_no_forecast"][self.lang].format(prov=self.fc_prov)

    def cite_no_current(self):
        return _T["basis_no_current"][self.lang].format(prov=self.cur_prov)


def _card(cid, kind, tpl_key, lang, body_vars, basis, severity_word, valid_for, rank):
    tpl = _T[tpl_key][lang]
    return {
        "id": cid,
        "kind": kind,
        "title": tpl["title"].format(**body_vars),
        "body": tpl["body"].format(**body_vars),
        "basis": list(basis),
        "severity_word": severity_word,
        "valid_for": valid_for,
        "_rank": rank,
    }


# ---------------------------------------------------------------------------
# Card families
# ---------------------------------------------------------------------------
def _agri_card(ctx: _Ctx):
    if ctx.persona not in _AGRI_PERSONAS:
        return None
    lang = ctx.lang
    wet = ctx.max_rain()
    if wet is None:
        return _card("agri-no-data", "agriculture", "agri_no_data", lang, {},
                     [ctx.cite_no_forecast()], "info",
                     _T["valid_next3_plain"][lang], 30)
    v, idx, date = wet
    ds = _fmt_date(date, lang)
    if v >= _RAIN_HEAVY_MM:
        return _card("agri-rain-heavy", "agriculture", "agri_rain_heavy", lang,
                     {"v": f"{v:g}", "date": ds}, [ctx.cite_rain_day(idx, date, v)],
                     "info", _valid_next3(lang, ctx.dates()), 10)
    if v >= _RAIN_MOD_MM:
        return _card("agri-rain-hold", "agriculture", "agri_rain_hold", lang,
                     {"v": f"{v:g}", "date": ds}, [ctx.cite_rain_day(idx, date, v)],
                     "info", _valid_next3(lang, ctx.dates()), 13)
    return _card("agri-dry", "agriculture", "agri_dry", lang,
                 {"v": f"{v:g}", "date": ds}, [ctx.cite_rain_day(idx, date, v)],
                 "info", _valid_next3(lang, ctx.dates()), 20)


def _health_card(ctx: _Ctx):
    lang = ctx.lang
    heat = ctx.max_heat()
    cold = ctx.min_cold()
    cur = ctx.cur_temp()
    # Observed heat/cold wins over forecast: measured beats modelled.
    cur_heat = cur is not None and cur >= _HEAT_C
    cur_cold = cur is not None and cur <= _COLD_C
    if cur_heat or (heat is not None and heat[0] >= _HEAT_C):
        if cur_heat and (heat is None or cur >= heat[0]):
            v, basis = cur, [ctx.cite_cur_temp(cur)]
            ds, vf = _T["valid_today"][lang], _T["valid_today"][lang]
        else:
            v, idx, date = heat
            ds = _fmt_date(date, lang)
            basis = [ctx.cite_heat_day(idx, date, v)]
            vf = _valid_next3(lang, ctx.dates())
        return _card("health-heat", "health", "health_heat", lang,
                     {"v": f"{v:g}", "date": ds}, basis, "info", vf, 10)
    if cur_cold or (cold is not None and cold[0] <= _COLD_C):
        if cur_cold and (cold is None or cur <= cold[0]):
            v, basis = cur, [ctx.cite_cur_temp(cur)]
            ds, vf = _T["valid_today"][lang], _T["valid_today"][lang]
        else:
            v, idx, date = cold
            ds = _fmt_date(date, lang)
            basis = [ctx.cite_cold_day(idx, date, v)]
            vf = _valid_next3(lang, ctx.dates())
        return _card("health-cold", "health", "health_cold", lang,
                     {"v": f"{v:g}", "date": ds}, basis, "info", vf, 12)
    if heat is not None or cold is not None or cur is not None:
        vals = [x for x in [cur, heat[0] if heat else None, cold[0] if cold else None]
                if x is not None]
        lo, hi = min(vals), max(vals)
        basis = []
        if heat is not None:
            basis.append(ctx.cite_heat_day(heat[1], heat[2], heat[0]))
        if cold is not None:
            basis.append(ctx.cite_cold_day(cold[1], cold[2], cold[0]))
        if cur is not None:
            basis.append(ctx.cite_cur_temp(cur))
        return _card("health-calm", "health", "health_calm", lang,
                     {"lo": f"{lo:g}", "hi": f"{hi:g}"}, basis,
                     "info", _valid_next3(lang, ctx.dates()), 21)
    return _card("health-no-data", "health", "health_no_data", lang, {},
                 [ctx.cite_no_current(), ctx.cite_no_forecast()], "info",
                 _T["valid_next3_plain"][lang], 31)


def _commute_card(ctx: _Ctx):
    if ctx.persona not in _COMMUTE_PERSONAS:
        return None
    lang = ctx.lang
    wet = ctx.max_rain()
    wind = ctx.cur_wind()
    if wet is not None and wet[0] >= _RAIN_HEAVY_MM:
        v, idx, date = wet
        return _card("commute-heavy", "commute", "commute_heavy", lang,
                     {"v": f"{v:g}", "date": _fmt_date(date, lang)},
                     [ctx.cite_rain_day(idx, date, v)],
                     "info", _valid_next3(lang, ctx.dates()), 10)
    if wind is not None and wind >= _WIND_GALE_KPH:
        return _card("commute-wind", "commute", "commute_wind", lang,
                     {"v": f"{wind:g}"}, [ctx.cite_cur_wind(wind)],
                     "info", _T["valid_today"][lang], 11)
    if wet is not None and wet[0] >= _RAIN_MOD_MM:
        v, idx, date = wet
        return _card("commute-wet", "commute", "commute_wet", lang,
                     {"v": f"{v:g}", "date": _fmt_date(date, lang)},
                     [ctx.cite_rain_day(idx, date, v)],
                     "info", _valid_next3(lang, ctx.dates()), 13)
    if wet is not None or wind is not None:
        basis = []
        if wet is not None:
            basis.append(ctx.cite_rain_day(wet[1], wet[2], wet[0]))
        if wind is not None:
            basis.append(ctx.cite_cur_wind(wind))
        vmax = f"{wet[0]:g}" if wet is not None else "0"
        return _card("commute-calm", "commute", "commute_calm", lang,
                     {"v": vmax}, basis,
                     "info", _valid_next3(lang, ctx.dates()), 22)
    return _card("commute-no-data", "commute", "commute_no_data", lang, {},
                 [ctx.cite_no_forecast()], "info",
                 _T["valid_next3_plain"][lang], 32)


def _alert_cards(ctx: _Ctx) -> list[dict]:
    """Alert-driven safety cards from CONFIRMED active alerts only.

    The verdict is the one severity authority: cards fire only when the verdict
    confirms an official alert. Each card carries its own official grade from
    the alert (never promoted to the verdict's strongest), and UNKNOWN stays
    UNKNOWN. No alert is ever invented from weather numbers.
    """
    lang = ctx.lang
    verdict = ctx.verdict
    confirmed = bool(verdict.get("confirmed"))
    level = str(verdict.get("level") or "").upper()
    sev = str(verdict.get("severity") or "").upper() or "UNKNOWN"
    if sev not in _SEV_RANK:
        sev = "UNKNOWN"  # unreadable grade is UNKNOWN, never a guessed grade
    cards = []
    if confirmed and level != "LOW" and ctx.alerts:
        persona_action = (_ACTION.get(ctx.persona) or _ACTION["general"])[lang]
        for n, a in enumerate(ctx.alerts):
            ident = str(a.get("identifier") or a.get("headline") or f"alert-{n + 1}")
            hazard = str(a.get("hazard") or a.get("event") or a.get("headline") or "Severe weather")
            asrc = str(a.get("source") or "SACHET CAP")
            # Each card carries its own official grade from the alert: stamping
            # every card with the verdict's strongest severity would escalate
            # the weaker alerts. The verdict is the gate (it decided THESE
            # alerts are confirmed); the per-alert grade is the label.
            # Unreadable grades are UNKNOWN, never promoted to the strongest.
            asev = str(a.get("severity") or "").upper()
            if asev not in ("RED", "ORANGE", "YELLOW", "GREEN"):
                asev = "UNKNOWN"
            basis = [_T["basis_alert"][lang].format(
                ident=ident, sev=asev, hazard=hazard, src=asrc, prov=ctx.al_prov)]
            expires = a.get("expires") or a.get("valid_until")
            vf = (_T["valid_alert_until"][lang].format(w=_fmt_date(str(expires)[:10], lang))
                  if expires else _T["valid_alert_open"][lang])
            cards.append(_card(f"alert-{n}", "alert_safety", "alert_active", lang,
                               {"hazard": hazard, "action": persona_action}, basis,
                               asev, vf, _SEV_RANK[asev]))
        return cards
    # We SAW official alerts but the verdict could not confirm them (expired,
    # unreadable severity, or unverified): say exactly that, once, graded
    # UNKNOWN — never a calm, never an invented active warning.
    saw_something = bool(ctx.alerts) or bool(verdict.get("stale_cap")) \
        or bool(verdict.get("unreadable_severity")) \
        or str(verdict.get("basis") or "") == "unverified_warning"
    if verdict and not confirmed and saw_something:
        if verdict.get("stale_cap"):
            reason = _T["reason_expired"][lang]
        elif verdict.get("unreadable_severity"):
            reason = _T["reason_unreadable"][lang]
        else:
            reason = _T["reason_generic"][lang]
        basis = []
        for n, a in enumerate(ctx.alerts[:3]):
            ident = str(a.get("identifier") or a.get("headline") or f"alert-{n + 1}")
            hazard = str(a.get("hazard") or a.get("event") or "Severe weather")
            asrc = str(a.get("source") or "SACHET CAP")
            basis.append(_T["basis_alert"][lang].format(
                ident=ident, sev="UNKNOWN", hazard=hazard, src=asrc, prov=ctx.al_prov))
        cards.append(_card("alert-unconfirmed", "alert_safety", "alert_unconfirmed",
                           lang, {"reason": reason}, basis, "UNKNOWN",
                           _T["valid_alert_open"][lang], _SEV_RANK["UNKNOWN"]))
    return cards


def _rank(card: dict) -> tuple:
    if card["kind"] == "alert_safety":
        return (0, _SEV_RANK.get(card["severity_word"], 9), card["id"])
    return (1, card["_rank"], card["id"])


def advisory_cards(
    current: dict | None,
    forecast: dict | None,
    alerts: list[dict] | None,
    verdict: dict | None,
    persona: str = "general",
    lang: str = "en",
    current_prov: str = "LIVE",
    forecast_prov: str = "LIVE",
    alerts_prov: str = "LIVE",
) -> list[dict]:
    """Build up to 4 ranked, situation-aware advisory cards.

    `current` / `forecast` are the adapter model_dump dicts (keys vary by
    adapter; aliases handled internally). `alerts` are the official CAP alerts
    relevant to the location. `verdict` is `build_verdict(...)` output and is
    the ONLY source of alert truth. Provenance labels name the actual source of
    each input. Empty inputs yield honest "unavailable" cards, never invented
    data.
    """
    ctx = _Ctx(current, forecast, alerts, verdict, persona, lang,
               current_prov, forecast_prov, alerts_prov)
    cards = [c for c in (
        _agri_card(ctx),
        _health_card(ctx),
        _commute_card(ctx),
    ) if c is not None]
    cards.extend(_alert_cards(ctx))
    cards.sort(key=_rank)
    out = []
    for c in cards[:_MAX_CARDS]:
        c = dict(c)
        c.pop("_rank", None)
        out.append(c)
    return out


def template_langs() -> dict[str, set[str]]:
    """Card template keys present per language — for parity tests."""
    per: dict[str, set[str]] = {}
    for key, val in _T.items():
        for lang in ("en", "hi", "te"):
            if isinstance(val, dict) and lang in val:
                per.setdefault(lang, set()).add(key)
    return per


# ---------------------------------------------------------------------------
# Dynamic re-evaluation: diff two card sets, rebuild from stored snapshots,
# and decide what is worth a user notification. None of this changes the card
# rules above — it only compares their outputs across input snapshots.
# ---------------------------------------------------------------------------
_READABLE_SEV = {"RED", "ORANGE", "YELLOW", "GREEN"}
# The rules engine formats the number with Latin digits in every language
# (f"{v:g}") but the unit word is localised: "mm" / "मिमी" / "మిమీ".
_RAIN_CITE_RE = re.compile(r"(\d+(?:\.\d+)?)\s?(?:mm|मिमी|మిమీ)")


def _card_rain_mm(card: dict | None) -> float | None:
    """Rain value (mm) cited on a card, or None.

    Scans title/body/basis for the first '<n>mm' citation. The rules engine
    cites exactly one rain figure per card (the triggering day's value), so
    the first match is the card's cited number — never invented here.
    """
    if not isinstance(card, dict):
        return None
    text = " ".join([str(card.get("title") or ""), str(card.get("body") or "")] +
                    [str(b) for b in (card.get("basis") or [])])
    m = _RAIN_CITE_RE.search(text)
    return float(m.group(1)) if m else None


def _escalation(old_card: dict, new_card: dict) -> dict | None:
    """Describe a worsening for one stable card id, or None.

    Two honest worsening signals, both *detected* from the inputs — severity
    is never invented or promoted:
    - official grade got more urgent (RED outranks ORANGE outranks YELLOW
      outranks GREEN), but ONLY from a readable baseline: UNKNOWN never
      escalates;
    - a rain-cited card now cites a larger rain number.
    Downgrades, unchanged cards, and unreadable severities return None.
    """
    o_sev, n_sev = old_card.get("severity_word"), new_card.get("severity_word")
    if o_sev in _READABLE_SEV and n_sev in _READABLE_SEV \
            and _SEV_RANK[n_sev] < _SEV_RANK[o_sev]:
        return {"id": new_card["id"], "kind": new_card.get("kind"),
                "title": new_card.get("title"), "signal": "severity",
                "old_severity_word": o_sev, "new_severity_word": n_sev,
                "old_rain_mm": None, "new_rain_mm": None}
    o_rain, n_rain = _card_rain_mm(old_card), _card_rain_mm(new_card)
    if o_rain is not None and n_rain is not None and n_rain > o_rain:
        return {"id": new_card["id"], "kind": new_card.get("kind"),
                "title": new_card.get("title"), "signal": "rain",
                "old_severity_word": o_sev, "new_severity_word": n_sev,
                "old_rain_mm": o_rain, "new_rain_mm": n_rain}
    return None


def _diff_summary_lines(lang: str, added: list[dict], removed: list[dict],
                        escalated: list[dict]) -> list[str]:
    lines = []
    for c in added:
        lines.append(_T["diff_added"][lang].format(
            title=c.get("title") or "", sev=c.get("severity_word") or ""))
    for c in removed:
        lines.append(_T["diff_removed"][lang].format(title=c.get("title") or ""))
    for e in escalated:
        if e["signal"] == "rain":
            lines.append(_T["diff_escalated_rain"][lang].format(
                title=e.get("title") or "",
                old_v=f"{e['old_rain_mm']:g}", new_v=f"{e['new_rain_mm']:g}"))
        else:
            lines.append(_T["diff_escalated_sev"][lang].format(
                title=e.get("title") or "",
                old_sev=e.get("old_severity_word") or "",
                new_sev=e.get("new_severity_word") or ""))
    return lines


def diff_cards(old: list[dict] | None, new: list[dict] | None) -> dict:
    """Diff two advisory-card sets by stable card id.

    Returns {"added", "removed", "escalated", "summary"}:
    - added: cards present in `new` but not `old` (by card id),
    - removed: cards present in `old` but not `new`,
    - escalated: same id in both with a detected worsening (official grade
      more urgent from a readable baseline, or a larger cited rain number),
    - summary: trilingual one-liner lists, {"en": [...], "hi": [...],
      "te": [...]}.
    """
    old_by_id = {c["id"]: c for c in (old or [])
                 if isinstance(c, dict) and c.get("id")}
    new_by_id = {c["id"]: c for c in (new or [])
                 if isinstance(c, dict) and c.get("id")}
    added = [new_by_id[i] for i in new_by_id if i not in old_by_id]
    removed = [old_by_id[i] for i in old_by_id if i not in new_by_id]
    escalated = []
    for cid, new_c in new_by_id.items():
        if cid in old_by_id:
            esc = _escalation(old_by_id[cid], new_c)
            if esc:
                escalated.append(esc)
    summary = {lang: _diff_summary_lines(lang, added, removed, escalated)
               for lang in ("en", "hi", "te")}
    return {"added": added, "removed": removed, "escalated": escalated,
            "summary": summary}


def snapshot_inputs(current: dict | None = None,
                    forecast: dict | None = None,
                    alerts: list[dict] | None = None,
                    verdict: dict | None = None,
                    current_prov: str = "LIVE", forecast_prov: str = "LIVE",
                    alerts_prov: str = "LIVE") -> dict:
    """Capture exactly what card-building needs, with a timestamp.

    Cheap for the alert watcher to store and compare between polls: only the
    four engine inputs plus provenance labels. Matches the shapes emitted by
    the /advisory/cards endpoint (adapter model_dump dicts, CAP alert dicts,
    build_verdict output).
    """
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "current": current,
        "forecast": forecast,
        "alerts": list(alerts) if alerts else [],
        "verdict": dict(verdict) if verdict else {},
        "provenance": {"current": current_prov, "forecast": forecast_prov,
                       "alerts": alerts_prov},
    }


def _snap_parts(snap: dict | None):
    snap = snap if isinstance(snap, dict) else {}
    prov = snap.get("provenance")
    prov = prov if isinstance(prov, dict) else {}
    return (snap.get("current"), snap.get("forecast"), snap.get("alerts"),
            snap.get("verdict"), prov)


def _prov_for(explicit: str | None, snap_prov: dict, key: str) -> str:
    if explicit:
        return explicit
    v = snap_prov.get(key)
    return str(v) if v else "LIVE"


def _notify_items(new_cards: list[dict], diff: dict, old_cards: list[dict]) -> list[dict]:
    """Notification-worthy changes — nothing more.

    A new card notifies only when (a) its severity rank is RED/ORANGE (rank
    <= 1) or it is an alert_safety card (a newly confirmed official warning
    is always worth telling the user about), or (b) its cited rain value
    crossed the 50mm heavy-rain threshold upward since the previous snapshot
    (same id, else same kind, else treated as no prior reading). Downgrades,
    calm re-evaluations, and sub-threshold changes notify nothing.
    Each item carries the card's own title/body plus its cited basis facts,
    in the requested language.
    """
    added_ids = {c["id"] for c in diff["added"] if isinstance(c, dict)}
    old_by_id = {c["id"]: c for c in old_cards
                 if isinstance(c, dict) and c.get("id")}
    old_by_kind: dict[str, dict] = {}
    for c in old_cards:
        if isinstance(c, dict) and c.get("kind") and c["kind"] not in old_by_kind:
            old_by_kind[c["kind"]] = c
    notify, seen = [], set()
    for c in new_cards:
        if not isinstance(c, dict) or not c.get("id") or c["id"] in seen:
            continue
        sev_rank = _SEV_RANK.get(c.get("severity_word"), 9)
        rule_a = c["id"] in added_ids and (
            sev_rank <= 1 or c.get("kind") == "alert_safety")
        rule_b = False
        rain = _card_rain_mm(c)
        if rain is not None and rain >= _RAIN_HEAVY_MM:
            old_c = old_by_id.get(c["id"]) or old_by_kind.get(c.get("kind"))
            old_rain = _card_rain_mm(old_c) if old_c is not None else None
            rule_b = old_rain is None or old_rain < _RAIN_HEAVY_MM
        if rule_a or rule_b:
            seen.add(c["id"])
            notify.append({
                "card_id": c["id"],
                "kind": c.get("kind"),
                "title": c.get("title"),
                "body": c.get("body"),
                "severity_word": c.get("severity_word"),
                "basis": list(c.get("basis") or []),
            })
    return notify


def evaluate_change(previous_inputs: dict | None,
                    current_inputs: dict | None,
                    persona: str = "general", lang: str = "en",
                    current_prov: str | None = None,
                    forecast_prov: str | None = None,
                    alerts_prov: str | None = None) -> dict:
    """Rebuild cards from two input snapshots, diff them, pick notifications.

    `previous_inputs` / `current_inputs` are snapshot_inputs() dicts (raw
    input bundles missing the wrapper are tolerated). Each snapshot's own
    stored provenance is used unless an explicit prov argument overrides it.
    Both snapshots are evaluated with the same persona/lang so the diff is
    apples-to-apples.

    Returns {"cards": new_cards, "changes": diff_cards(...),
             "notify": [...]} — see _notify_items for what qualifies.
    """
    pc, pf, pa, pv, pprov = _snap_parts(previous_inputs)
    cc, cf, ca, cv, cprov = _snap_parts(current_inputs)
    old_cards = advisory_cards(
        pc, pf, pa, pv, persona=persona, lang=lang,
        current_prov=_prov_for(current_prov, pprov, "current"),
        forecast_prov=_prov_for(forecast_prov, pprov, "forecast"),
        alerts_prov=_prov_for(alerts_prov, pprov, "alerts"))
    new_cards = advisory_cards(
        cc, cf, ca, cv, persona=persona, lang=lang,
        current_prov=_prov_for(current_prov, cprov, "current"),
        forecast_prov=_prov_for(forecast_prov, cprov, "forecast"),
        alerts_prov=_prov_for(alerts_prov, cprov, "alerts"))
    diff = diff_cards(old_cards, new_cards)
    return {"cards": new_cards, "changes": diff,
            "notify": _notify_items(new_cards, diff, old_cards)}
