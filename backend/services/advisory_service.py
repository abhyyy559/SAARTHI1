"""Persona-aware, multilingual safety advisory. Grounded: no warning -> no invented advice.

The persona (fisherman/farmer/...) changes *what to do*; the UI language
(en/hi/te) changes *which language* the advice is delivered in. Official
severity is never upgraded and no warning is invented.
"""

# Must match `verdict_service.UNAVAILABLE` — kept as a literal so this module
# stays dependency-free (it is imported by the chat, advisory and v1 routes).
_UNAVAILABLE = "unavailable"

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
    "aviation": {
        "en": "No active severe-weather warning for your flight area. Check winds and visibility before flying - conditions can change quickly.",
        "hi": "आपके उड़ान क्षेत्र के लिए कोई सक्रिय गंभीर मौसम चेतावनी नहीं है। उड़ान से पहले हवा और दृश्यता जाँचें - हालात जल्दी बदल सकते हैं।",
        "te": "మీ విమాన ప్రాంతానికి సక్రియ తీవ్ర వాతావరణ హెచ్చరిక లేదు. ఎగిరే ముందు గాలి, దృశ్యమానతను తనిఖీ చేయండి - పరిస్థితులు వేగంగా మారవచ్చు.",
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
    "commuter": {
        "en": "No active official warning for your commute area. Check again before you leave - conditions can change quickly.",
        "hi": "आपके आवागमन क्षेत्र के लिए कोई सक्रिय सरकारी चेतावनी नहीं है। निकलने से पहले दोबारा जाँचें - हालात जल्दी बदल सकते हैं।",
        "te": "మీ ప్రయాణ ప్రాంతానికి సక్రియ అధికారిక హెచ్చరిక లేదు. బయలుదేరే ముందు మళ్లీ తనిఖీ చేయండి - పరిస్థితులు వేగంగా మారవచ్చు.",
    },
    "employee": {
        "en": "No active official warning for your work area. Keep following regular weather updates.",
        "hi": "आपके कार्य क्षेत्र के लिए कोई सक्रिय सरकारी चेतावनी नहीं है। नियमित मौसम अपडेट देखते रहें।",
        "te": "మీ పని ప్రాంతానికి సక్రియ అధికారిక హెచ్చరిక లేదు. సాధారణ వాతావరణ సమాచారం చూస్తూ ఉండండి.",
    },
    "outdoor-worker": {
        "en": "No active official warning for your work area. Outdoor work stays weather-sensitive - check again before long shifts outside.",
        "hi": "आपके कार्य क्षेत्र के लिए कोई सक्रिय चेतावनी नहीं है। बाहरी काम मौसम पर निर्भर है - लंबी पारी से पहले दोबारा जाँचें।",
        "te": "మీ పని ప్రాంతానికి సక్రియ హెచ్చరిక లేదు. బయటి పని వాతావరణంపై ఆధారపడుతుంది - ఎక్కువసేపు బయట పనికి ముందు మళ్లీ తనిఖీ చేయండి.",
    },
    "student": {
        "en": "No active official warning for your area. Check here before leaving for school or college in bad weather.",
        "hi": "आपके क्षेत्र के लिए कोई सक्रिय चेतावनी नहीं है। खराब मौसम में स्कूल या कॉलेज जाने से पहले यहाँ जाँचें।",
        "te": "మీ ప్రాంతానికి సక్రియ హెచ్చరిక లేదు. పెరుగుదల వాతావరణంలో పాఠశాల లేదా కళాశాలకు వెళ్లే ముందు ఇక్కడ తనిఖీ చేయండి.",
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
    "aviation": {
        "en": "The official warning service is unreachable - we cannot confirm flight-area warnings. Check winds and visibility with your operator before flying.",
        "hi": "चेतावनी सेवा उपलब्ध नहीं - उड़ान क्षेत्र की चेतावनियों की पुष्टि नहीं हो सकती। उड़ान से पहले अपने ऑपरेटर से हवा और दृश्यता जाँचें।",
        "te": "హెచ్చరిక సేవ అందుబాటులో లేదు - విమాన ప్రాంత హెచ్చరికలను ఖరారీ చేయలేము. ఎగిరే ముందు మీ ఆపరేటర్‌తో గాలి, దృశ్యమానతను తనిఖీ చేయండి.",
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
    "commuter": {
        "en": "The official warning service is unreachable right now - we cannot confirm commute warnings. Allow extra time and check local updates before leaving.",
        "hi": "चेतावनी सेवा अभी उपलब्ध नहीं - आवागमन चेतावनियों की पुष्टि नहीं हो सकती। निकलने से पहले अतिरिक्त समय रखें और स्थानीय अपडेट जाँचें।",
        "te": "హెచ్చరిక సేవ ప్రస్తుతం అందుబాటులో లేదు - ప్రయాణ హెచ్చరికలను ఖరారీ చేయలేము. బయలుదేరే ముందు అదనపు సమయం ఉంచుకుని స్థానిక సమాచారం తనిఖీ చేయండి.",
    },
    "employee": {
        "en": "The official warning service is unreachable right now - we cannot confirm whether a warning is active. Please check IMD or local authorities directly.",
        "hi": "सरकारी चेतावनी सेवा अभी उपलब्ध नहीं है - चेतावनी सक्रिय है या नहीं, पुष्टि नहीं हो सकती। कृपया IMD या स्थानीय प्रशासन से सीधे जाँचें।",
        "te": "అధికారిక హెచ్చరిక సేవ ప్రస్తుతం అందుబాటులో లేదు - హెచ్చరిక ఉందో లేదో ఖరారీ చేయలేము. దయచేసి IMD లేదా స్థానిక అధికారులను నేరుగా సంప్రదించండి.",
    },
    "outdoor-worker": {
        "en": "The official warning service is unreachable - we cannot confirm warnings for outdoor work. Postpone exposed work until you can verify conditions.",
        "hi": "चेतावनी सेवा उपलब्ध नहीं - बाहरी काम की चेतावनियों की पुष्टि नहीं हो सकती। हालात सत्यापित होने तक खुले में काम टालें।",
        "te": "హెచ్చరిక సేవ అందుబాటులో లేదు - బయటి పని హెచ్చరికలను ఖరారీ చేయలేము. పరిస్థితులు తెలిసే వరకు బహిరంగ పనిని వాయిదా వేయండి.",
    },
    "student": {
        "en": "The official warning service is unreachable - we cannot confirm warnings for your area. Check with your school or parents before travelling.",
        "hi": "चेतावनी सेवा उपलब्ध नहीं - आपके क्षेत्र की चेतावनियों की पुष्टि नहीं हो सकती। यात्रा से पहले स्कूल या अभिभावकों से जाँचें।",
        "te": "హెచ్చరిక సేవ అందుబాటులో లేదు - మీ ప్రాంత హెచ్చరికలను ఖరారీ చేయలేము. ప్రయాణించే ముందు పాఠశాల లేదా తల్లిదండ్రులతో తనిఖీ చేయండి.",
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
    "student": {
        "en": "Follow your school's weather instructions; avoid flooded routes on the way and wait for official clearance for outdoor activities.",
        "hi": "स्कूल के मौसम निर्देश मानें; रास्ते में जलभराव वाले रास्तों से बचें और बाहरी गतिविधियों के लिए आधिकारिक अनुमति का इंतज़ार करें।",
        "te": "పాఠశాల వాతావరణ సూచనలు పాటించండి; దారిలో నీరు నిలిచిన రోడ్లకు దూరంగా ఉండండి, బహిరంగ కార్యకలాపాలకు అధికారిక అనుమతి కోసం వేచి ఉండండి.",
    },
    "commuter": {
        "en": "Delay non-essential travel during the peak warning period; if you must travel, avoid low-lying and waterlogged routes.",
        "hi": "चेतावनी के चरम समय में ज़रूरी नहीं यात्रा टालें; यात्रा करनी ही हो तो निचले और जलभराव वाले रास्तों से बचें।",
        "te": "హెచ్చరిక గరిష్ఠ సమయంలో అవసరం లేని ప్రయాణాన్ని వాయిదా వేయండి; ప్రయాణించాల్సి వస్తే తక్కువ ప్రాంతాలు, నీరు నిలిచిన రోడ్లకు దూరంగా ఉండండి.",
    },
    "employee": {
        "en": "Consider remote work or delayed start during the warning; avoid non-essential travel and follow workplace safety advisories.",
        "hi": "चेतावनी के दौरान घर से काम या देर से शुरुआत करें; ज़रूरी नहीं यात्रा से बचें और कार्यस्थल सुरक्षा सलाह मानें।",
        "te": "హెచ్చరిక సమయంలో ఇంటి నుండి పని లేదా ఆలస్య ప్రారంభాన్ని పరిగణించండి; అవసరం లేని ప్రయాణం మానేయండి, కార్యాలయ భద్రతా సలహా పాటించండి.",
    },
    "outdoor-worker": {
        "en": "Stop exposed work during lightning or peak conditions; move to shelter until the official warning period ends.",
        "hi": "बिजली गिरने या चरम स्थिति में खुले में काम रोकें; आधिकारिक चेतावनी अवधि समाप्त होने तक आश्रय में रहें।",
        "te": "మెరుపులు లేదా తీవ్ర పరిస్థితుల్లో బహిరంగ పని ఆపండి; అధికారిక హెచ్చరిక కాలం ముగిసే వరకు ఆశ్రయంలో ఉండండి.",
    },
    "driver": {
        "en": "Avoid flooded and exposed routes. Never drive through standing water.",
        "hi": "जलभराव और खुले रास्तों से बचें। पानी में गाड़ी कभी न चलाएँ।",
        "te": "నీటిలో మునిగిన రోడ్లకు దూరంగా ఉండండి. నీటిలో వాహనం నడపవద్దు.",
    },
    "aviation": {
        "en": "Check winds aloft and visibility before any flight. This is planning guidance only - not an official METAR/TAF briefing.",
        "hi": "किसी भी उड़ान से पहले ऊपरी हवा और दृश्यता जाँचें। यह केवल योजना सहायता है - आधिकारिक METAR/TAF ब्रीफिंग नहीं।",
        "te": "ఏ విమానానికైనా ముందు పై గాలి, దృశ్యమానతను తనిఖీ చేయండి. ఇది ప్రణాళిక సహాయం మాత్రమే - అధికారిక METAR/TAF బ్రీఫింగ్ కాదు.",
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

# Mandatory caveat for occupational personas: guidance is general, never a
# crop/vessel/route-specific recommendation. General has no caveat.
_CAVEAT = {
    "farmer": {
        "en": "This is general guidance, not a crop-specific recommendation.",
        "hi": "यह सामान्य सलाह है, फसल-विशिष्ट सिफारिश नहीं।",
        "te": "ఇది సాధారణ సూచన మాత్రమే, పంట-నిర్దిష్ట సిఫార్సు కాదు.",
    },
    "fisherman": {
        "en": "This is general guidance, not a vessel-specific recommendation.",
        "hi": "यह सामान्य सलाह है, नाव-विशिष्ट सिफारिश नहीं।",
        "te": "ఇది సాధారణ సూచన మాత్రమే, పడవ-నిర్దిష్ట సిఫార్సు కాదు.",
    },
    "driver": {
        "en": "This is general guidance, not a route-specific recommendation.",
        "hi": "यह सामान्य सलाह है, मार्ग-विशिष्ट सिफारिश नहीं।",
        "te": "ఇది సాధారణ సూచన మాత్రమే, మార్గ-నిర్దిష్ట సిఫార్సు కాదు.",
    },
    "aviation": {
        "en": "This is general guidance, not a flight-specific briefing. Always use official METAR/TAF and ATC instructions.",
        "hi": "यह सामान्य सलाह है, उड़ान-विशिष्ट ब्रीफिंग नहीं। हमेशा आधिकारिक METAR/TAF और ATC निर्देशों का पालन करें।",
        "te": "ఇది సాధారణ సూచన మాత్రమే, విమాన-నిర్దిష్ట బ్రీఫింగ్ కాదు. ఎల్లప్పుడూ అధికారిక METAR/TAF, ATC సూచనలు పాటించండి.",
    },
}

# A sea-going occupation in a landlocked district. Telling a fisherman in
# Hyderabad to "return to shore" is not caution, it is noise that trains people
# to ignore the advice — so say the true thing first, then give guidance that
# actually applies. Only used when we KNOW the district is inland; an unknown
# district (coastal=None) gets the normal wording rather than a guess.
_INLAND_LEAD = {
    "en": "{district} is not a coastal district, so sea and marine warnings do not apply here.",
    "hi": "{district} एक तटीय जिला नहीं है, इसलिए समुद्री चेतावनियाँ यहाँ लागू नहीं होतीं।",
    "te": "{district} తీర ప్రాంత జిల్లా కాదు, కాబట్టి సముద్ర హెచ్చరికలు ఇక్కడ వర్తించవు.",
}

# The fisherman action, rewritten for someone who fishes inland tanks,
# reservoirs or rivers rather than the sea.
_ACTION_INLAND_FISHERMAN = {
    "en": "If you fish in tanks, reservoirs or rivers, stay off the water during lightning and strong winds.",
    "hi": "यदि आप तालाब, जलाशय या नदी में मछली पकड़ते हैं, तो बिजली और तेज़ हवा के दौरान पानी से दूर रहें।",
    "te": "మీరు చెరువులు, జలాశయాలు లేదా నదుల్లో చేపలు పడితే, పిడుగులు మరియు గాలుల సమయంలో నీటికి దూరంగా ఉండండి.",
}


# The feed answered, but every alert it had for this district has closed its
# validity window. That is NOT "the service is unreachable" — saying so would be
# a false statement about the world, and it sends the reader to the wrong fix.
# We have official information; it is simply too old to act on.
_STALE_CAP = {
    "en": "The official alerts for your area have expired, so what is in force now cannot be confirmed. Check IMD or local authorities before you travel or go to sea.",
    "hi": "आपके क्षेत्र की सरकारी चेतावनियाँ समाप्त हो चुकी हैं, इसलिए अभी क्या लागू है यह पुष्टि नहीं हो सकती। यात्रा या समुद्र में जाने से पहले IMD या स्थानीय प्रशासन से जाँचें।",
    "te": "మీ ప్రాంతానికి సంబంధించిన అధికారిక హెచ్చరికలు గడువు ముగిసాయి, కాబట్టి ఇప్పుడు ఏది అమలులో ఉందో ఖరారీ చేయలేము. ప్రయాణించే లేదా సముద్రంలోకి వెళ్లే ముందు IMD లేదా స్థానిక అధికారులను సంప్రదించండి.",
}

# A warning we SAW for this district but could not confirm (stale, outside its
# window, incomplete, or from an untrusted source). The verdict calls that
# UNKNOWN — not confirmed — so the advisory must not announce it as an active
# warning: that put two answers to one question on the same screen, and with the
# failed alert's severity missing it rendered "GREEN Severe weather warning is
# active". Deliberately one wording for every persona: the fact is about the
# warning's status, not about the occupation.
_UNVERIFIED = {
    "en": "A weather warning was reported for your area but could not be confirmed, so treat conditions as unverified. Check IMD or local authorities before you travel or work outside.",
    "hi": "आपके क्षेत्र के लिए एक मौसम चेतावनी मिली थी, पर उसकी पुष्टि नहीं हो सकी, इसलिए हालात को असत्यापित मानें। यात्रा या बाहर काम करने से पहले IMD या स्थानीय प्रशासन से जाँचें।",
    "te": "మీ ప్రాంతానికి ఒక వాతావరణ హెచ్చరిక నమోదైంది, కానీ దాన్ని ధృవీకరించలేకపోయాం, కాబట్టి పరిస్థితులను ధృవీకరించనివిగా పరిగణించండి. ప్రయాణించే లేదా బయట పని చేసే ముందు IMD లేదా స్థానిక అధికారులను సంప్రదించండి.",
}


def _lang_of(language: str) -> str:
    return language if language in ("en", "hi", "te") else "en"


# ---------------------------------------------------------------------------
# Weather-grounded rule layer (Round2 T2.1 S2.1.1).
#
# Conservative thresholds on OBSERVED/FORECAST numbers only — never on the
# official warning state. This layer APPENDS to advisory_for() output; it can
# never soften or replace the floor (see advisory_for honesty rules above).
# Official alerts are pre-authorized (NDMA-SACHET CAP / IMD auto-ingest).
# ---------------------------------------------------------------------------
_RAIN_HEAVY_MM = 50.0
_RAIN_MOD_MM = 20.0
_WIND_GALE_KPH = 60.0
_HEAT_C = 42.0
_COLD_C = 5.0
# Heat-stress rule (humidity was named explicitly for the Advisory section):
# fires only when BOTH heat and humidity are high together. Conservative on
# purpose — below 35°C a humid day is a comfort issue, not a health risk worth
# an advisory line, and the 42°C heatwave rule already covers dry extreme heat.
_HEATSTRESS_TEMP_C = 35.0
_HEATSTRESS_HUMIDITY_PCT = 60.0

# Current-observation key aliases across IMD demo fixtures / Open-Meteo live.
# "rainfall"/"rain" are the model_dump keys the adapters actually emit (same
# extension advisory_cards_service documents); without them a fetched IMD
# observation's rainfall never reaches the rules.
_RAIN_KEYS = ("rain_mm", "precip_mm", "precipitation_mm", "rainfall_mm", "precip",
              "rainfall", "rain")
_WIND_KEYS = ("wind_kph", "wind_speed_kph", "windspeed_kph", "wind_ms", "wind_speed")
_TEMP_KEYS = ("temp_c", "temperature_c", "temperature", "temp")
_HUMIDITY_KEYS = ("humidity", "humidity_pct", "relative_humidity",
                  "relative_humidity_2m", "rh")


def _first_num(blob: dict | None, keys: tuple) -> float | None:
    """First numeric value found under any alias key, else None."""
    if not isinstance(blob, dict):
        return None
    for k in keys:
        v = blob.get(k)
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float)):
            return float(v)
    return None


def _observed_weather(current: dict | None, forecast: dict | None) -> dict:
    """Worst-case observed/forecast numbers. Forecast days widen coverage;
    current observation wins ties (measured beats modelled)."""
    rain = _first_num(current, _RAIN_KEYS)
    wind = _first_num(current, _WIND_KEYS)
    temp = _first_num(current, _TEMP_KEYS)
    humidity = _first_num(current, _HUMIDITY_KEYS)
    temp_hi, temp_lo = temp, temp
    days = (forecast or {}).get("days") if isinstance(forecast, dict) else None
    if isinstance(days, list):
        for d in days:
            if not isinstance(d, dict):
                continue
            r, w, t = (_first_num(d, _RAIN_KEYS), _first_num(d, _WIND_KEYS),
                       _first_num(d, _TEMP_KEYS))
            # ms -> kph alias: values < 40 under wind_ms are m/s, convert.
            if "wind_ms" in d and isinstance(d.get("wind_ms"), (int, float)) and w is not None and w < 40:
                w = float(w) * 3.6
            if r is not None and (rain is None or r > rain):
                rain = r
            if w is not None and (wind is None or w > wind):
                wind = w
            if t is not None:
                # Heat is a forecast-window MAXIMUM and cold a forecast-window
                # MINIMUM, so BOTH extremes are tracked. The previous
                # `temp = t if temp is None else temp` kept only the first day it
                # saw: a 44C day three days out, or a 2C night two days out,
                # never fired its rule.
                temp_hi = t if temp_hi is None else max(temp_hi, t)
                temp_lo = t if temp_lo is None else min(temp_lo, t)
    # wind_ms alias on the current blob itself.
    if wind is not None and isinstance((current or {}).get("wind_ms"), (int, float)) \
            and "wind_kph" not in (current or {}) and wind < 40:
        wind = wind * 3.6
    # Report the extreme that actually crosses a threshold, so the cited number
    # is the one that fired the rule; with neither crossing, the measured/first
    # value stands.
    temp_out = temp
    if temp_hi is not None and temp_hi >= _HEAT_C:
        temp_out = temp_hi
    elif temp_lo is not None and temp_lo <= _COLD_C:
        temp_out = temp_lo
    return {"rain_mm": rain, "wind_kph": wind, "temp_c": temp_out,
            "humidity_pct": humidity, "temp_hi": temp_hi}


_RULE_TEXT = {
    # Every string in EN/HI/TE. {v} is the cited observed/forecast number.
    "heavy_rain": {
        "en": "Heavy rain observed/forecast ({v}mm) — avoid waterlogged roads and low-lying areas; postpone non-essential travel.",
        "hi": "भारी वर्षा देखी/पूर्वानुमानित ({v} मिमी) — जलभराव वाली सड़कों और निचले इलाकों से बचें; गैर-ज़रूरी यात्रा टालें।",
        "te": "భారీ వర్షం నమోదు/అంచనా ({v}మిమీ) — నీరు నిలిచిన రోడ్లు, తక్కువ ప్రాంతాలకు దూరంగా ఉండండి; అత్యవసరం కాని ప్రయాణాన్ని వాయిదా వేయండి.",
    },
    "moderate_rain": {
        "en": "Moderate rain observed/forecast ({v}mm) — allow extra travel time and avoid flood-prone stretches.",
        "hi": "मध्यम वर्षा देखी/पूर्वानुमानित ({v} मिमी) — यात्रा में अतिरिक्त समय रखें, बाढ़-प्रवण रास्तों से बचें।",
        "te": "మధ్యస్థ వర్షం నమోదు/అంచనా ({v}మిమీ) — ప్రయాణానికి అదనపు సమయం ఉంచుకోండి, వరద ముంపు రోడ్లకు దూరంగా ఉండండి.",
    },
    "gale": {
        "en": "Strong winds observed/forecast ({v} kph) — stay clear of hoardings, trees and exposed structures; fishers should stay off the water.",
        "hi": "तेज़ हवाएँ देखी/पूर्वानुमानित ({v} किमी/घंटा) — होर्डिंग, पेड़ों और खुली संरचनाओं से दूर रहें; मछुआरे पानी से दूर रहें।",
        "te": "బలమైన గాలులు నమోదు/అంచనా ({v} కిమీ/గం) — హోర్డింగులు, చెట్లు, బహిరంగ నిర్మాణాలకు దూరంగా ఉండండి; మత్స్యకారులు నీటికి దూరంగా ఉండండి.",
    },
    "heatwave": {
        "en": "Extreme heat observed/forecast ({v}°C) — stay hydrated, avoid midday outdoor work, check on the elderly and children.",
        "hi": "अत्यधिक गर्मी देखी/पूर्वानुमानित ({v}°C) — पानी पिएँ, दोपहर में बाहरी काम से बचें, बुज़ुर्गों और बच्चों का ध्यान रखें।",
        "te": "తీవ్ర వేడి నమోదు/అంచనా ({v}°C) — నీరు తాగండి, మధ్యాహ్నం బయటి పనిని నివారించండి, వృద్ధులు, పిల్లలను జాగ్రత్తగా చూసుకోండి.",
    },
    # {t} is the peak temperature, {h} the observed humidity — both are cited
    # because the rule only fires on their combination.
    "heat_stress": {
        "en": "Hot and humid conditions ({t}°C, {h}% humidity) — heat stress builds fast; drink water often, rest in shade, and avoid heavy exertion outdoors.",
        "hi": "गर्म और आर्द्र परिस्थितियाँ ({t}°C, {h}% आर्द्रता) — हीट स्ट्रेस तेज़ी से बढ़ता है; बार-बार पानी पिएँ, छाँव में आराम करें, और बाहर भारी श्रम से बचें।",
        "te": "వేడి మరియు తేమతో కూడిన పరిస్థితులు ({t}°C, {h}% తేమ) — హీట్ స్ట్రెస్ వేగంగా పెరుగుతుంది; తరచూ నీరు తాగండి, నీడలో విశ్రాంతి తీసుకోండి, బయట భారీ శ్రమను నివారించండి.",
    },
    "cold": {
        "en": "Cold conditions observed/forecast ({v}°C) — dress warmly and allow extra time for morning travel; protect crops/livestock from frost.",
        "hi": "ठंड देखी/पूर्वानुमानित ({v}°C) — गर्म कपड़े पहनें, सुबह की यात्रा में अतिरिक्त समय रखें; फसल/पशुओं को पाले से बचाएँ।",
        "te": "చలి నమోదు/అంచనా ({v}°C) — వెచ్చని దుస్తులు ధరించండి, ఉదయం ప్రయాణానికి అదనపు సమయం ఉంచుకోండి; పంట/పశువులను మంచు నుండి కాపాడండి.",
    },
}

# Evaluation order: most dangerous first so the [:3] cap keeps severity order.
_RULE_ORDER = ("heavy_rain", "gale", "heatwave", "heat_stress", "cold", "moderate_rain")


def weather_advisories(
    current: dict | None,
    forecast: dict | None,
    persona: str = "general",
    language: str = "en",
) -> list[dict]:
    """Rule-layer advisories grounded in observed/forecast numbers.

    Thresholds: rain_mm >= 50 heavy / >= 20 moderate, wind_kph >= 60 gale,
    temp_c >= 42 heatwave / <= 5 cold, and the heat-stress combination
    temp >= 35 with humidity >= 60% (conservative: humid-but-not-hot days and
    dry extreme heat are covered by the other rules). Each item cites its fact
    (``fact``) and carries EN/HI/TE text. At most 3 items, severity order.

    Never softens advisory_for(): callers APPEND these lines after the floor.
    Empty inputs (None) yield [] — never an invented warning.
    """
    lang = _lang_of(language)
    _persona = persona if persona in _NO_WARN else "general"  # validated; wording is persona-neutral
    obs = _observed_weather(current, forecast)
    fired: dict[str, dict] = {}
    if obs["rain_mm"] is not None and obs["rain_mm"] >= _RAIN_HEAVY_MM:
        fired["heavy_rain"] = {"kind": "heavy_rain", "fact": f"rain {obs['rain_mm']:g}mm"}
    elif obs["rain_mm"] is not None and obs["rain_mm"] >= _RAIN_MOD_MM:
        fired["moderate_rain"] = {"kind": "moderate_rain", "fact": f"rain {obs['rain_mm']:g}mm"}
    if obs["wind_kph"] is not None and obs["wind_kph"] >= _WIND_GALE_KPH:
        fired["gale"] = {"kind": "gale", "fact": f"wind {obs['wind_kph']:g}kph"}
    if obs["temp_c"] is not None and obs["temp_c"] >= _HEAT_C:
        fired["heatwave"] = {"kind": "heatwave", "fact": f"temp {obs['temp_c']:g}C"}
    elif obs["temp_c"] is not None and obs["temp_c"] <= _COLD_C:
        fired["cold"] = {"kind": "cold", "fact": f"temp {obs['temp_c']:g}C"}
    if (obs["humidity_pct"] is not None and obs["temp_hi"] is not None
            and obs["temp_hi"] >= _HEATSTRESS_TEMP_C
            and obs["humidity_pct"] >= _HEATSTRESS_HUMIDITY_PCT):
        fired["heat_stress"] = {
            "kind": "heat_stress",
            "fact": f"temp {obs['temp_hi']:g}C, humidity {obs['humidity_pct']:g}%",
        }
    items: list[dict] = []
    for kind in _RULE_ORDER:
        if kind in fired:
            if kind == "heat_stress":
                # Two cited facts: the peak temperature and the humidity.
                text = {L: _RULE_TEXT[kind][L].format(t=f"{obs['temp_hi']:g}",
                                                     h=f"{obs['humidity_pct']:g}")
                        for L in ("en", "hi", "te")}
            else:
                v = {"rain_mm": obs["rain_mm"], "wind_kph": obs["wind_kph"],
                     "temp_c": obs["temp_c"]}
                num = (v["rain_mm"] if "rain" in kind else v["wind_kph"] if kind == "gale"
                       else v["temp_c"])
                text = {L: _RULE_TEXT[kind][L].format(v=f"{num:g}")
                        for L in ("en", "hi", "te")}
            items.append({
                "kind": kind,
                "fact": fired[kind]["fact"],
                "persona": _persona,
                "text": text,
            })
    _ = lang  # per-language selection happens in weather_advisories_text
    return items[:3]


def weather_advisories_text(items: list | None, language: str = "en") -> str:
    """Render rule items as appended lines. "" when empty — floor untouched."""
    if not items:
        return ""
    lang = _lang_of(language)
    return "".join("\n- " + str(it.get("text", {}).get(lang) or it.get("text", {}).get("en", ""))
                   for it in items if isinstance(it, dict))


def observation_numbers(obs: dict | None) -> dict:
    """Honest observed numbers from a fetched observation blob.

    Same alias tables and wind_ms->kph convention as the rules engine;
    returns rain_mm / wind_kph / temp_c / humidity_pct, None where unknown —
    never invented. Used to build the advisory's "based on" basis block from
    a server-side current-observation fetch.
    """
    o = _observed_weather(obs, None)
    return {k: o[k] for k in ("rain_mm", "wind_kph", "temp_c", "humidity_pct")}


def _inland(key: str, coastal: bool | None, district: str, lang: str) -> str:
    """Lead sentence when a sea-going occupation is used from an inland district.

    Empty string in every other case, so this can be prefixed unconditionally.
    """
    if key != "fisherman" or coastal is not False:
        return ""
    return _INLAND_LEAD[lang].format(district=district or "Your district") + " "


def caveat_for(user_type: str = "general", language: str = "en") -> str:
    """Mandatory occupational caveat, or "" for general personas."""
    return (_CAVEAT.get(user_type) or {}).get(_lang_of(language), "")


def advisory_for(
    verified: dict,
    user_type: str = "general",
    language: str = "en",
    warning_status: str = "",
    verdict: dict | None = None,
    coastal: bool | None = None,
    district: str = "",
) -> str:
    """Persona/language advisory. `verified` is the validated IMD warning dict.

    Pass `verdict` (from `verdict_service.build_verdict`) whenever the caller has
    one: it is the single source of truth for severity, so the advice can never
    contradict the risk badge or the Alerts page. `warning_status` remains for
    callers that only have the warning dict (`api/v1.py`).

    `coastal` is the resolved location's coastal flag. When it is explicitly
    `False` and the persona needs the sea, the advice says so plainly and swaps
    in land-appropriate guidance. `None` means we do not know, and then the
    normal wording is used — an unknown district must not be called inland.
    """
    key = user_type if user_type in _NO_WARN else "general"
    lang = _lang_of(language)
    lead = _inland(key, coastal, district, lang)
    inland = key == "fisherman" and coastal is False
    action = _ACTION_INLAND_FISHERMAN[lang] if inland else _ACTION[key][lang]

    if isinstance(verdict, dict) and verdict:
        confirmed = bool(verdict.get("confirmed"))
        basis = str(verdict.get("basis") or "")
        level = str(verdict.get("level") or "").upper()
        # Honesty rule 1: "we could not check" is never "no warning".
        if not confirmed and basis == _UNAVAILABLE:
            # ...but "the service is unreachable" and "the alerts we have are too
            # old to act on" are different facts with different fixes, so they get
            # different sentences.
            if verdict.get("stale_cap"):
                return lead + _STALE_CAP[lang]
            return lead + _UNREACHABLE[key][lang]
        # A warning we saw but could NOT confirm (UNKNOWN / unverified_warning).
        # Announcing it as active here would contradict the verdict the rest of
        # the screen renders — and `sev` below falls back to "GREEN", so it would
        # also read "GREEN Severe weather warning is active".
        if not confirmed:
            return lead + _UNVERIFIED[lang]
        # Honesty rule 2: only a confirmed, LOW verdict is an all-clear.
        if confirmed and level == "LOW":
            return lead + _NO_WARN[key][lang]
        # Anything else is an official hazard we must not render as calm.
        src = verified if isinstance(verified, dict) else {}
        sev = str(verdict.get("severity") or src.get("severity") or "GREEN").upper()
        haz = verdict.get("hazard") or src.get("hazard") or "Severe weather"
        return f"{lead}{_ACTIVE[lang].format(sev=sev, haz=haz)} {action}"

    # Legacy path: unreachable service must never be reported as "no warning".
    src = verified if isinstance(verified, dict) else {}
    unreachable = warning_status == _UNAVAILABLE or src.get("warning_service") == _UNAVAILABLE
    if unreachable:
        return lead + _UNREACHABLE[key][lang]
    if not src.get("verified"):
        return lead + _NO_WARN[key][lang]
    sev = (src.get("severity") or "GREEN").upper()
    haz = src.get("hazard") or "Severe weather"
    return f"{lead}{_ACTIVE[lang].format(sev=sev, haz=haz)} {action}"