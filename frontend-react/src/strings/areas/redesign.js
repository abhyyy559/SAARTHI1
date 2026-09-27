// Redesign strings: the shell overhaul (two-tier top bar, more menu),
// the honest server-write behaviour in the notification center,
// the translated alert-details labels, and the clarified Advisor/Advisory copy.
//
// EN/HI/TE with exact key parity. None of these keys exist in i18n.js —
// area files must not redefine base keys (see tests/modes.test.mjs).
export default {
  en: {
    // --- notification center: honest failure --------------------------------
    ntfActionFailed: 'Could not reach the server — not saved.',
    // --- alerts row: the test-push button is a verb, not past tense ----
    notifyTest: 'Send test push',
    // --- shell: more menu ----------------------------------------------------
    menuMore: 'More',
    menuSettings: 'Settings',
    // --- shell: connection pill ----------------------------------------------
    connOnline: 'Online',
    connCached: 'Cached',
    connOffline: 'Offline',
    // --- ask: the spoken-answer switch, unmissable -----------------------------
    askHearAnswers: 'Hear answers aloud',
    // Ask is facts-only — guidance lives on the advisory page.
    askAdviceHint: 'Need guidance instead? Open My advice',
    // --- alert details: labels, previously hardcoded English -------------------
    detTimeline: 'Timeline',
    detAckFailed: 'Ack failed (offline?). Try again when you are online.',
    // --- trust / sources: manual re-check --------------------------------------
    trustRecheck: 'Re-check',
    // --- admin: the data-source mode switch lives here now ----------------------
    modeTitle: 'Data source mode',
    modeSub: 'Which sources carry the answers. Backstage infrastructure — not a citizen setting.',
    // --- how it works: card chrome ----------------------------------------------
    howTitle: 'How it works',
    howSub: 'Architecture jobs with honest status. No mock is ever labelled LIVE.',
  },
  hi: {
    ntfActionFailed: 'सर्वर से संपर्क नहीं हो सका — सहेजा नहीं गया।',
    notifyTest: 'टेस्ट सूचना भेजें',
    menuMore: 'और',
    menuSettings: 'सेटिंग',
    connOnline: 'ऑनलाइन',
    connCached: 'कैश्ड',
    connOffline: 'ऑफ़लाइन',
    askHearAnswers: 'उत्तर ज़ोर से सुनें',
    askAdviceHint: 'मार्गदर्शन चाहिए? मेरी सलाह खोलें',
    detTimeline: 'समयरेखा',
    detAckFailed: 'प्राप्ति दर्ज नहीं हुई (ऑफ़लाइन?)। ऑनलाइन आने पर फिर कोशिश करें।',
    trustRecheck: 'फिर जाँचें',
    modeTitle: 'डेटा स्रोत मोड',
    modeSub: 'उत्तर किन स्रोतों से आएँगे। बैकस्टेज व्यवस्था — नागरिकों के लिए सेटिंग नहीं।',
    howTitle: 'यह कैसे काम करता है',
    howSub: 'ईमानदार स्थिति के साथ आर्किटेक्चर कार्य। कोई मॉक कभी LIVE नहीं दिखाया जाता।',
  },
  te: {
    ntfActionFailed: 'సర్వర్‌ను చేరలేకపోయాం — సేవ్ కాలేదు.',
    notifyTest: 'టెస్ట్ నోటిఫికేషన్ పంపండి',
    menuMore: 'మరిన్ని',
    menuSettings: 'సెట్టింగ్‌లు',
    connOnline: 'ఆన్‌లైన్',
    connCached: 'క్యాష్',
    connOffline: 'ఆఫ్‌లైన్',
    askHearAnswers: 'సమాధానాలు బిగ్గరగా వినండి',
    askAdviceHint: 'మార్గదర్శకం కావాలా? నా సలహా తెరవండి',
    detTimeline: 'కాలక్రమం',
    detAckFailed: 'స్వీకారం నమోదు కాలేదు (ఆఫ్‌లైన్?). ఆన్‌లైన్‌కు వచ్చాక మళ్లీ ప్రయత్నించండి.',
    trustRecheck: 'మళ్లీ తనిఖీ చేయండి',
    modeTitle: 'డేటా మూల మోడ్',
    modeSub: 'సమాధానాలు ఏ మూలాల నుండి వస్తాయి. బ్యాక్‌స్టేజ్ వ్యవస్థ — పౌరుల సెట్టింగ్ కాదు.',
    howTitle: 'ఇది ఎలా పని చేస్తుంది',
    howSub: 'నిజాయితీగల స్థితితో ఆర్కిటెక్చర్ పనులు. ఏ మాక్‌ను LIVE అని చూపించము.',
  },
};
