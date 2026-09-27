import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolveVoicePopup, shouldUseBrowserStt, downsampleTo16k, floatTo16BitPCM, base64FromBytes, encodeMicFrame } from '../src/voiceUi.js';

// --- STT fast-path decision ----------------------------------------------
test('browser-fallback status takes the fast path (no record+upload first)', () => {
  assert.equal(shouldUseBrowserStt({ stt: 'browser-fallback', tts: 'browser-fallback' }), true);
});

test('a live STT provider keeps the server record+upload path', () => {
  assert.equal(shouldUseBrowserStt({ stt: 'sarvam-live', tts: 'sarvam-live' }), false);
  assert.equal(shouldUseBrowserStt({ stt: 'sarvam-live' }), false);
});

test('missing/unknown status never takes the fast path', () => {
  assert.equal(shouldUseBrowserStt(null), false);
  assert.equal(shouldUseBrowserStt(undefined), false);
  assert.equal(shouldUseBrowserStt({}), false);
  assert.equal(shouldUseBrowserStt({ stt: 'weird' }), false);
});

// --- popup state machine ---------------------------------------------------
test('TTS loading/playing shows the Speaking popup with a pulsing dot', () => {
  for (const s of ['loading', 'playing']) {
    const m = resolveVoicePopup({ speechState: s, listenState: 'idle' });
    assert.deepEqual(m, { kind: 'tts', labelKey: 'speaking', subKey: null, visual: 'pulse' });
  }
});

test('TTS wins when both TTS and STT are active', () => {
  const m = resolveVoicePopup({ speechState: 'playing', listenState: 'recording' });
  assert.equal(m.kind, 'tts');
});

test('STT recording shows Listening with animated bars and tap-to-finish hint', () => {
  const m = resolveVoicePopup({ speechState: 'idle', listenState: 'recording' });
  assert.deepEqual(m, { kind: 'stt', labelKey: 'voiceListening', subKey: 'voiceTapFinish', visual: 'bars' });
});

test('STT processing shows the understanding label with a pulsing dot', () => {
  const m = resolveVoicePopup({ speechState: 'idle', listenState: 'processing' });
  assert.deepEqual(m, { kind: 'stt', labelKey: 'processing', subKey: null, visual: 'pulse' });
});

test('STT permission phase shows Listening (mic prompt is itself visible)', () => {
  const m = resolveVoicePopup({ speechState: 'idle', listenState: 'permission' });
  assert.deepEqual(m, { kind: 'stt', labelKey: 'voiceListening', subKey: null, visual: 'pulse' });
});

test('idle states show no popup (auto-dismiss on end/error/denial)', () => {
  assert.equal(resolveVoicePopup({ speechState: 'idle', listenState: 'idle' }), null);
  assert.equal(resolveVoicePopup({}), null);
  assert.equal(resolveVoicePopup(), null);
});

test('muted TTS shows a transient note popup while speech is idle', () => {
  const m = resolveVoicePopup({ speechState: 'idle', listenState: 'idle', speechNote: 'voiceMuted' });
  assert.deepEqual(m, { kind: 'note', labelKey: 'voiceMuted', subKey: null, visual: 'dot' });
});

test('active TTS wins over the muted note (no collision with the Speaking card)', () => {
  const m = resolveVoicePopup({ speechState: 'playing', listenState: 'idle', speechNote: 'voiceMuted' });
  assert.equal(m.kind, 'tts');
});

// --- i18n: every popup label exists in EN/HI/TE, no Tamil script -----------
// i18n.js is Vite-resolved (directory import) so node cannot import it; parse
// the EXTRA source block instead — the same keys the popup renders via t().
function extraStrings() {
  // Strip \r so the parses below work on Windows (CRLF) and Linux (LF) alike.
  const lines = readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8').split('\n').map((l) => l.replace(/\r$/, ''));
  const start = lines.findIndex((l) => l.startsWith('const EXTRA = {'));
  const langs = {};
  for (let i = start; i < start + 12 && Object.keys(langs).length < 3; i++) {
    const m = lines[i].match(/^  (en|hi|te): \{(.*)\},?$/);
    if (m && !langs[m[1]]) {
      const pairs = {};
      for (const p of m[2].matchAll(/([A-Za-z0-9_]+):\s*'((?:[^'\\]|\\.)*)'/g)) pairs[p[1]] = p[2];
      langs[m[1]] = pairs;
    }
  }
  return langs;
}

