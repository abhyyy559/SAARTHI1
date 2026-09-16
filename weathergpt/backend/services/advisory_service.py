"""Persona-aware, multilingual safety advisory. Grounded: no warning -> no invented advice.

The persona (fisherman/farmer/...) changes *what to do*; the UI language
(en/hi/te) changes *which language* the advice is delivered in. Official
severity is never upgraded and no warning is invented.
"""

_NO_WARN = {
    "general": {
        "en": "No active official warning was found for your area. Keep following regular weather updates.",
        "hi": "आपके क्षेत्र के लिए कोई सक्रिय सरकारी चेतावनी नहीं मिली। नियमित मौसम अपडेट देखते रहें।",
        "te": "మీ ప్రాంతానికి సక్రియ అధికారిక హెచ్చరిక లేదు. సాధారణ వాతావరణ సమాచారం చూస్తూ ఉండండి.",
    },
    "fisherman": {
        "en": "No severe-weather warning for the coast right now. Check again before sailing - seas can change quickly.",
        "hi": "फिलहाल तट के लिए कोई गंभीर मौसम चेतावनी नहीं है। समुद्र में जाने से पहले दोबारा जाँचें - हालात जल्दी बदल सकते हैं।",
        "te": "ప్రస్తుతం తీరానికి తీవ్ర వాతావరణ హెచ్చరిక లేదు. బయలుదేరే ముందు మళ్లీ తనిఖీ చేయండి - పరిస్థితులు వేగంగా మారుతాయి.",
    },
    "farmer": {
        "en": "No active severe-weather warning for your district. Check again before irrigating or spraying.",
        "hi": "आपके जिले के लिए कोई सक्रिय गंभीर मौसम चेतावनी नहीं है। सिंचाई या छिड़काव से पहले दोबारा जाँचें।",
        "te": "మీ జిల్లాకు సక్రియ తీవ్ర వాతావరణ హెచ్చరిక లేదు. నీటిపారుదల లేదా పిచికారీ ముందు మళ్లీ తనిఖీ చేయండి.",
    },
    "driver": {
        "en": "No active severe-weather warning for your route area. Roads can still flood locally - check before long drives.",
        "hi": "आपके मार्ग क्षेत्र के लिए कोई सक्रिय चेतावनी नहीं है। सड़कें स्थानीय रूप से भर सकती हैं - लंबी यात्रा से पहले जाँचें।",
        "te": "మీ మార్గం ప్రాంతానికి సక్రియ హెచ్చరిక లేదు. రోడ్లు నీటిలో మునిగే అవకాశం ఉంది - దూర ప్రయాణానికి ముందు తనిఖీ చేయండి.",
    },
    "researcher": {
        "en": "No active warning in the verified feed. Observed series, model spread and provenance are in the evidence panel.",
        "hi": "सत्यापित फ़ीड में कोई सक्रिय चेतावनी नहीं। अवलोकन श्रृंखला, मॉडल विस्तार और स्रोत साक्ष्य पैनल में हैं।",
        "te": "ధృవీకరించిన ఫీడ్‌లో సక్రియ హెచ్చరిక లేదు. పరిశీలన శ్రేణి, మోడల్ విస్తరణ, మూలాధారాలు సాక్ష్య ప్యానెల్‌లో ఉన్నాయి.",
    },
    "disaster_manager": {
        "en": "No active official warning in the verified feed. Official bulletins take precedence over this output.",
        "hi": "सत्यापित फ़ीड में कोई सक्रिय सरकारी चेतावनी नहीं। सरकारी बुलेटिन इस आउटपुट से बढ़कर हैं।",
        "te": "ధృవీకరించిన ఫీడ్‌లో సక్రియ అధికారిక హెచ్చరిక లేదు. అధికారిక ప్రకటనలు ప్రాధాన్యం పొందుతాయి.",
    },
}

