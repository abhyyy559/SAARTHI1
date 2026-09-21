import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import chrome from '../src/strings/areas/chrome.js';

const src = () => readFileSync(new URL('../src/components/LocationPrompt.jsx', import.meta.url), 'utf8');

test('LocationPrompt still hides itself once location is ready', () => {
  assert.ok(src().includes("if (locStatus === 'ready') return null;"), 'ready short-circuit removed?');
});

test('LocationPrompt denied state links to the settings permissions center', () => {
  const s = src();
  assert.ok(s.includes("setView('settings')"), 'no setView(settings) link');
  assert.ok(s.includes('locOpenSettings'), 'no locOpenSettings string reference');
  // The link must only appear for the denied state — a dead re-prompt helps nobody.
  const idx = s.indexOf('locOpenSettings');
  const deniedIdx = s.indexOf("locStatus === 'denied'");
  assert.ok(deniedIdx !== -1 && deniedIdx < idx, 'settings link is not gated on the denied state');
});

test('locOpenSettings exists in EN/HI/TE, no Tamil script', () => {
  const TAMIL = /[\u0B80-\u0BFF]/;
  for (const lang of ['en', 'hi', 'te']) {
    assert.ok(chrome[lang].locOpenSettings, `missing ${lang}:locOpenSettings`);
    assert.ok(!TAMIL.test(chrome[lang].locOpenSettings), `Tamil in ${lang}:locOpenSettings`);
  }
});

test('LocationPrompt keeps manual district fallback and busy states', () => {
  const s = src();
  assert.ok(s.includes('locManualPh'), 'manual district entry removed?');
  assert.ok(s.includes('locLocating') && s.includes('locResolving'), 'busy states removed?');
});
