// Admin gating regression tests (source-level).
//
// The admin console is team-only: it must not appear in any public nav, and
// ?view=admin must stop at a PIN gate. The gate is a demo gate, not
// authentication — the real protection stays server-side (DEMO_MODE-gated
// demo endpoints).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// --- hidden from every public nav ------------------------------------------
// IA dedup (2026-09-20): the rail renders PRIMARY_VIEWS (home/alerts/advisory)
// plus MORE_ROWS filtered by HIDDEN_VIEWS — admin is in neither.
test('rail nav filters out HIDDEN_VIEWS', () => {
  const code = read('../src/components/Shell.jsx');
  assert.match(code, /HIDDEN_VIEWS/, 'Shell must import HIDDEN_VIEWS');
  assert.ok(
    /PRIMARY_VIEWS\.map/.test(code) && /MORE_ROWS\.filter\(\(r\) => !HIDDEN_VIEWS\.includes\(r\.view\)\)/.test(code),
    'rail nav must exclude hidden views',
  );
});

test('mobile More sheet filters out HIDDEN_VIEWS', () => {
  const code = read('../src/components/Shell.jsx');
  assert.match(
    code,
    /MORE_ROWS\.filter\(\(r\) => !HIDDEN_VIEWS\.includes\(r\.view\)\)\.map/,
    'More sheet must exclude hidden views',
  );
});

test('admin is declared a hidden view', () => {
  const code = read('../src/i18n.js');
  assert.match(code, /HIDDEN_VIEWS = \['admin'\]/, 'admin must stay in HIDDEN_VIEWS');
});

// --- PIN gate on the admin view --------------------------------------------
test('AdminView renders behind AdminGate', () => {
  const code = read('../src/views.jsx');
  assert.match(code, /function AdminGate/, 'AdminGate component must exist');
  assert.match(code, /<AdminGate>/, 'AdminView must wrap its console in AdminGate');
});

test('gate is session-scoped via sessionStorage and has a wrong-PIN path', () => {
  const code = read('../src/views.jsx');
  assert.match(code, /wgpt-admin-ok/, 'gate must use a sessionStorage flag');
  assert.match(code, /sessionStorage\.getItem\(ADMIN_OK_KEY\)/, 'gate must check the flag on mount');
  assert.match(code, /adminGateWrong/, 'gate must show a wrong-PIN message');
  assert.match(code, /role="alert"/, 'wrong-PIN message must be announced');
});

test('PIN is overridable via env with a documented default', () => {
  const code = read('../src/views.jsx');
  assert.match(
    code,
    /import\.meta\.env\.VITE_ADMIN_PIN \|\|/,
    'PIN must be overridable with VITE_ADMIN_PIN',
  );
});

test('gate honesty: comment states it is a demo gate, not authentication', () => {
  const code = read('../src/views.jsx');
  assert.match(code, /DEMO gate, not/, 'gate must document that it is not authentication');
  assert.match(code, /DEMO_MODE-gated/, 'gate must point at the real server-side protection');
});

test('PIN input accepts letters — the default PIN is SAARTHI', () => {
  const code = read('../src/views.jsx');
  assert.ok(
    !/inputMode="numeric"/.test(code),
    'PIN input must not request a numeric keyboard (the PIN contains letters)',
  );
  assert.ok(
    !/\.replace\(\/\\D\/g/.test(code),
    'PIN onChange must not strip non-digit characters',
  );
  assert.match(
    code,
    /replace\(\/\[\^A-Za-z0-9\]\/g/,
    'PIN onChange must keep letters and digits',
  );
});

// --- strings parity ----------------------------------------------------------
test('admin gate strings exist in EN/HI/TE', () => {
  const code = read('../src/strings/areas/harboursignal.js');
  for (const key of ['adminGateTitle', 'adminGateBody', 'adminGatePinLabel', 'adminGateUnlock', 'adminGateWrong']) {
    const hits = code.match(new RegExp(`${key}: '`, 'g')) || [];
    assert.equal(hits.length, 3, `${key} must exist in EN/HI/TE`);
  }
});

// --- leak sweep: admin must be invisible to normal users ---------------------
test('no admin entry in the public More sheet rows', () => {
  const code = read('../src/components/Shell.jsx');
  const rows = code.match(/const MORE_ROWS = \[([\s\S]*?)\];/);
  assert.ok(rows, 'MORE_ROWS must be defined in Shell.jsx');
  assert.ok(!rows[1].includes('admin'), 'the dead admin MORE_ROWS row was removed — admin is HIDDEN_VIEW only');
  // The HIDDEN_VIEWS filter stays as a guard for any future rows.
  assert.match(
    code,
    /MORE_ROWS\.filter\(\(r\) => !HIDDEN_VIEWS\.includes\(r\.view\)\)\.map/,
    'More sheet filter must remain even after the row removal',
  );
});

test('demo banner never names or shows on the admin route', () => {
  const code = read('../src/components/Shell.jsx');
  const bannerViews = code.match(/const demoBannerViews = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(bannerViews, 'demoBannerViews set must exist');
  assert.ok(!bannerViews[1].includes('admin'), 'demo banner must not show on admin');
});

test('onboarding tour never steps toward admin', () => {
  const code = read('../src/components/OnboardingTour.jsx');
  assert.ok(!code.match(/view:\s*['"]admin['"]/), 'tour steps must not navigate to admin');
  assert.ok(!/admin/i.test(code), 'tour code must not mention admin at all');
});

test('tour copy never mentions the admin path', () => {
  const code = read('../src/i18n.js');
  for (const key of ['obt1t', 'obt1b', 'obt2t', 'obt2b', 'obt3t', 'obt3b', 'obt4t', 'obt4b', 'obt5t', 'obt5b', 'obt6t', 'obt6b']) {
    const hits = code.match(new RegExp(`${key}: '([^']*)'`, 'g')) || [];
    assert.ok(hits.length >= 3, `tour string ${key} should exist across languages`);
    for (const h of hits) {
      assert.ok(!/admin|PIN|team-only/i.test(h), `tour string ${key} must not mention admin: ${h.slice(0, 60)}`);
    }
  }
});

test('admin URL hints appear only in comments, never in user-visible strings', () => {
  const shell = read('../src/components/Shell.jsx');
  const store = read('../src/store.jsx');
  const app = read('../src/App.jsx');
  const views = read('../src/views.jsx');
  for (const [name, code] of [['Shell.jsx', shell], ['store.jsx', store], ['App.jsx', app], ['views.jsx', views]]) {
    const stripped = code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!stripped.includes('view=admin'), `${name}: ?view=admin must not appear outside comments`);
  }
});

test('public web assets expose no admin route', () => {
  const manifest = read('../public/manifest.webmanifest');
  assert.ok(!/admin/i.test(manifest), 'manifest must not reference admin');
  // manifest shortcut entries would leak the route to the OS launcher
  assert.ok(!/shortcut/i.test(manifest), 'manifest must not ship shortcuts pointing at admin');
});
