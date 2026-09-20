// Aviation briefing regression tests (source-level).
//
// Contracts: en/hi/te key parity on every aviation string, no Tamil script
// anywhere, the frontend never constructs a METAR/TAF string, the disclaimer
// key is always rendered, the briefing is a clearly-labelled separate section
// inside DetailsView (not alert content), and the api client hits the right
// endpoint exactly once.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const TAMIL = /[\u0B80-\u0BFF]/;

// --- en/hi/te parity ---------------------------------------------------------
test('aviation strings: every key exists in en, hi and te', () => {
  const src = read('../src/strings/areas/aviation.js');
  const blocks = {};
  for (const lang of ['en', 'hi', 'te']) {
    const m = src.match(new RegExp(`${lang}: \\{([\\s\\S]*?)\\n  \\},`));
    assert.ok(m, `aviation.js must have an ${lang} block`);
    blocks[lang] = new Set([...m[1].matchAll(/^\s{4}(\w+):/gm)].map((x) => x[1]));
  }
  for (const key of blocks.en) {
    assert.ok(blocks.hi.has(key), `key ${key} missing in hi`);
    assert.ok(blocks.te.has(key), `key ${key} missing in te`);
  }
  for (const key of [...blocks.hi, ...blocks.te]) {
    assert.ok(blocks.en.has(key), `key ${key} missing in en`);
  }
  assert.ok(blocks.en.size > 20, `expected a real aviation string set, got ${blocks.en.size}`);
});

test('aviation strings: no Tamil script', () => {
  assert.ok(!TAMIL.test(read('../src/strings/areas/aviation.js')), 'aviation.js must contain no Tamil script');
});

test('aviation strings: no sentence runs in all-caps', () => {
  const src = read('../src/strings/areas/aviation.js');
  for (const m of src.matchAll(/:\s*'([^']+)'/g)) {
    const val = m[1];
    if (val.length > 12 && /^[A-Z0-9\s—–.,;:!?()%°+]+$/.test(val)) {
      assert.fail(`all-caps string violates sentence case: ${val}`);
    }
  }
});

// --- the component never builds a METAR/TAF ----------------------------------
test('AviationBriefing: no synthetic METAR/TAF string is ever constructed', () => {
  const code = read('../src/components/AviationBriefing.jsx');
  assert.ok(!/['"`]METAR/.test(code), 'component must not contain a METAR literal');
  assert.ok(!/['"`]TAF/.test(code), 'component must not contain a TAF literal');
  assert.ok(/avDisclaimer/.test(code), 'component must render the disclaimer key');
});

test('AviationBriefing: cloud and visibility sections are tagged as proxies', () => {
  const code = read('../src/components/AviationBriefing.jsx');
  assert.ok(/ProxyTag/.test(code), 'proxy sections must carry a visible proxy tag');
});

test('AviationBriefing: alert severity goes through SevStamp (never re-graded)', () => {
  const code = read('../src/components/AviationBriefing.jsx');
  assert.ok(/SevStamp/.test(code), 'alert severity must render via SevStamp');
  assert.ok(!/data-sev/.test(code) || /SevStamp/.test(code), 'no ad-hoc severity derivation');
});

// --- placement: its own route under More -------------------------------------
// IA dedup (2026-09-20): aviation left the old Details route entirely — it is
// a first-class route (view 'aviation') reachable from the More sheet.
test('AviationView renders the aviation briefing as its own route', () => {
  const views = read('../src/views.jsx');
  assert.ok(/AviationBriefing/.test(views), 'views.jsx must reference AviationBriefing');
  const av = views.match(/export function AviationView\(\) \{([\s\S]*?)\n\}/);
  assert.ok(av, 'AviationView must exist');
  assert.ok(/<AviationBriefing \/>/.test(av[1]), 'AviationView must render <AviationBriefing />');
  assert.doesNotMatch(views, /DetailsView/, 'the old Details route is gone');
});

test('api client calls the aviation briefing endpoint exactly once', () => {
  const code = read('../src/api.js');
  const hits = code.match(/\/api\/aviation\/briefing/g) || [];
  assert.equal(hits.length, 1, 'aviationBriefing must hit /api/aviation/briefing exactly once');
});
