// Admin gate strings (workstream F — admin panel authority gating).
//
// These keys were first defined in harboursignal.js ("Team access only").
// The gate is now authorities-only: the console publishes and changes
// official alerts, so the copy says so. This module redefines the same keys
// and is applied LAST by ./index.js so its definitions win (it sorts before
// harboursignal.js in the plain sorted-glob merge).
//
// All three languages are required.
export default {
  en: {
    adminGateTitle: 'Authorities only',
    adminGateBody:
      'This console publishes and changes official alerts. It is restricted to authorized disaster-management personnel. If that is not you, please go back.',
    adminGatePinLabel: 'Authority PIN',
    adminGateUnlock: 'Unlock',
    adminGateWrong: 'Wrong PIN — try again.',
    adminGateBack: 'Go back',
    adminGateDemoNote:
      'Demo gate: this PIN is not sign-in. Real protection is server-side.',
  },
  hi: {
    adminGateTitle: 'केवल अधिकारियों के लिए',
    adminGateBody:
      'यह कंसोल आधिकारिक अलर्ट प्रकाशित और बदलता है। यह केवल प्राधिकृत आपदा-प्रबंधन कर्मियों तक सीमित है। यदि आप उनमें से नहीं हैं, तो कृपया वापस जाएँ।',
    adminGatePinLabel: 'अधिकारी पिन',
    adminGateUnlock: 'खोलें',
    adminGateWrong: 'गलत पिन — फिर से कोशिश करें।',
    adminGateBack: 'वापस जाएँ',
    adminGateDemoNote:
      'डेमो गेट: यह पिन साइन-इन नहीं है। असली सुरक्षा सर्वर पर है।',
  },
  te: {
    adminGateTitle: 'అధికారులకు మాత్రమే',
    adminGateBody:
      'ఈ కన్సోల్ అధికారిక హెచ్చరికలను ప్రచురిస్తుంది, మారుస్తుంది. ఇది అధికారం పొందిన విపత్తు నిర్వహణ సిబ్బందికి మాత్రమే పరిమితం. మీరు వారిలో ఒకరు కాకపోతే, దయచేసి వెనక్కి వెళ్ళండి.',
    adminGatePinLabel: 'అధికారి పిన్',
    adminGateUnlock: 'అన్‌లాక్',
    adminGateWrong: 'తప్పు పిన్ — మళ్లీ ప్రయత్నించండి.',
    adminGateBack: 'వెనక్కి వెళ్ళండి',
    adminGateDemoNote:
      'డెమో గేట్: ఈ పిన్ సైన్-ఇన్ కాదు. నిజమైన రక్షణ సర్వర్ వైపు ఉంది.',
  },
};
