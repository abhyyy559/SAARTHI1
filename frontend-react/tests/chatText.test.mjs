// chatText unit tests: sanitizeForTTS contracts.
//
// sanitizeForTTS is the shared text cleaner for both the screen and TTS:
// markdown artifacts, URLs and emoji are stripped so neither the chat UI nor
// the speaker ever reads them aloud. HomeChat and ChatMessage both reuse
// this module rather than carrying their own copies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeForTTS } from '../src/chatText.js';

test('empty and falsy input returns an empty string', () => {
  assert.equal(sanitizeForTTS(''), '');
  assert.equal(sanitizeForTTS(null), '');
  assert.equal(sanitizeForTTS(undefined), '');
});

test('strips markdown artifacts', () => {
  assert.equal(sanitizeForTTS('# Heading text'), 'Heading text');
  assert.equal(sanitizeForTTS('**bold** and *italic*'), 'bold and italic');
  assert.equal(sanitizeForTTS('`code` sample'), 'code sample');
  assert.equal(sanitizeForTTS('~~strike~~ out'), 'strike out');
  assert.equal(sanitizeForTTS('> quoted line'), 'quoted line');
});

test('strips URLs', () => {
  const out = sanitizeForTTS('See https://example.com/report for details.');
  assert.doesNotMatch(out, /example\.com/, 'URL must be gone');
  assert.match(out, /details/, 'surrounding words must survive');
});

test('strips emoji and decorative unicode', () => {
  const out = sanitizeForTTS('Rain 🌧️ expected ⛈️ today.');
  assert.doesNotMatch(out, /🌧|⛈/, 'emoji must be gone');
  assert.match(out, /Rain/, 'plain words must survive');
});

test('collapses whitespace and trims', () => {
  assert.equal(sanitizeForTTS('  too   much\nspace  '), 'too much space');
});

test('truncates overlong text at a sentence boundary', () => {
  const long = `${'a'.repeat(300)}. ${'b'.repeat(400)}`;
  const out = sanitizeForTTS(long, 350);
  assert.ok(out.length <= 350, `must respect maxChars (got ${out.length})`);
  assert.match(out, /a+/, 'the first sentence must survive');
  assert.ok(out.endsWith('.'), 'truncation should end at a sentence boundary');
});

test('keeps non-Latin scripts intact (EN/HI/TE parity of the pipeline)', () => {
  assert.match(sanitizeForTTS('मौसम साफ है'), /मौसम/);
  assert.match(sanitizeForTTS('వాతావరణం బాగుంది'), /వాతావరణం/);
});

test('long markdown links keep their label text', () => {
  const out = sanitizeForTTS('See [IMD bulletin](https://imd.gov.in/x) for updates.');
  assert.match(out, /IMD bulletin/);
  assert.doesNotMatch(out, /imd\.gov\.in/);
});
