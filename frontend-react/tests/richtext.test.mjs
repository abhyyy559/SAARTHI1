import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/format.js', import.meta.url), 'utf8');
const { formatAnswer } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('headings, bold and lists render; raw HTML is escaped', () => {
  const html = formatAnswer('## Sea advice\nGoa coast is **rough** today.\n\n- Stay ashore\n- Check again at 6 PM\n\n<script>alert(1)</script>');
  assert.match(html, /<h4>Sea advice<\/h4>/);
  assert.match(html, /<strong>rough<\/strong>/);
  assert.match(html, /<ul><li>Stay ashore<\/li><li>Check again at 6 PM<\/li><\/ul>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('plain paragraphs stay readable without markdown', () => {
  const html = formatAnswer('No active warning for Hyderabad.\nSea is far from here.');
  assert.match(html, /<p>No active warning for Hyderabad.<br>Sea is far from here.<\/p>/);
});

test('LLM markdown variants all render: h1-h4, star bullets, numbered lists', () => {
  const html = formatAnswer('### Sea advice\nGoa coast is __rough__ today.\n\n* Stay ashore\n1. Check again at 6 PM\n2. Call `harbour` control\n\n---\nDone.');
  assert.match(html, /<h4>Sea advice<\/h4>/);
  assert.match(html, /<strong>rough<\/strong>/);
  assert.match(html, /<ul><li>Stay ashore<\/li><li>Check again at 6 PM<\/li><li>Call <code>harbour<\/code> control<\/li><\/ul>/);
  assert.doesNotMatch(html, /###|\* Stay|1\. Check|---|__/);
  assert.match(html, /<p>Done.<\/p>/);
});

test('raw ISO timestamps in answers render human-readable, not verbatim', () => {
  const html = formatAnswer('It is valid until 2026-09-20T22:43:00.994242+05:30.');
  assert.doesNotMatch(html, /2026-09-20T22:43/);
  assert.match(html, /20/); // day of month present in locale rendering
});
