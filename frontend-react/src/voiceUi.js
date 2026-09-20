// Pure voice-UI helpers — no React, no DOM — so the popup state machine and
// the STT fast-path decision are unit-testable (tests/voice-ui.test.mjs).
//
// STT fast-path: when the backend reports no STT provider (browser-fallback),
// recording with MediaRecorder and uploading the audio first is pure waste —
// the server would just answer "use the browser instead" and the user would
// have to speak a second time. shouldUseBrowserStt() lets the mic go straight
// to on-device recognition.
export function shouldUseBrowserStt(status) {
  return status?.stt === 'browser-fallback';
}

// Maps (speechState, listenState) to the single voice popup to show, or null.
// TTS wins when both are active (the mic and the speaker rarely overlap).
// Label keys resolve via t(lang, key) in en/hi/te — no new i18n keys needed.
export function resolveVoicePopup({ speechState, listenState } = {}) {
  if (speechState === 'loading' || speechState === 'playing') {
    return { kind: 'tts', labelKey: 'speaking', subKey: null, visual: 'pulse' };
  }
  if (listenState === 'recording') {
    return { kind: 'stt', labelKey: 'voiceListening', subKey: 'voiceTapFinish', visual: 'bars' };
  }
  if (listenState === 'processing') {
    return { kind: 'stt', labelKey: 'processing', subKey: null, visual: 'pulse' };
  }
  if (listenState === 'permission') {
    return { kind: 'stt', labelKey: 'voiceListening', subKey: null, visual: 'pulse' };
  }
  return null;
}
