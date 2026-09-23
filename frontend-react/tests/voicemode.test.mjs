// Hands-free voice mode tests (Workstream D, 2026-09-23).
//
// VoiceMode.jsx adds the continuous STT → ask → TTS → auto-listen loop on
// top of the dictation-only voice that exists today. Components are asserted
// as source text (the repo's convention: JSX never runs under plain node).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import vm from '../src/strings/areas/voicemode.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const src = () => read('../src/components/VoiceMode.jsx');
const css = () => read('../src/components/VoiceMode.css');
const chat = () => read('../src/components/HomeChat.jsx');
const strs = () => read('../src/strings/areas/voicemode.js');

const TAMIL = /[\u0B80-\u0BFF]/;
const REQUIRED = [
  'vmEntry', 'vmTitle', 'vmListening', 'vmThinking', 'vmSpeaking',
  'vmTapToStart', 'vmTapToRetry', 'vmContinue', 'vmStop', 'vmClose',
  'vmNoHear', 'vmError', 'vmOffline', 'vmSoundOff', 'vmHint', 'vmAnswerLabel',
];

// --- strings: EN/HI/TE parity, no Tamil --------------------------------------
test('voicemode.js: all keys present in EN/HI/TE with key parity', () => {
  for (const lang of ['en', 'hi', 'te']) {
    for (const k of REQUIRED) {
      assert.ok(typeof vm[lang][k] === 'string' && vm[lang][k].length > 0, `missing ${lang}:${k}`);
    }
  }
  const sets = ['en', 'hi', 'te'].map((l) => Object.keys(vm[l]).sort().join(','));
  assert.equal(sets[0], sets[1], 'en/hi key mismatch');
  assert.equal(sets[1], sets[2], 'hi/te key mismatch');
});

test('voicemode.js: no Tamil script anywhere', () => {
  for (const lang of ['en', 'hi', 'te']) {
    for (const [k, v] of Object.entries(vm[lang])) {
      assert.ok(!TAMIL.test(v), `Tamil script in ${lang}:${k}`);
    }
  }
});

test('voicemode.js: English labels are sentence case, never all-caps', () => {
  // Only English has case; Devanagari and Telugu have no upper/lower case,
  // so the check applies to en alone.
  for (const [k, v] of Object.entries(vm.en)) {
    assert.notEqual(v, v.toUpperCase(), `en:${k} must not be ALL CAPS`);
  }
});

// --- the ask call: exactly HomeChat's path -----------------------------------
test('VoiceMode reuses the exact HomeChat ask call (body fields, chatStream, chat fallback)', () => {
  const s = src();
  // Same body shape HomeChat's ask() builds: loc/lang/persona context.
  assert.match(s, /message:\s*q/, 'body carries message: q');
  assert.match(s, /latitude:\s*loc && loc\.lat/, 'body carries latitude: loc && loc.lat');
  assert.match(s, /longitude:\s*loc && loc\.lon/, 'body carries longitude: loc && loc.lon');
  assert.match(s, /language:\s*lang/, 'body carries language: lang');
  assert.match(s, /user_type:\s*persona \|\| 'general'/, 'body carries user_type: persona || general');
  // Same transport: injected onAsk contract, else chatStream with chat fallback.
  assert.match(s, /if \(onAsk\)/, 'injected onAsk path kept');
  assert.match(s, /apiClient\.chatStream\(body/, 'default path streams via apiClient.chatStream(body, …)');
  assert.match(s, /apiClient\.chat\(body\)/, 'chatStream failure falls back to apiClient.chat(body)');
});

test('VoiceMode funnels the answer through the store speak (TTS) path', () => {
  const s = src();
  assert.match(s, /speak\(sanitizeForTTS\(fullText\)\)/, 'answer is spoken via speak(sanitizeForTTS(fullText))');
  assert.match(s, /useVoiceInput\(lang, handleFinal, handlePartial\)/, 'STT comes from useVoiceInput');
});

// --- the loop and its safety rules -------------------------------------------
test('VoiceMode status words: Listening / Thinking / Speaking', () => {
  const s = src();
  assert.match(s, /vmListening/, 'Listening status word wired');
  assert.match(s, /vmThinking/, 'Thinking status word wired');
  assert.match(s, /vmSpeaking/, 'Speaking status word wired');
  assert.match(s, /role="status" aria-live="polite"/, 'status word is announced');
});

test('VoiceMode auto-loops only on success: speech end re-listens, errors never do', () => {
  const s = src();
  assert.match(s, /phase !== 'speaking'\) return;/, 'auto-loop effect is gated on the speaking phase');
  assert.match(s, /if \(speechState === 'idle'\) startListen\(\);/, 'speech end → auto-listen again');
  assert.match(s, /never an auto-loop/i, 'safety rule is documented');
  assert.match(s, /setPhase\('error'\)/, 'errors park on the error phase');
  assert.match(s, /shownPhase === 'error'[\s\S]*onClick=\{start\}/, 're-listen happens only on a user tap');
});

