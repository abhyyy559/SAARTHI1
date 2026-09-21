import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import tour from '../src/strings/areas/tour.js';

const TAMIL = /[\u0B80-\u0BFF]/;
const REQUIRED = [
  'ot1t', 'ot1b', 'ot2t', 'ot2b', 'ot3t', 'ot3b', 'ot4t', 'ot4b',
  'ot5t', 'ot5b', 'ot5cta', 'ot5on', 'ot5inapp',
];

test('tour.js: all five steps present in EN/HI/TE with key parity', () => {
  for (const lang of ['en', 'hi', 'te']) {
    for (const k of REQUIRED) {
      assert.ok(typeof tour[lang][k] === 'string' && tour[lang][k].length > 0, `missing ${lang}:${k}`);
    }
  }
  const sets = ['en', 'hi', 'te'].map((l) => Object.keys(tour[l]).sort().join(','));
  assert.equal(sets[0], sets[1], 'en/hi key mismatch');
  assert.equal(sets[1], sets[2], 'hi/te key mismatch');
});

test('tour.js: no Tamil script anywhere', () => {
  for (const lang of ['en', 'hi', 'te']) {
    for (const [k, v] of Object.entries(tour[lang])) {
      assert.ok(!TAMIL.test(v), `Tamil script in ${lang}:${k}`);
    }
  }
});

test('tour.js: step-5 copy matches the current 5-step tour (not the stale 4-step one)', () => {
  // The old 4-step tour.js said "Your sky, right now" — the current tour's
  // step 1 is the safety verdict. If the stale copy comes back, this fails.
  assert.ok(!tour.en.ot1t.includes('sky'), 'stale tour copy detected');
  assert.equal(tour.en.ot5cta, 'Allow notifications');
  assert.equal(tour.hi.ot5cta, 'नोटिफिकेशन की अनुमति दें');
  assert.equal(tour.te.ot5cta, 'నోటిఫికేషన్లను అనుమతించండి');
});

test('OnboardingTour renders only ot* keys that tour.js defines', () => {
  const src = readFileSync(new URL('../src/components/OnboardingTour.jsx', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/t\(lang,\s*'(ot[A-Za-z0-9]+)'\)/g)].map((m) => m[1]);
  assert.ok(keys.length > 0, 'expected ot* references in the tour');
  const missing = [...new Set(keys)].filter((k) => !tour.en[k]);
  assert.deepEqual(missing, [], `tour references missing strings: ${missing.join(', ')}`);
});

test('OnboardingTour keeps the deep-link guard (no regression)', () => {
  const src = readFileSync(new URL('../src/components/OnboardingTour.jsx', import.meta.url), 'utf8');
  // A launch URL naming a view (?view= / #view=) must win over first-run auto-start.
  assert.ok(src.includes("has('view')"), 'checks ?view= before auto-starting');
  assert.ok(src.includes("includes('view=')"), 'checks #view= before auto-starting');
  assert.ok(src.includes('wgpt-onboarded'), 'marks the tour seen');
  assert.ok(src.includes("window.addEventListener('wgpt:tour'"), 'replay event still wired');
});
