// Strings for the 5-step onboarding tour (OnboardingTour.jsx).
//
// One short line per step — icons carry the meaning for low-literacy users,
// the text just confirms. Sentence case, harbour-master voice, EN/HI/TE.
// No Tamil script anywhere in this file.
//
// NOTE: this area module OVERRIDES the same keys in src/i18n.js (area strings
// win the merge), so the tour's words live here and only here. The Worker-1
// push block in i18n.js still carries these keys as a fallback for any
// consumer that resolves them before areas merge — the values are identical.
export default {
  en: {
    ot1t: 'Your safety verdict',
    ot1b: 'The big word is your safety state, not the temperature. The countdown shows warning expiry; the strip shows the source.',
    ot2t: 'Ask in your words',
    ot2b: 'Type or dictate, then hit enter. Tap the speaker on any answer to hear it.',
    ot3t: 'Alerts, always honest',
    ot3b: 'Official warnings for your district. What we could not check is labelled — never guessed.',
    ot4t: 'Works offline',
    ot4b: 'The app shell loads without internet. Questions you ask offline are sent when you are back.',
    ot5t: 'Get alerts with the app closed',
    ot5b: 'Allow notifications once. SAARTHI can then warn you about your district while the app is closed — or inside the app if your browser cannot do background alerts.',
    ot5cta: 'Allow notifications',
    ot5on: 'Background alerts on',
    ot5inapp: 'In-app alerts on',
  },
  hi: {
    ot1t: 'आपका सुरक्षा निर्णय',
    ot1b: 'बड़ा शब्द आपकी सुरक्षा स्थिति है, तापमान नहीं। उल्टी गिनती चेतावनी की समाप्ति दिखाती है; पट्टी स्रोत दिखाती है।',
    ot2t: 'अपने शब्दों में पूछें',
    ot2b: 'लिखें या बोलें, फिर एंटर दबाएँ। किसी भी उत्तर को सुनने के लिए स्पीकर दबाएँ।',
    ot3t: 'अलर्ट, हमेशा ईमानदार',
    ot3b: 'आपके जिले की सरकारी चेतावनियाँ। जो जाँच नहीं हो सका, वह लिखा होगा — अंदाज़ा कभी नहीं।',
    ot4t: 'ऑफ़लाइन भी काम करता है',
    ot4b: 'ऐप बिना इंटरनेट के खुलता है। ऑफ़लाइन पूछे गए सवाल वापस आने पर भेजे जाते हैं।',
    ot5t: 'ऐप बंद होने पर भी अलर्ट पाएँ',
    ot5b: 'एक बार नोटिफिकेशन की अनुमति दें। फिर ऐप बंद होने पर भी आपके जिले की चेतावनी मिलेगी — या सिर्फ ऐप में, अगर ब्राउज़र बैकग्राउंड अलर्ट नहीं दे सकता।',
    ot5cta: 'नोटिफिकेशन की अनुमति दें',
    ot5on: 'बैकग्राउंड अलर्ट चालू',
    ot5inapp: 'ऐप में अलर्ट चालू',
  },
  te: {
    ot1t: 'మీ భద్రతా తీర్పు',
    ot1b: 'పెద్ద పదం మీ భద్రతా స్థితి, ఉష్ణోగ్రత కాదు. కౌంట్\\u200cడౌన్ హెచ్చరిక గడువును చూపుతుంది; పట్టీ మూలాన్ని చూపుతుంది.',
    ot2t: 'మీ మాటల్లో అడగండి',
    ot2b: 'రాయండి లేదా మాట్లాడి ఎంటర్ నొక్కండి. ఏ సమాధానమైనా వినడానికి స్పీకర్ నొక్కండి.',
    ot3t: 'హెచ్చరికలు, ఎల్లప్పుడూ నిజాయితీ',
    ot3b: 'మీ జిల్లా అధికారిక హెచ్చరికలు. తనిఖీ చేయలేనిది గుర్తించబడుతుంది — ఊహించబడదు.',
    ot4t: 'ఆఫ్\\u200cలైన్\\u200cలో కూడా పనిచేస్తుంది',
    ot4b: 'ఇంటర్నెట్ లేకుండా యాప్ తెరుచుకుంటుంది. ఆఫ్\\u200cలైన్\\u200cలో అడిగిన ప్రశ్నలు తిరిగి వచ్చాక పంపబడతాయి.',
    ot5t: 'యాప్ మూసినా హెచ్చరికలు పొందండి',
    ot5b: 'ఒక్కసారి నోటిఫికేషన్లను అనుమతించండి. యాప్ మూసినా మీ జిల్లా హెచ్చరిక అందుతుంది — లేదా మీ బ్రౌజర్ బ్యాక్\\u200cగ్రౌండ్ హెచ్చరికలు ఇవ్వలేకపోతే యాప్\\u200cలో మాత్రమే.',
    ot5cta: 'నోటిఫికేషన్లను అనుమతించండి',
    ot5on: 'బ్యాక్\\u200cగ్రౌండ్ హెచ్చరికలు ఆన్',
    ot5inapp: 'యాప్\\u200cలో హెచ్చరికలు ఆన్',
  },
};
