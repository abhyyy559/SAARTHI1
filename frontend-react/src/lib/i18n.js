// Short labels only: icons, colour and voice carry the meaning; text is a
// helper for those who read. Every key exists in all three languages
// (tests/i18n.test.mjs enforces it).
export const LANGS = [
  { id: 'en', glyph: 'A', name: 'English' },
  { id: 'hi', glyph: 'अ', name: 'हिन्दी' },
  { id: 'te', glyph: 'అ', name: 'తెలుగు' },
];

export const STR = {
  en: {
    appName: 'WeatherGPT',
    tabToday: 'Today', tabAsk: 'Ask', tabAlerts: 'Alerts', tabShare: 'Share',
    lvCRITICAL: 'Danger — red alert',
    lvHIGH: 'Be very careful — orange alert',
    lvMODERATE: 'Be careful — yellow alert',
    lvLOW: 'No official alert for your district',
    lvUNKNOWN: 'Could not check alerts',
    lvUNKNOWNsub: 'Ask local officials before you go out.',
    checked: 'Checked', notConnected: 'not connected',
    now: 'Now', rain: 'Rain', wind: 'Wind', humidity: 'Humidity',
    today: 'Today', tomorrow: 'Tomorrow', nextDays: 'Next days',
    forYou: 'For you',
    roleGeneral: 'Everyone', roleFarmer: 'Farmer', roleFisherman: 'Fisher', roleDriver: 'Driver',
    listen: 'Listen', stop: 'Stop',
    live: 'Live', saved: 'Saved', justNow: 'just now', minAgo: '{n} min ago', hrAgo: '{n} hr ago', dayAgo: '{n} days ago',
    offline: 'No internet — showing saved info',
    nothingSaved: 'Nothing saved yet. Connect to the internet once.',
    notAvailable: 'Not available right now',
    retry: 'Try again', loading: 'Loading…',
    askHint: 'Tap the mic and speak', typeHere: 'Or type your question', send: 'Send',
    listening: 'Listening… tap to stop', working: 'Understanding…',
    micDenied: 'Allow the microphone to speak', micFailed: 'Didn\'t catch that. Try again.',
    micNone: 'Voice is not available on this phone',
    qRain: 'Will it rain tomorrow?', qWarn: 'Is there any warning today?',
    qSea: 'Can fishermen go to sea today?', qHeat: 'How hot will it be today?',
    qCrop: 'Is today good for spraying crops?', qRoad: 'Will roads be wet today?',
    queued: 'No internet. I will ask when it is back.',
    offlineAnswer: 'No internet. Last saved information:',
    aiNote: 'AI explains official data. It never makes up warnings.',
    yourDistrict: 'Your district', elsewhere: 'Elsewhere in your state',
    alertsNone: 'No active official alerts in your state right now',
    until: 'Until {t}', source: 'Source', explain: 'Explain',
    explainQ: 'Explain this official alert simply: {h}',
    shareTitle: 'Show this code to share',
    shareHint: 'Anyone can scan it with a phone camera. No app needed.',
    shareSend: 'Send', shareSave: 'Save picture',
    shareLocal: 'Test link: works only on this Wi-Fi. Set VITE_PUBLIC_URL for a public link.',
    shareEmpty: 'Open Today once with internet to make a code.',
    sharedBy: 'Shared by a WeatherGPT user',
    sharedAt: 'Information from {t}. It may have changed.',
    liveNow: 'Latest information now', openApp: 'Open WeatherGPT',
    badLink: 'This code could not be read.',
    language: 'Language', place: 'Place', role: 'Who are you?',
    findMe: 'Find my place', searchPlace: 'Search district', locating: 'Finding you…',
    locDenied: 'Location is off. Pick your district.',
    adviceNote: 'General guidance, not an official order',
    sources: 'Sources', official: 'Official', forecastBy: 'Forecast',
    done: 'Done', settings: 'Settings',
  },
  hi: {
    appName: 'WeatherGPT',
    tabToday: 'आज', tabAsk: 'पूछें', tabAlerts: 'चेतावनी', tabShare: 'साझा करें',
    lvCRITICAL: 'खतरा — रेड अलर्ट',
    lvHIGH: 'बहुत सावधान रहें — ऑरेंज अलर्ट',
    lvMODERATE: 'सावधान रहें — येलो अलर्ट',
    lvLOW: 'आपके ज़िले के लिए कोई सरकारी चेतावनी नहीं',
    lvUNKNOWN: 'चेतावनी की जाँच नहीं हो सकी',
    lvUNKNOWNsub: 'बाहर जाने से पहले स्थानीय अधिकारियों से पूछें।',
    checked: 'जाँचा', notConnected: 'जुड़ा नहीं',
    now: 'अभी', rain: 'बारिश', wind: 'हवा', humidity: 'नमी',
    today: 'आज', tomorrow: 'कल', nextDays: 'आने वाले दिन',
    forYou: 'आपके लिए',
    roleGeneral: 'सभी', roleFarmer: 'किसान', roleFisherman: 'मछुआरा', roleDriver: 'ड्राइवर',
    listen: 'सुनें', stop: 'रोकें',
    live: 'लाइव', saved: 'सहेजा', justNow: 'अभी', minAgo: '{n} मिनट पहले', hrAgo: '{n} घंटे पहले', dayAgo: '{n} दिन पहले',
    offline: 'इंटरनेट नहीं — सहेजी जानकारी दिखा रहे हैं',
    nothingSaved: 'अभी कुछ सहेजा नहीं। एक बार इंटरनेट से जुड़ें।',
    notAvailable: 'अभी उपलब्ध नहीं',
    retry: 'फिर कोशिश करें', loading: 'लोड हो रहा है…',
    askHint: 'माइक दबाएँ और बोलें', typeHere: 'या अपना सवाल लिखें', send: 'भेजें',
    listening: 'सुन रहे हैं… रोकने के लिए दबाएँ', working: 'समझ रहे हैं…',
    micDenied: 'बोलने के लिए माइक की अनुमति दें', micFailed: 'समझ नहीं आया। फिर से बोलें।',
    micNone: 'इस फ़ोन पर आवाज़ उपलब्ध नहीं',
    qRain: 'क्या कल बारिश होगी?', qWarn: 'क्या आज कोई चेतावनी है?',
    qSea: 'क्या आज मछुआरे समुद्र में जा सकते हैं?', qHeat: 'आज कितनी गर्मी होगी?',
    qCrop: 'क्या आज फसल पर छिड़काव ठीक है?', qRoad: 'क्या आज सड़कें गीली होंगी?',
    queued: 'इंटरनेट नहीं। इंटरनेट आने पर पूछेंगे।',
    offlineAnswer: 'इंटरनेट नहीं। आख़िरी सहेजी जानकारी:',
    aiNote: 'AI सिर्फ़ सरकारी जानकारी समझाता है, चेतावनी नहीं बनाता।',
    yourDistrict: 'आपका ज़िला', elsewhere: 'आपके राज्य में अन्य जगह',
    alertsNone: 'अभी आपके राज्य में कोई सक्रिय सरकारी चेतावनी नहीं',
    until: '{t} तक', source: 'स्रोत', explain: 'समझाएँ',
    explainQ: 'इस सरकारी चेतावनी को आसान भाषा में समझाएँ: {h}',
    shareTitle: 'साझा करने के लिए यह कोड दिखाएँ',
    shareHint: 'कोई भी फ़ोन कैमरे से स्कैन कर सकता है। ऐप की ज़रूरत नहीं।',
    shareSend: 'भेजें', shareSave: 'तस्वीर सहेजें',
    shareLocal: 'टेस्ट लिंक: सिर्फ़ इसी Wi-Fi पर चलेगा। सार्वजनिक लिंक के लिए VITE_PUBLIC_URL सेट करें।',
    shareEmpty: 'कोड बनाने के लिए एक बार इंटरनेट के साथ "आज" खोलें।',
    sharedBy: 'WeatherGPT उपयोगकर्ता ने साझा किया',
    sharedAt: '{t} की जानकारी। यह बदल चुकी हो सकती है।',
    liveNow: 'अभी की ताज़ा जानकारी', openApp: 'WeatherGPT खोलें',
    badLink: 'यह कोड पढ़ा नहीं जा सका।',
    language: 'भाषा', place: 'जगह', role: 'आप कौन हैं?',
    findMe: 'मेरी जगह खोजें', searchPlace: 'ज़िला खोजें', locating: 'आपको खोज रहे हैं…',
    locDenied: 'लोकेशन बंद है। अपना ज़िला चुनें।',
    adviceNote: 'सामान्य सलाह, सरकारी आदेश नहीं',
    sources: 'स्रोत', official: 'सरकारी', forecastBy: 'पूर्वानुमान',
    done: 'ठीक है', settings: 'सेटिंग',
  },
  te: {
    appName: 'WeatherGPT',
    tabToday: 'ఈ రోజు', tabAsk: 'అడగండి', tabAlerts: 'హెచ్చరికలు', tabShare: 'పంచుకోండి',
    lvCRITICAL: 'ప్రమాదం — రెడ్ అలర్ట్',
    lvHIGH: 'చాలా జాగ్రత్త — ఆరెంజ్ అలర్ట్',
    lvMODERATE: 'జాగ్రత్త — ఎల్లో అలర్ట్',
    lvLOW: 'మీ జిల్లాకు ప్రభుత్వ హెచ్చరిక లేదు',
    lvUNKNOWN: 'హెచ్చరికలను తనిఖీ చేయలేకపోయాం',
    lvUNKNOWNsub: 'బయటకు వెళ్ళే ముందు స్థానిక అధికారులను అడగండి.',
    checked: 'తనిఖీ చేశాం', notConnected: 'కనెక్ట్ కాలేదు',
    now: 'ఇప్పుడు', rain: 'వర్షం', wind: 'గాలి', humidity: 'తేమ',
    today: 'ఈ రోజు', tomorrow: 'రేపు', nextDays: 'రాబోయే రోజులు',
    forYou: 'మీ కోసం',
    roleGeneral: 'అందరూ', roleFarmer: 'రైతు', roleFisherman: 'మత్స్యకారులు', roleDriver: 'డ్రైవర్',
    listen: 'వినండి', stop: 'ఆపండి',
    live: 'లైవ్', saved: 'సేవ్', justNow: 'ఇప్పుడే', minAgo: '{n} నిమిషాల క్రితం', hrAgo: '{n} గంటల క్రితం', dayAgo: '{n} రోజుల క్రితం',
    offline: 'ఇంటర్నెట్ లేదు — సేవ్ చేసిన సమాచారం చూపిస్తున్నాం',
    nothingSaved: 'ఇంకా ఏమీ సేవ్ కాలేదు. ఒకసారి ఇంటర్నెట్‌కు కనెక్ట్ అవ్వండి.',
    notAvailable: 'ప్రస్తుతం అందుబాటులో లేదు',
    retry: 'మళ్ళీ ప్రయత్నించండి', loading: 'లోడ్ అవుతోంది…',
    askHint: 'మైక్ నొక్కి మాట్లాడండి', typeHere: 'లేదా మీ ప్రశ్న టైప్ చేయండి', send: 'పంపండి',
    listening: 'వింటున్నాం… ఆపడానికి నొక్కండి', working: 'అర్థం చేసుకుంటున్నాం…',
    micDenied: 'మాట్లాడటానికి మైక్ అనుమతి ఇవ్వండి', micFailed: 'అర్థం కాలేదు. మళ్ళీ చెప్పండి.',
    micNone: 'ఈ ఫోన్‌లో వాయిస్ అందుబాటులో లేదు',
    qRain: 'రేపు వర్షం పడుతుందా?', qWarn: 'ఈ రోజు ఏదైనా హెచ్చరిక ఉందా?',
    qSea: 'ఈ రోజు మత్స్యకారులు సముద్రంలోకి వెళ్ళవచ్చా?', qHeat: 'ఈ రోజు ఎంత ఎండ ఉంటుంది?',
    qCrop: 'ఈ రోజు పంటకు మందు చల్లవచ్చా?', qRoad: 'ఈ రోజు రోడ్లు తడిగా ఉంటాయా?',
    queued: 'ఇంటర్నెట్ లేదు. ఇంటర్నెట్ వచ్చాక అడుగుతాం.',
    offlineAnswer: 'ఇంటర్నెట్ లేదు. చివరిగా సేవ్ చేసిన సమాచారం:',
    aiNote: 'AI ప్రభుత్వ సమాచారాన్ని మాత్రమే వివరిస్తుంది, హెచ్చరికలు సృష్టించదు.',
    yourDistrict: 'మీ జిల్లా', elsewhere: 'మీ రాష్ట్రంలో ఇతర చోట్ల',
    alertsNone: 'ప్రస్తుతం మీ రాష్ట్రంలో ప్రభుత్వ హెచ్చరికలు లేవు',
    until: '{t} వరకు', source: 'మూలం', explain: 'వివరించండి',
    explainQ: 'ఈ ప్రభుత్వ హెచ్చరికను సులభంగా వివరించండి: {h}',
    shareTitle: 'పంచుకోవడానికి ఈ కోడ్ చూపించండి',
    shareHint: 'ఎవరైనా ఫోన్ కెమెరాతో స్కాన్ చేయవచ్చు. యాప్ అవసరం లేదు.',
    shareSend: 'పంపండి', shareSave: 'చిత్రం సేవ్ చేయండి',
    shareLocal: 'టెస్ట్ లింక్: ఈ Wi-Fi లో మాత్రమే పనిచేస్తుంది. పబ్లిక్ లింక్ కోసం VITE_PUBLIC_URL సెట్ చేయండి.',
    shareEmpty: 'కోడ్ తయారు చేయడానికి ఒకసారి ఇంటర్నెట్‌తో "ఈ రోజు" తెరవండి.',
    sharedBy: 'WeatherGPT వినియోగదారు పంచుకున్నారు',
    sharedAt: '{t} నాటి సమాచారం. ఇది మారి ఉండవచ్చు.',
    liveNow: 'ఇప్పటి తాజా సమాచారం', openApp: 'WeatherGPT తెరవండి',
    badLink: 'ఈ కోడ్ చదవలేకపోయాం.',
    language: 'భాష', place: 'ప్రదేశం', role: 'మీరు ఎవరు?',
    findMe: 'నా ప్రదేశం కనుగొను', searchPlace: 'జిల్లా వెతకండి', locating: 'మిమ్మల్ని కనుగొంటున్నాం…',
    locDenied: 'లొకేషన్ ఆఫ్‌లో ఉంది. మీ జిల్లా ఎంచుకోండి.',
    adviceNote: 'సాధారణ సూచన, ప్రభుత్వ ఆదేశం కాదు',
    sources: 'మూలాలు', official: 'ప్రభుత్వ', forecastBy: 'అంచనా',
    done: 'సరే', settings: 'సెట్టింగ్‌లు',
  },
};

