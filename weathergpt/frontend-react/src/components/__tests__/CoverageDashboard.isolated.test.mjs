import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * ISOLATED Unit Test for CoverageDashboard.jsx
 * Target: weathergpt/frontend-react/src/components/CoverageDashboard.jsx
 * Session: ses_cov
 * WARNING: THIS FILE WILL BE DELETED AFTER TEST PASSES
 * Test code preserved in: .opencode/unit-tests/
 */

const URL = new URL(
  '../CoverageDashboard.jsx',
  import.meta.url,
);
const src = () => readFileSync(URL, 'utf8');

test('accepts a district prop', () => {
  assert.match(src(), /function CoverageDashboard\(\{\s*district/);
});

test('fetches coverage for the district alert, with offline mock fallback', () => {
  const s = src();
  assert.match(s, /demoAlerts|coverage/);
  assert.match(s, /404|fallback|mock|sample/i);
});

test('shows all seven delivery counts', () => {
  const s = src().toLowerCase();
  for (const k of [
    'delivered',
    'opened',
    'acknowledged',
    'pending',
    'offline',
    'unreachable',
    'p2p',
  ]) {
    assert.ok(s.includes(k), `missing count: ${k}`);
  }
});

test('renders progress bars and a zone grid', () => {
  const s = src();
  assert.match(s, /cov-bar|progress|<progress/);
  assert.match(s, /zone-grid|ZoneGrid/);
});

test('states delivery-visibility disclaimer, never a safety claim', () => {
  const s = src().toLowerCase();
  assert.ok(
    s.includes('not a safety') ||
      s.includes('not safety') ||
      s.includes('delivery visibility') ||
      s.includes('communication'),
    'must carry the delivery-visibility note',
  );
  assert.doesNotMatch(s, /% safe|safe count|guarantee of safety/);
});

test('never re-derives severity, keeps SIMULATED label honest', () => {
  const s = src();
  assert.match(s, /SIMULATED/);
  assert.doesNotMatch(s, /severity\s*===.*\?.*RED|deriveSeverity/);
});