const POPUP_KEYS = ['speaking', 'stop', 'voiceListening', 'voiceTapFinish', 'processing', 'voiceMuted'];

test('popup labels exist and are non-empty in en, hi and te', () => {
  const langs = extraStrings();
  assert.deepEqual(Object.keys(langs).sort(), ['en', 'hi', 'te']);
  for (const key of POPUP_KEYS) {
    for (const lang of ['en', 'hi', 'te']) {
      const v = langs[lang][key];
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${lang}.${key} missing or empty`);
    }
  }
});

test('no Tamil script anywhere in the hi/te popup strings', () => {
  const langs = extraStrings();
  const tamil = /[\u0B80-\u0BFF]/u; // Tamil block - must never appear
  for (const lang of ['hi', 'te']) {
    for (const [key, v] of Object.entries(langs[lang])) {
      assert.ok(!tamil.test(v), `Tamil script found in ${lang}.${key}`);
    }
  }
});

// --- streaming-STT audio helpers (Crew C latency work) ----------------------
// The relay accepts only 16 kHz PCM; these pure helpers are the whole
// client-side encode path, verified here without a microphone.

test('downsampleTo16k halves 32 kHz audio (linear interpolation)', () => {
  const src = new Float32Array([0, 0.5, 1, 0.5]);
  const out = downsampleTo16k(src, 32000);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[0] - 0) < 1e-6, `out[0]=${out[0]}`);
  assert.ok(Math.abs(out[1] - 1) < 1e-6, `out[1]=${out[1]}`);
});

test('downsampleTo16k passes 16 kHz audio through untouched', () => {
  const src = new Float32Array([0.1, -0.2, 0.3]);
  const out = downsampleTo16k(src, 16000);
  assert.deepEqual(Array.from(out), Array.from(src));
});

test('downsampleTo16k handles 48 kHz (common mic rate)', () => {
  const src = new Float32Array(4800); // 100 ms at 48 kHz
  const out = downsampleTo16k(src, 48000);
  assert.equal(out.length, 1600); // 100 ms at 16 kHz
});

test('floatTo16BitPCM clamps and scales to int16 range', () => {
  const out = floatTo16BitPCM(new Float32Array([0, 1, -1, 2, -2, 0.5]));
  assert.deepEqual(Array.from(out), [0, 32767, -32768, 32767, -32768, 16384]);
});

test('base64FromBytes round-trips through atob', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  const s = base64FromBytes(bytes);
  assert.equal(typeof s, 'string');
  const back = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  assert.deepEqual(Array.from(back), Array.from(bytes));
});

test('encodeMicFrame emits base64 16-bit PCM at 16 kHz', () => {
  // 250 ms of synthetic audio at 48 kHz -> 4000 int16 samples -> 8000 bytes.
  const frame = new Float32Array(12000).map((_, i) => Math.sin(i * 0.1) * 0.5);
  const t0 = Date.now();
  const b64 = encodeMicFrame(frame, 48000);
  const ms = Date.now() - t0;
  assert.equal(typeof b64, 'string');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  assert.equal(bytes.length, 8000, `expected 8000 bytes, got ${bytes.length}`);
  assert.ok(ms < 200, `encode took ${ms} ms — must stay far under the 250 ms frame budget`);
});

test('encodeMicFrame is fast enough to keep up with realtime mic frames', () => {
  // Worst case the relay sees: a full 250 ms frame every 250 ms. Encoding must
  // cost a small fraction of that, or frames queue up and interim latency
  // drifts. 50 iterations must finish comfortably inside one frame budget.
  const frame = new Float32Array(12000).map((_, i) => Math.sin(i * 0.05));
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) encodeMicFrame(frame, 48000);
  const ms = Date.now() - t0;
  assert.ok(ms < 250, `50 frames encoded in ${ms} ms — exceeds a single 250 ms frame budget`);
});
