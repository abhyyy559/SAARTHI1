import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// IA dedup (2026-09-20): the conversation lives on Home now — the old
// Ask page is gone. The identity contract moved with it to Home.jsx.
const source = readFileSync(new URL('../src/components/Home.jsx', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../src/components/HomeChat.jsx', import.meta.url), 'utf8');

// Source-level identity contract; no DOM or additional test dependencies needed.
// Evaluate the actual key expression, not a copy of the production key.
function chatKey(lang, persona, district) {
  const match = source.match(/<HomeChat[\s\S]*?key=\{(`[^`]+`)\}/);
  assert.ok(match, 'HomeChat must have a context-dependent key');
  return Function('lang', 'persona', 'loc', `return ${match[1]}`)(lang, persona, { district });
}

// Home renders a single conversation: one HomeChat, no sibling voice panel.
// Voice is the mic button on the chat input (dictation), not a separate session.
// (Phase 0, 2026-09-21: the dead ChatPanel.jsx was deleted; this guard stays to
// keep it from being reintroduced under the old name.)
test('Home renders exactly one HomeChat and no separate voice session', () => {
  assert.match(source, /<HomeChat[\s\S]*?\/>/);
  assert.doesNotMatch(source, /<ChatPanel|<VoicePanel/, 'ChatPanel is superseded by HomeChat');
  // The facts-only boundary: HomeChat links out to Advisory, never renders guidance itself.
  assert.doesNotMatch(chat, /<AdviceCards|<Advisor \/>/, 'guidance renders only in the Advisory route');
});

test('Chat identity resets across supported languages and profiles', () => {
  for (const lang of ['en', 'hi', 'te']) {
    for (const persona of ['fisherman', 'farmer', 'general', 'driver']) {
      const key = chatKey(lang, persona, 'Hyderabad');
      assert.equal(key, chatKey(lang, persona, 'Hyderabad'), 'stable for same context');
    }
  }
});

test('Chat identity changes when language, profile or district changes', () => {
  const original = chatKey('en', 'fisherman', 'Hyderabad');
  for (const context of [
    ['hi', 'fisherman', 'Hyderabad'],
    ['en', 'farmer', 'Hyderabad'],
    ['en', 'fisherman', 'Mumbai'],
  ]) {
    assert.notEqual(chatKey(...context), original);
  }
});
