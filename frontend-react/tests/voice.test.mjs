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

// --- latency assertions (Crew C) --------------------------------------------
// The TTS pipeline overlaps synthesis with playback: the first chunk must be
// small enough to synthesize fast, and chunking a full answer must itself be
// instant (it runs on the critical path before the first provider call).

test('chunking a full-length answer is instant (not on the latency path)', () => {
  const answer = Array.from({ length: 20 }, (_, i) =>
    `Sentence ${i} carries realistic answer text about the weather situation and what the current conditions mean for the district.`).join(' ');
  const t0 = Date.now();
  const chunks = splitSpeakChunks(answer);
  const ms = Date.now() - t0;
  assert.ok(chunks.length >= 2);
  assert.ok(ms < 500, `chunking ${answer.length} chars took ${ms} ms`);
});

test('first chunk of a long answer stays small for fast first-audio', () => {
  // Mirrors the backend's adaptive first chunk (220 chars): playback of chunk
  // 1 starts while chunk 2+ synthesize, so the first chunk is what the
  // < 2 s first-audio budget is measured against.
  const answer = Array.from({ length: 10 }, (_, i) =>
    `Point ${i}: the forecast shows conditions worth noting for your area today.`).join(' ');
  const chunks = splitSpeakChunks(answer, 220);
  assert.ok(chunks.length >= 2, 'long answer must chunk');
  assert.ok(chunks[0].length <= 220, `first chunk ${chunks[0].length} chars — too big for fast first audio`);
  // No words lost across the re-chunk.
  assert.equal(chunks.join(' ').split(/\s+/).length, answer.split(/\s+/).length);
});
