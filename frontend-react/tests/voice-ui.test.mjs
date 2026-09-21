import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolveVoicePopup, shouldUseBrowserStt } from '../src/voiceUi.js';

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

const POPUP_KEYS = ['speaking', 'stop', 'voiceListening', 'voiceTapFinish', 'processing'];

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
