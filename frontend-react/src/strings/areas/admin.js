// Admin gate strings (workstream F — admin panel authority gating).
//
// These keys were first defined in harboursignal.js ("Team access only").
// The gate is now authorities-only: the console holds the data-source mode
// switch and alert-coverage telemetry, so the copy says so. This module
// redefines the same keys and is applied LAST by ./index.js so its
// definitions win (it is explicitly re-applied after the sorted-glob merge).
//
// All three languages are required.
export default {
  en: {
    adminGateTitle: 'Authorities only',
    adminGateBody:
      'This console holds the data-source mode switch and alert-coverage telemetry. It is restricted to authorized disaster-management personnel. If that is not you, please go back.',
    adminGatePinLabel: 'Authority PIN',
    adminGateUnlock: 'Unlock',
    adminGateWrong: 'Wrong PIN — try again.',
    adminGateBack: 'Go back',
    adminGateNote:
      'Team gate: this PIN is not sign-in. Real protection is server-side.',
  },
  hi: {
    adminGateTitle: 'केवल अधिकारियों के लिए',
    adminGateBody:
      'इस कंसोल में डेटा-स्रोत मोड स्विच और अलर्ट-कवरेज टेलीमेट्री है। यह केवल प्राधिकृत आपदा-प्रबंधन कर्मियों तक सीमित है। यदि आप उनमें से नहीं हैं, तो कृपया वापस जाएँ।',
    adminGatePinLabel: 'अधिकारी पिन',
    adminGateUnlock: 'खोलें',
    adminGateWrong: 'गलत पिन — फिर से कोशिश करें।',
    adminGateBack: 'वापस जाएँ',
    adminGateNote:
      'टीम गेट: यह पिन साइन-इन नहीं है। असली सुरक्षा सर्वर पर है।',
  },
  te: {
    adminGateTitle: 'అధికారులకు మాత్రమే',
    adminGateBody:
      'ఈ కన్సోల్‌లో డేటా-మూల మోడ్ స్విచ్ మరియు అలర్ట్-కవరేజ్ టెలిమెట్రీ ఉన్నాయి. ఇది అధికారం పొందిన విపత్తు నిర్వహణ సిబ్బందికి మాత్రమే పరిమితం. మీరు వారిలో ఒకరు కాకపోతే, దయచేసి వెనక్కి వెళ్ళండి.',
    adminGatePinLabel: 'అధికారి పిన్',
    adminGateUnlock: 'అన్‌లాక్',
    adminGateWrong: 'తప్పు పిన్ — మళ్లీ ప్రయత్నించండి.',
    adminGateBack: 'వెనక్కి వెళ్ళండి',
    adminGateNote:
      'టీమ్ గేట్: ఈ పిన్ సైన్-ఇన్ కాదు. నిజమైన రక్షణ సర్వర్ వైపు ఉంది.',
  },
};
