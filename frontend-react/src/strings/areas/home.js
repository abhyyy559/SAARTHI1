// Home screen strings.
//
// Every key here is deliberately SHORT. The reader may not read well, so the
// screen leans on the icon next to the word: these words only confirm what the
// picture already said. Keep them one idea, no jargon, no officialese.
//
// Severity words ("Danger", "Be alert", "Cannot confirm") are NOT here - they
// already live in i18n.js as sevRed / sevOrange / basisUnavailable and are
// shared with the Alerts page so the two screens can never disagree.
export default {
  en: {
    homeTileSpeak: 'Speak',
    homeTileAlerts: 'Alerts',
    homeTypeInstead: 'Type instead',
    homeListen: 'Listen',
    homeThreatLabel: 'Threat',
    homeSeverityLabel: 'How serious',
    // Shown before the app has asked the backend anything, because location is
    // not set yet. Distinct from basisUnavailable ("Cannot confirm"), which is a
    // statement about IMD/CAP: claiming the service is unreachable before we have
    // sent a single request is simply false, and it is alarming on a first run.
    verdictPending: 'Not checked yet',
    homePendingNote: 'Pick your district or allow location, then we will check for warnings.',
    // The feed answered, but every alert it held for this district has lapsed.
    // Not "unreachable" — that is a false statement about the world and points
    // the reader at the wrong problem.
    homeStaleCap: 'The official alerts for your area have expired, so what is in force now cannot be confirmed.',
    // Top-bar toggle that CUTS the network path for real (api.js throws when it
    // is on), so offline behaviour can be shown rather than just described.
    offlineOn: 'Offline mode on — tap to go back online',
    offlineOff: 'Simulate offline mode',
  },
  hi: {
    homeTileSpeak: 'बोलिए',
    homeTileAlerts: 'चेतावनी',
    homeTypeInstead: 'लिखकर पूछें',
    homeListen: 'सुनिए',
    homeThreatLabel: 'खतरा',
    homeSeverityLabel: 'कितना गंभीर',
    verdictPending: 'अभी जाँच नहीं हुई',
    homePendingNote: 'अपना जिला चुनें या लोकेशन दें, फिर हम चेतावनी जाँचेंगे।',
    homeStaleCap: 'आपके क्षेत्र की सरकारी चेतावनियाँ समाप्त हो चुकी हैं, इसलिए अभी क्या लागू है यह पुष्टि नहीं हो सकती।',
    offlineOn: 'ऑफ़लाइन मोड चालू — ऑनलाइन जाने के लिए टैप करें',
    offlineOff: 'ऑफ़लाइन मोड दिखाएँ',
  },
  te: {
    homeTileSpeak: 'మాట్లాడండి',
    homeTileAlerts: 'హెచ్చరికలు',
    homeTypeInstead: 'టైప్ చేసి అడగండి',
    homeListen: 'వినండి',
    homeThreatLabel: 'ముప్పు',
    homeSeverityLabel: 'ఎంత తీవ్రం',
    verdictPending: 'ఇంకా తనిఖీ కాలేదు',
    homePendingNote: 'మీ జిల్లాను ఎంచుకోండి లేదా లొకేషన్ ఇవ్వండి, తర్వాత హెచ్చరికలు తనిఖీ చేస్తాము.',
    homeStaleCap: 'మీ ప్రాంతానికి సంబంధించిన అధికారిక హెచ్చరికలు గడువు ముగిసాయి, కాబట్టి ఇప్పుడు ఏది అమలులో ఉందో ఖరారీ చేయలేము.',
    offlineOn: 'ఆఫ్‌లైన్ మోడ్ ఆన్ — ఆన్‌లైన్‌కు వెళ్లడానికి నొక్కండి',
    offlineOff: 'ఆఫ్‌లైన్ మోడ్ చూపించు',
  },
};