export function t(lang, key, vars) {
  let s = (STR[lang] && STR[lang][key]) ?? STR.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

export const LOCALE = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };

export function fmtTime(iso, lang) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(LOCALE[lang] || 'en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function fmtDateTime(iso, lang) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(LOCALE[lang] || 'en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function dayName(dateStr, lang, index) {
  if (index === 0) return t(lang, 'today');
  if (index === 1) return t(lang, 'tomorrow');
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(LOCALE[lang] || 'en-IN', { weekday: 'short' });
}

export function ago(savedAt, lang, now = Date.now()) {
  if (savedAt == null) return '';
  const m = Math.max(0, Math.round((now - savedAt) / 60000));
  if (m < 2) return t(lang, 'justNow');
  if (m < 60) return t(lang, 'minAgo', { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t(lang, 'hrAgo', { n: h });
  return t(lang, 'dayAgo', { n: Math.round(h / 24) });
}

// Open-Meteo condition words -> local words. Unknown ones show as sent.
const COND = {
  hi: {
    Clear: 'साफ़ आसमान', 'Mostly Clear': 'ज़्यादातर साफ़', 'Partly Cloudy': 'आंशिक बादल', Overcast: 'घने बादल',
    Cloudy: 'बादल', Foggy: 'कोहरा', 'Light Drizzle': 'हल्की बूंदाबांदी', Drizzle: 'बूंदाबांदी',
    'Light Rain': 'हल्की बारिश', Rain: 'बारिश', 'Heavy Rain': 'भारी बारिश', 'Light Showers': 'हल्की बौछारें',
    Showers: 'बौछारें', 'Heavy Showers': 'तेज़ बौछारें', Thunderstorm: 'आंधी-तूफ़ान',
  },
  te: {
    Clear: 'నిర్మలమైన ఆకాశం', 'Mostly Clear': 'ఎక్కువగా నిర్మలం', 'Partly Cloudy': 'కొంత మేఘావృతం', Overcast: 'దట్టమైన మేఘాలు',
    Cloudy: 'మేఘావృతం', Foggy: 'పొగమంచు', 'Light Drizzle': 'చిరుజల్లులు', Drizzle: 'జల్లులు',
    'Light Rain': 'తేలికపాటి వర్షం', Rain: 'వర్షం', 'Heavy Rain': 'భారీ వర్షం', 'Light Showers': 'తేలికపాటి జల్లులు',
    Showers: 'జల్లులు', 'Heavy Showers': 'భారీ జల్లులు', Thunderstorm: 'ఉరుములతో కూడిన వర్షం',
  },
};
export function condText(condition, lang) {
  return (COND[lang] && COND[lang][condition]) || condition || '';
}