test('VoiceMode: a single Stop control is always visible; Escape closes', () => {
  const s = src();
  assert.match(s, /className="vm-stop" onClick=\{handleStop\}/, 'Stop control always rendered');
  assert.match(s, /e\.key === 'Escape'.*handleStop/, 'Escape closes the overlay');
  assert.match(s, /stopSpeaking\(\)/, 'Stop halts TTS');
});

test('VoiceMode respects sound-off: answers as text, no auto-loop', () => {
  const s = src();
  assert.match(s, /localStorage\.getItem\('wgpt\.sound'\) === '0'/, 'reads the store wgpt.sound contract');
  assert.match(s, /setPhase\('soundoff'\)/, 'sound-off parks on the text-only phase');
  assert.match(s, /vmSoundOff/, 'sound-off explanation string wired');
  assert.match(s, /vmContinue/, 'sound-off offers a tap-to-continue, never an auto-loop');
});

test('VoiceMode offline honesty: explains it cannot fetch answers, offers nothing fake', () => {
  const s = src();
  assert.match(s, /vmOffline/, 'offline explanation string wired');
  assert.match(s, /netState !== 'live'\) \{ setPhase\('offline'\)/, 'offline parks the loop');
  assert.doesNotMatch(s, /answerOffline|enqueueOffline/, 'no fake/queued answer is offered in voice mode');
});

test('VoiceMode is a proper dialog with the live transcript line', () => {
  const s = src();
  assert.match(s, /role="dialog" aria-modal="true"/, 'overlay is a modal dialog');
  assert.match(s, /className="vm-transcript" aria-live="polite"/, 'live transcript line announced');
  assert.doesNotMatch(s, /role="log"/, 'no duplicate chat-log role in the overlay');
});

// --- Harbour Signal dressing --------------------------------------------------
test('VoiceMode.css: paper + 2px ink borders + 44px touch targets', () => {
  const c = css();
  assert.match(c, /border: 2px solid var\(--ink\)/, 'Harbour Signal 2px ink borders');
  assert.match(c, /var\(--paper\)/, 'warm paper surface');
  assert.match(c, /var\(--card\)/, 'white cards');
  assert.match(c, /min-height: 44px/, '44px minimum touch targets');
  assert.match(c, /vm-overlay/, 'overlay class exists');
  assert.match(c, /prefers-reduced-motion/, 'reduced motion honoured');
});

// --- HomeChat: entry button only ----------------------------------------------
test('HomeChat gains a Voice mode entry button and nothing else structural', () => {
  const h = chat();
  assert.match(h, /import VoiceMode from '\.\/VoiceMode';/, 'VoiceMode imported');
  assert.match(h, /className="hc-vm-btn"[\s\S]*?t\(lang, 'vmEntry'\)/, 'entry button carries icon + word');
  assert.match(h, /<VoiceMode/, 'VoiceMode mounts from HomeChat');
  assert.match(h, /netState=\{netState\}/, 'netState passed through');
  assert.match(h, /api=\{apiClient\}/, 'same api client passed through');
  // No restructure: the existing contracts are untouched.
  assert.match(h, /className="hc-composer" data-tour="home-chat"/, 'composer tour hook untouched');
  assert.match(h, /className="hc is-hero"/, 'hero treatment untouched');
});

// --- no new chrome strings leak into the shared dictionary --------------------
test('all new voice-mode copy lives in areas/voicemode.js', () => {
  const s = strs();
  const j = src();
  const h = chat();
  for (const k of REQUIRED) {
    assert.match(s, new RegExp(k), `${k} defined in the area file`);
    // vmEntry is the entry-button label and lives in HomeChat; the rest are
    // referenced from the overlay itself.
    const ref = k === 'vmEntry' ? h : j;
    assert.ok(ref.includes(`'${k}'`), `${k} referenced from ${k === 'vmEntry' ? 'HomeChat' : 'VoiceMode'}`);
  }
});
