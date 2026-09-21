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

// --- streaming-STT audio helpers (pure, unit-testable) --------------------
// The streaming relay (/api/voice/transcribe-stream) accepts only 16 kHz PCM
// (a Sarvam streaming constraint), so mic audio captured at the device rate
// is downsampled client-side and shipped as base64 int16 frames. Keeping this
// pure means the whole encode path is verifiable without a microphone.
export function downsampleTo16k(samples, fromRate) {
  if (!samples || !samples.length) return new Float32Array(0);
  if (fromRate === 16000) return Float32Array.from(samples);
  const ratio = fromRate / 16000;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = pos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

export function floatTo16BitPCM(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function base64FromBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < u8.length; i += STEP) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + STEP));
  }
  return btoa(bin);
}

// One mic frame -> wire format for the relay: downsampled 16 kHz int16 PCM,
// base64-encoded. ~250 ms of audio per call keeps frames small and frequent,
// which is what lets the first interim arrive in < 1 s.
export function encodeMicFrame(float32, fromRate) {
  const ds = downsampleTo16k(float32, fromRate);
  const pcm = floatTo16BitPCM(ds);
  return base64FromBytes(new Uint8Array(pcm.buffer));
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
