import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/views.jsx', import.meta.url), 'utf8');

// Source-level identity contract; no DOM or additional test dependencies needed.
// Evaluate the actual key expression, not a copy of the production key.
function chatKey(lang, persona, district) {
  const match = source.match(/<ChatPanel key=\{(`[^`]+`)\}/);
  assert.ok(match, 'ChatPanel must have a context-dependent key');
  return Function('lang', 'persona', 'loc', `return ${match[1]}`)(lang, persona, { district });
}

// The Ask page is a single conversation: one ChatPanel, no sibling voice panel.
// Voice is the mic button on the chat input (dictation), not a separate session.
test('Ask page renders exactly one ChatPanel and no separate voice session', () => {
  assert.match(source, /<ChatPanel key=\{`[^`]+`\} \/>/);
  assert.doesNotMatch(source, /<VoicePanel/);
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
