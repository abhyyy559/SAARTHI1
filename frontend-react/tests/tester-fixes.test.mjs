// Tester-fix contracts (integration, 2026-09-21).
//
// The independent E2E tester returned FAIL on five items; these tests lock the
// fixes so no worker merge can silently regress them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const store = () => read('../src/store.jsx');
const views = () => read('../src/views.jsx');
const shell = () => read('../src/components/Shell.jsx');
const list = () => read('../src/components/AlertsList.jsx');
const panel = () => read('../src/components/NotificationsPanel.jsx');

// --- 1. Toast wiring: the store's showToast must reach a renderer --------------
test('store showToast dispatches wgpt:toast so Shell actually renders it', () => {
  const s = store();
  // The bug: showToast only set store state, which no component reads — the
  // permission-denied feedback was silent ("button does nothing" again).
  assert.match(
    s,
    /showToast[\s\S]{0,400}?dispatchEvent\(new CustomEvent\('wgpt:toast'/,
    'showToast must dispatch the wgpt:toast DOM event Shell listens for'
  );
});

// --- 2. Test push can deep-link to a real alert ---------------------------------
test('sendTestPush carries the selected alert id to /api/push/test', () => {
  const s = store();
  assert.match(
    s,
    /if \(selectedAlert && selectedAlert\.id\) body\.alert_id = selectedAlert\.id/,
    'the test push must carry alert_id when an alert is selected'
  );
});

// --- 4a. No duplicate rows: warning unshift must dedup against cap_alerts ------
test('AlertsList dedups the headline warning against cap_alerts', () => {
  const l = list();
  assert.match(l, /seenIds/, 'a dedup set must guard the official list');
  assert.match(
    l,
    /a\.id \|\| a\.identifier \|\| a\.headline/,
    'dedup keys on the alert identity'
  );
});

// --- 4b. Ended alerts get their own honest section ------------------------------
test('ended alerts render under Past alerts, not Emergency alerts', () => {
  const l = list();
  assert.match(l, /isEndedAlert/, 'an ended predicate must partition the list');
  assert.match(l, /alertsPastTitle/, 'the past section must use its own i18n title');
  assert.match(l, /renderRows\(endedAlerts\)/, 'ended alerts render in the past section');
  assert.match(l, /renderRows\(activeAlerts\)/, 'active alerts stay in the emergency section');
  const i18n = read('../src/i18n.js');
  const hits = i18n.match(/alertsPastTitle: '/g) || [];
  assert.equal(hits.length, 3, 'alertsPastTitle must exist in en, hi and te');
});

// --- 5. Home has exactly one h1: Ask's -------------------------------------------
test('HomeView renders no ViewHead — Ask owns the single h1', () => {
  const v = views();
  const homeView = v.slice(v.indexOf('export function HomeView'));
  const homeViewEnd = homeView.indexOf('export function AlertsView');
  const body = homeView.slice(0, homeViewEnd);
  assert.doesNotMatch(body, /ViewHead/, 'HomeView must not render ViewHead (second h1)');
  assert.match(body, /<Home \/>/, 'HomeView still renders Home');
});

// --- 6b. ?view=notifications opens the panel without event-ordering luck -------
test('Shell opens the panel on view=notifications directly (no race)', () => {
  const s = shell();
  // The bug: NotificationsView fired wgpt:notifications-open in a child effect
  // before Shell attached its listener (child effects run first) — the event
  // was lost and a fresh ?view=notifications load landed on Home, panel closed.
  assert.match(
    s,
    /if \(view === 'notifications'\) \{\s*setPanelOpen\(true\)/,
    'Shell must watch the view directly, independent of event ordering'
  );
});

// --- 6a. Panel comment must not overclaim a URL deep link ------------------------
test('panel openItem comment describes in-app navigation honestly', () => {
  const p = panel();
  assert.doesNotMatch(
    p,
    /deep-links into \?view=alerts/,
    'must not claim a URL deep link it does not perform'
  );
});
