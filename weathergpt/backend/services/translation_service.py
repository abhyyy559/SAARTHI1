"""Translation catalogue — presentation layer only. Severity stays machine-readable."""
UI = {
    "current_weather": {"en": "Current Weather", "hi": "वर्तमान मौसम", "te": "ప్రస్తుత వాతావరణం"},
    "active_warning": {"en": "Active Warning", "hi": "सक्रिय चेतावनी", "te": "క్రియాశీల హెచ్చరిక"},
    "source": {"en": "Source", "hi": "स्रोत", "te": "మూలం"},
    "imd": {"en": "India Meteorological Department", "hi": "भारत मौसम विज्ञान विभाग", "te": "భారత వాతావరణ శాఖ"},
    "updated": {"en": "Updated", "hi": "अद्यतन", "te": "నవీకరించబడింది"},
    "forecast": {"en": "Forecast", "hi": "पूर्वानुमान", "te": "అంచనా"},
    "why_this_answer": {"en": "Why this answer?", "hi": "यह उत्तर क्यों?", "te": "ఈ సమాధానం ఎందుకు?"},
    "risk": {"en": "Risk Interpretation", "hi": "जोखिम व्याख्या", "te": "ప్రమాద అంచనా"},
    "official": {"en": "Official warning", "hi": "आधिकारिक चेतावनी", "te": "అధికారిక హెచ్చరిక"},
    "ask": {"en": "Ask WeatherGPT...", "hi": "WeatherGPT से पूछें...", "te": "WeatherGPT ను అడగండి..."},
    "demo_mode": {"en": "DEMO MODE — Simulated IMD-like scenario. Not live official data.", "hi": "डेमो मोड — सिम्युलेटेड डेटा। लाइव डेटा नहीं।", "te": "డెమో మోడ్ — సిమ్యులేటెడ్ డేటా. లైవ్ డేటా కాదు."},
    "limited_connectivity": {"en": "Limited Connectivity", "hi": "सीमित कनेक्टिविटी", "te": "పరిమిత కనెక్టివిటీ"},
}

SEVERITY_LABELS = {
    "GREEN": {"icon": "🟢", "en": "Green Alert", "hi": "हरित चेतावनी", "te": "పచ్చ హెచ్చరిక"},
    "YELLOW": {"icon": "🟡", "en": "Yellow Alert", "hi": "पीली चेतावनी", "te": "పసుపు హెచ్చరిక"},
    "ORANGE": {"icon": "🟠", "en": "Orange Alert", "hi": "नारंगी चेतावनी", "te": "నారింజ హెచ్చరిక"},
    "RED": {"icon": "🔴", "en": "Red Alert", "hi": "लाल चेतावनी", "te": "ఎరుపు హెచ్చరిక"},
}

RISK_LABELS = {
    "LOW": {"en": "Low", "hi": "कम", "te": "తక్కువ"},
    "MODERATE": {"en": "Moderate", "hi": "मध्यम", "te": "మధ్యస్థం"},
    "HIGH": {"en": "High", "hi": "उच्च", "te": "అధికం"},
    "CRITICAL": {"en": "Critical", "hi": "गंभीर", "te": "క్లిష్టమైన"},
}


def translate(key: str, language: str) -> str:
    entry = UI.get(key)
    if not entry:
        return key
    return entry.get(language, entry.get("en", key))


def severity_display(severity: str, language: str) -> dict:
    entry = SEVERITY_LABELS.get(severity.upper(), SEVERITY_LABELS["GREEN"])
    return {"icon": entry["icon"], "label": entry.get(language, entry["en"]), "severity": severity.upper()}


def risk_display(level: str, language: str) -> str:
    return RISK_LABELS.get(level.upper(), {}).get(language, level)