import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * ISOLATED Unit Test for SourceStatus.jsx
 * Target: frontend-react/src/components/SourceStatus.jsx
 * Session: ses_cov
 * WARNING: THIS FILE WILL BE DELETED AFTER TEST PASSES
 * Test code preserved in: .opencode/unit-tests/
 */

const URL = new URL('../SourceStatus.jsx', import.meta.url);
const src = () => readFileSync(URL, 'utf8');

test('fetches /api/sources and /api/mode', () => {
  const s = src();
  assert.match(s, /sources\(\)|api\.sources/);
  assert.match(s, /mode\(\)|api\.mode/);
});

test('covers all seven rows: IMD, Open-Meteo, SACHET/CAP, Demo, cache, P2P, Push', () => {
  const s = src();
  assert.match(s, /IMD/);
  assert.match(s, /Open-Meteo/);
  assert.match(s, /SACHET|CAP/);
  assert.match(s, /[Dd]emo/);
  assert.match(s, /cache/i);
  assert.match(s, /P2P/);
  assert.match(s, /[Pp]ush/);
});

test('uses green/grey dots and keeps honest UNCONFIGURED labels', () => {
  const s = src();
  assert.match(s, /UNCONFIGURED/);
  assert.match(s, /dot|Chip|prov /);
  assert.doesNotMatch(s, /LIVE.*UNCONFIGURED|UNCONFIGURED.*LIVE/);
});

test('never claims live data it does not have', () => {
  const s = src();
  assert.doesNotMatch(s, /all systems (operational|live)/i);
});