# Warning service unreachable: we may NOT say "no warning". Absence of data
# is not evidence of safety. Honest state, per persona, per language.
_UNREACHABLE = {
    "general": {
        "en": "The official warning service is unreachable right now - we cannot confirm whether a warning is active. Please check IMD or local authorities directly.",
        "hi": "सरकारी चेतावनी सेवा अभी उपलब्ध नहीं है - हम पुष्टि नहीं कर सकते कि चेतावनी सक्रिय है या नहीं। कृपया IMD या स्थानीय प्रशासन से सीधे जाँचें।",
        "te": "అధికారిక హెచ్చరిక సేవ ప్రస్తుతం అందుబాటులో లేదు - హెచ్చరిక ఉందో లేదో ఖరారీ చేయలేము. దయచేసి IMD లేదా స్థానిక అధికారులను నేరుగా సంప్రదించండి.",
    },
    "fisherman": {
        "en": "The official warning service is unreachable right now - we cannot confirm coastal warnings. Check with the harbour or fisheries office before sailing.",
        "hi": "सरकारी चेतावनी सेवा अभी उपलब्ध नहीं है - तट की चेतावनियों की पुष्टि नहीं हो सकती। समुद्र में जाने से पहले हार्बर या मत्स्य कार्यालय से जाँचें।",
        "te": "అధికారిక హెచ్చరిక సేవ ప్రస్తుతం అందుబాటులో లేదు - తీర హెచ్చరికలను ఖరారీ చేయలేము. సముద్రంలోకి వెళ్లే ముందు హార్బర్ లేదా మత్స్య కార్యాలయంతో తనిఖీ చేయండి.",
    },
    "farmer": {
        "en": "The official warning service is unreachable - we cannot confirm warnings for your district. Check local announcements before irrigating or spraying.",
        "hi": "सरकारी चेतावनी सेवा उपलब्ध नहीं - आपके जिले की चेतावनियों की पुष्टि नहीं हो सकती। सिंचाई या छिड़काव से पहले स्थानीय सूचना जाँचें।",
        "te": "హెచ్చరిక సేవ అందుబాటులో లేదు - మీ జిల్లా హెచ్చరికలను ఖరారీ చేయలేము. నీటిపారుదల లేదా పిచికారీ ముందు స్థానిక ప్రకటనలు తనిఖీ చేయండి.",
    },
    "driver": {
        "en": "The official warning service is unreachable - we cannot confirm route warnings. Roads can still flood locally - drive carefully.",
        "hi": "चेतावनी सेवा उपलब्ध नहीं - मार्ग की चेतावनियों की पुष्टि नहीं हो सकती। सड़कें स्थानीय रूप से भर सकती हैं - सावधानी से चलें।",
        "te": "హెచ్చరిక సేవ అందుబాటులో లేదు - మార్గ హెచ్చరికలను ఖరారీ చేయలేము. రోడ్లు నీటిలో మునిగే అవకాశం ఉంది - జాగ్రత్తగా నడపండి.",
    },
    "researcher": {
        "en": "Warning service unreachable - no verified warning status available. See the provenance panel for live source status.",
        "hi": "चेतावनी सेवा उपलब्ध नहीं - सत्यापित चेतावनी स्थिति उपलब्ध नहीं। स्रोत स्थिति साक्ष्य पैनल में देखें।",
        "te": "హెచ్చరిక సేవ అందుబాటులో లేదు - ధృవీకరించిన హెచ్చరిక స్థితి లభించదు. మూలాధార స్థితి సాక్ష్య ప్యానెల్‌లో చూడండి.",
    },
    "disaster_manager": {
        "en": "Warning service unreachable - verification cannot be completed. Rely on official bulletins until service returns.",
        "hi": "चेतावनी सेवा उपलब्ध नहीं - सत्यापन पूर्ण नहीं हो सकता। सेवा बहाल होने तक आधिकारिक बुलेटिन पर भरोसा करें।",
        "te": "హెచ్చరిక సేవ అందుబాటులో లేదు - ధృవీకరణ పూర్తి కాదు. సేవ తిరిగి వచ్చే వరకు అధికారిక ప్రకటనలపై ఆధారపడండి.",
    },
}

