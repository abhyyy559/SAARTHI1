import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitSpeakChunks } from '../src/speakChunks.js';

test('packs short sentences into chunks within the limit', () => {
  const chunks = splitSpeakChunks('First sentence here. Second one too. Third as well.');
  assert.ok(chunks.length >= 1);
  for (const c of chunks) assert.ok(c.length <= 450, `chunk too long: ${c.length}`);
  assert.equal(chunks.join(' '), 'First sentence here. Second one too. Third as well.');
});

test('splits multi-sentence text so no chunk exceeds the limit', () => {
  const text = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} carries enough words to push the total length well past the four hundred and fifty character boundary for testing.`).join(' ');
  const chunks = splitSpeakChunks(text);
  assert.ok(chunks.length >= 2, `expected >=2 chunks, got ${chunks.length}`);
  for (const c of chunks) assert.ok(c.length <= 450, `chunk too long: ${c.length}`);
  // No words lost or duplicated.
  assert.equal(chunks.join(' ').split(/\s+/).length, text.split(/\s+/).length);
});

test('hard-splits a single overlong sentence at whitespace', () => {
  const text = `word ${'lorem '.repeat(200).trim()}`;
  const chunks = splitSpeakChunks(text);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(c.length <= 450);
  // Splits are trimmed — no chunk carries leading/trailing whitespace.
  for (const c of chunks) assert.equal(c, c.trim());
  assert.equal(chunks.join(' ').split(/\s+/).length, text.split(/\s+/).length);
});

test('splits on Hindi danda sentence boundaries', () => {
  const text = 'भारी बारिश की चेतावनी है। किसान फसल को सुरक्षित रखें। मछुआरे समुद्र में न जाएँ।';
  const chunks = splitSpeakChunks(text, 30);
  assert.ok(chunks.length >= 2, `expected >=2 chunks, got ${JSON.stringify(chunks)}`);
  for (const c of chunks) assert.ok(c.length <= 30);
});

test('returns the original text wrapped for empty input', () => {
  assert.deepEqual(splitSpeakChunks(''), ['']);
  assert.deepEqual(splitSpeakChunks('   '), ['   ']);
  assert.deepEqual(splitSpeakChunks(null), [null]);
});

test('single short sentence comes back as one chunk', () => {
  assert.deepEqual(splitSpeakChunks('Hello world.'), ['Hello world.']);
});

test('never returns an empty array for non-empty text', () => {
  for (const t of ['a', 'Hello.', 'x'.repeat(1000)]) {
    const chunks = splitSpeakChunks(t);
    assert.ok(chunks.length >= 1);
    assert.ok(chunks.every((c) => c.length > 0));
  }
});

test('respects a custom maxLen', () => {
  const chunks = splitSpeakChunks('One. Two. Three. Four. Five.', 10);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.length <= 10, `chunk too long: ${c}`);
});
