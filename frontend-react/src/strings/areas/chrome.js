// App-chrome strings: the shell (sidebar/top bar/status banners), the crash
// boundary and the shared region labels.
//
// These were the last hardcoded English strings in the citizen-facing chrome.
// A fisherman who reads Telugu was still getting "Colour theme", "Conversation"
// and the DISASTER MODE banner in English — and that banner appears precisely
// when a confirmed severe warning is active, which is the worst moment to hand
// someone a language they may not read.
//
// Machine-readable codes (LIVE/CACHED/DEMO, RED/ORANGE, mode ids) are NOT here:
// they are rendered verbatim by design.
export default {
  en: {
    navSections: 'Sections',
    locAuto: 'Detected automatically',
    chatRegion: 'Conversation',
    disasterBanner: 'DISASTER MODE — verified severe warning active. Safety first, then communication.',
    boundaryTitle: 'This view failed to render',
    boundaryBody: 'The rest of the console keeps working. Nothing was invented to fill the gap.',
    srcStatusTitle: 'Data sources',
    srcStatusSub: 'Every source reports its own status. Nothing is labelled LIVE unless it is.',
    ntfUnread: 'Unread',
    alertsGroup: 'Alerts',
    p2pSimTitle: 'Simulated mesh — not a real radio path',
    p2pOutbox: 'Store-and-forward outbox',
  },
  hi: {
    navSections: 'अनुभाग',
    locAuto: 'स्वतः पहचाना गया',
    chatRegion: 'बातचीत',
    disasterBanner: 'आपदा मोड — सत्यापित गंभीर चेतावनी सक्रिय। पहले सुरक्षा, फिर संचार।',
    boundaryTitle: 'यह स्क्रीन नहीं दिख सकी',
    boundaryBody: 'बाकी ऐप चलता रहेगा। जगह भरने के लिए कुछ गढ़ा नहीं गया।',
    srcStatusTitle: 'डेटा स्रोत',
    srcStatusSub: 'हर स्रोत अपनी स्थिति बताता है। जो लाइव नहीं है उसे LIVE नहीं कहा जाता।',
    ntfUnread: 'अपठित',
    alertsGroup: 'अलर्ट',
    p2pSimTitle: 'नकली मेश — असली रेडियो पथ नहीं',
    p2pOutbox: 'भेजने के लिए रखे संदेश',
  },
  te: {
    navSections: 'విభాగాలు',
    locAuto: 'స్వయంగా గుర్తించబడింది',
    chatRegion: 'సంభాషణ',
    disasterBanner: 'విపత్తు మోడ్ — ధృవీకరించిన తీవ్ర హెచ్చరిక క్రియాశీలం. ముందు భద్రత, తర్వాత సంభాషణ.',
    boundaryTitle: 'ఈ తెర చూపించలేకపోయాం',
    boundaryBody: 'మిగిలిన యాప్ పనిచేస్తూనే ఉంటుంది. ఖాళీ నింపడానికి ఏదీ కల్పించలేదు.',
    srcStatusTitle: 'డేటా మూలాలు',
    srcStatusSub: 'ప్రతి మూలం తన స్థితిని తెలియజేస్తుంది. లైవ్ కానిది LIVE అని చూపము.',
    ntfUnread: 'చదవని',
    alertsGroup: 'అలర్ట్‌లు',
    p2pSimTitle: 'అనుకరణ మెష్ — నిజమైన రేడియో మార్గం కాదు',
    p2pOutbox: 'పంపడానికి ఉన్న సందేశాలు',
  },
};
