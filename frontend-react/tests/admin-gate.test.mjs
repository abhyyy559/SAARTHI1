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
test('rail nav filters out HIDDEN_VIEWS', () => {
  const code = read('../src/components/Shell.jsx');
  assert.match(code, /HIDDEN_VIEWS/, 'Shell must import HIDDEN_VIEWS');
  assert.match(
    code,
    /NAV\.filter\(\(n\) => !HIDDEN_VIEWS\.includes\(n\.id\)\)\.map/,
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

// --- strings parity ----------------------------------------------------------
test('admin gate strings exist in EN/HI/TE', () => {
  const code = read('../src/strings/areas/harboursignal.js');
  for (const key of ['adminGateTitle', 'adminGateBody', 'adminGatePinLabel', 'adminGateUnlock', 'adminGateWrong']) {
    const hits = code.match(new RegExp(`${key}: '`, 'g')) || [];
    assert.equal(hits.length, 3, `${key} must exist in EN/HI/TE`);
  }
});