_ACTION = {
    "general": {
        "en": "Avoid waterlogged roads and low-lying areas. Follow local authority instructions.",
        "hi": "जलभराव वाली सड़कों और निचले इलाकों से बचें। स्थानीय प्रशासन के निर्देश मानें।",
        "te": "నీరు నిలిచిన రోడ్లకు దూరంగా ఉండండి. స్థానిక అధికారుల సూచనలు పాటించండి.",
    },
    "fisherman": {
        "en": "Do not venture into the sea. Return to shore if already out, and follow marine bulletins.",
        "hi": "समुद्र में न जाएँ। बाहर हों तो तट पर लौटें और मरीन बुलेटिन सुनते रहें।",
        "te": "సముద్రంలోకి వెళ్లవద్దు. బయట ఉంటే తీరానికి తిరిగి రండి, మెరైన్ బులెటిన్లు వింటూ ఉండండి.",
    },
    "farmer": {
        "en": "Secure harvested produce, clear field drainage, and hold spraying or irrigation until it passes.",
        "hi": "फसल और उपज सुरक्षित करें, खेत की जल निकासी खोलें, छिड़काव-सिंचाई अभी रोक दें।",
        "te": "పంటను సురక్షితంగా ఉంచండి, పొలం నీటి పారుదల తెరవండి, పిచికారీ-నీటిపారుదల ఆపివేయండి.",
    },
    "driver": {
        "en": "Avoid flooded and exposed routes. Never drive through standing water.",
        "hi": "जलभराव और खुले रास्तों से बचें। पानी में गाड़ी कभी न चलाएँ।",
        "te": "నీటిలో మునిగిన రోడ్లకు దూరంగా ఉండండి. నీటిలో వాహనం నడపవద్దు.",
    },
    "researcher": {
        "en": "Warning, model spread and provenance details are in the evidence panel for your analysis.",
        "hi": "चेतावनी, मॉडल विस्तार और स्रोत विवरण विश्लेषण हेतु साक्ष्य पैनल में हैं।",
        "te": "హెచ్చరిక, మోడల్ విస్తరణ, మూలాధారాల వివరాలు విశ్లేషణ కోసం సాక్ష్య ప్యానెల్‌లో ఉన్నాయి.",
    },
    "disaster_manager": {
        "en": "Official warnings take precedence. This output is decision support, not an authority directive.",
        "hi": "सरकारी चेतावनियाँ सर्वोपरि हैं। यह निर्णय सहायता है, आधिकारिक आदेश नहीं।",
        "te": "అధికారిక హెచ్చరికలకు ప్రాధాన్యం. ఇది నిర్ణయ సహాయకం మాత్రమే, అధికార ఆదేశం కాదు.",
    },
}

_ACTIVE = {
    "en": "{sev} {haz} warning is active - follow local authority and IMD instructions.",
    "hi": "{sev} {haz} चेतावनी सक्रिय है - स्थानीय प्रशासन और IMD के निर्देश मानें।",
    "te": "{sev} {haz} హెచ్చరిక సక్రియంగా ఉంది - స్థానిక అధికారులు మరియు IMD సూచనలు పాటించండి.",
}


def advisory_for(
    verified: dict,
    user_type: str = "general",
    language: str = "en",
    warning_status: str = "",
) -> str:
    key = user_type if user_type in _NO_WARN else "general"
    lang = language if language in ("en", "hi", "te") else "en"
    # Honesty rule: unreachable service must never be reported as "no warning".
    unreachable = warning_status == "unavailable" or (
        isinstance(verified, dict) and verified.get("warning_service") == "unavailable"
    )
    if unreachable:
        return _UNREACHABLE[key][lang]
    if not (verified and verified.get("verified")):
        return _NO_WARN[key][lang]
    sev = (verified.get("severity") or "GREEN").upper()
    haz = verified.get("hazard") or "Severe weather"
    return f"{_ACTIVE[lang].format(sev=sev, haz=haz)} {_ACTION[key][lang]}"