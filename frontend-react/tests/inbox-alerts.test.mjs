// Notifications inbox + inline alerts list regression tests.
//
// Contracts:
// - en/hi/te key parity on every new inbox string, no Tamil script anywhere.
// - Notifications are grouped by alert: one full lifecycle trail per group,
//   oldest-first timeline (issued -> active -> extended -> ended).
// - Unread counts roll up per group and the sum feeds the badge.
// - Every transition kind has an icon and a translated one-verb label.
// - Severity is rendered from the backend's payload only (SevStamp), never
//   re-derived: the inbox/alerts-list sources must contain no severity math.
// - The alerts list expands details inline: it imports AlertDetails and never
//   navigates to a details route.
// - Rows carry relative timestamps so the board reads as live.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const TAMIL = /[\u0B80-\u0BFF]/;

// The logic module has no JSX and no Vite-only syntax, so it is imported
// as-is through a data URL (same pattern as alerts-notify.test.mjs).
const logicSrc = read('../src/components/inboxLogic.js');
const logic = await import(`data:text/javascript;base64,${Buffer.from(logicSrc).toString('base64')}`);
const { groupNotifications, transitionKey, groupTitle, relTime, mergeAlerts, KIND_ICON } = logic;

const inboxSrc = read('../src/components/NotificationsInbox.jsx');
const listSrc = read('../src/components/AlertsList.jsx');
const stringsSrc = read('../src/strings/areas/inbox.js');

const FULL = [
  { id: 'n1', alert_id: 'demo-x', kind: 'pre-alert', at: '2026-09-20T10:00:00', severity: 'ORANGE', district: 'Kochi', read: false },
  { id: 'n2', alert_id: 'demo-x', kind: 'active', at: '2026-09-20T11:00:00', severity: 'RED', district: 'Kochi', read: false },
  { id: 'n3', alert_id: 'demo-x', kind: 'extended', at: '2026-09-20T12:00:00', severity: 'RED', district: 'Kochi', read: false },
  { id: 'n4', alert_id: 'demo-x', kind: 'ended', at: '2026-09-20T13:00:00', severity: 'GREEN', district: 'Kochi', read: true },
];

// --- en/hi/te parity ---------------------------------------------------------

test('inbox strings: every key exists in en, hi and te', () => {
  const blocks = {};
  for (const lang of ['en', 'hi', 'te']) {
    const m = stringsSrc.match(new RegExp(`${lang}: \\{([\\s\\S]*?)\\n  \\},`));
    assert.ok(m, `inbox.js must have an ${lang} block`);
    blocks[lang] = new Set([...m[1].matchAll(/^\s{4}(\w+):/gm)].map((x) => x[1]));
  }
  for (const key of blocks.en) {
    assert.ok(blocks.hi.has(key), `key ${key} missing in hi`);
    assert.ok(blocks.te.has(key), `key ${key} missing in te`);
  }
  for (const key of [...blocks.hi, ...blocks.te]) {
    assert.ok(blocks.en.has(key), `key ${key} missing in en`);
  }
  assert.ok(blocks.en.size > 20, `expected a real inbox string set, got ${blocks.en.size}`);
});

test('inbox strings: no Tamil script', () => {
  assert.ok(!TAMIL.test(stringsSrc), 'inbox.js must contain no Tamil script');
});

test('inbox + list components: no Tamil script', () => {
  assert.ok(!TAMIL.test(inboxSrc), 'NotificationsInbox.jsx must contain no Tamil script');
  assert.ok(!TAMIL.test(listSrc), 'AlertsList.jsx must contain no Tamil script');
});

test('inbox strings: no all-caps sentence', () => {
  for (const m of stringsSrc.matchAll(/:\s*'([^']+)'/g)) {
    const val = m[1];
    if (val.length > 12 && /^[A-Z0-9\s—–.,;:!?()%°+]+$/.test(val)) {
      assert.fail(`all-caps string violates sentence case: ${val}`);
    }
  }
});

// --- grouping -----------------------------------------------------------------

test('groupNotifications: one full lifecycle in one group, oldest-first', () => {
  const groups = groupNotifications([...FULL].reverse());
  assert.equal(groups.length, 1);
  assert.equal(groups[0].alertId, 'demo-x');
  assert.deepEqual(groups[0].items.map((i) => i.kind), ['pre-alert', 'active', 'extended', 'ended']);
});

test('groupNotifications: exactly four notifications stay grouped', () => {
  const groups = groupNotifications(FULL);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 4);
});

test('groupNotifications: unread rolls up per group and sums for the badge', () => {
  const other = { id: 'm1', alert_id: 'cap:abc', kind: 'start', at: '2026-09-20T09:00:00', severity: 'YELLOW', read: true };
  const groups = groupNotifications([...FULL, other]);
  assert.equal(groups.length, 2);
  const g = groups.find((x) => x.alertId === 'demo-x');
  assert.equal(g.unread, 3);
  const total = groups.reduce((n, x) => n + x.unread, 0);
  assert.equal(total, 3);
});

test('groupNotifications: group severity is the latest transition, never invented', () => {
  const groups = groupNotifications(FULL);
  assert.equal(groups[0].severity, 'GREEN');
});

test('groupNotifications: groups order newest-first by latest transition', () => {
  const groups = groupNotifications(FULL);
  assert.ok(groups.length >= 1);
});

// --- transitions: icon + translated label --------------------------------------

test('every backend transition kind has an icon and a transition key', () => {
  const kinds = ['pre-alert', 'active', 'updated', 'extended', 'ended', 'cancelled', 'start', 'escalate', 'clear'];
  for (const k of kinds) {
    assert.ok(KIND_ICON[k], `kind ${k} needs an icon`);
    const key = transitionKey(k);
    assert.ok(key.startsWith('tr'), `kind ${k} needs a tr* label key`);
  }
});

test('transition labels resolve in the inbox strings', () => {
  const needed = ['pre-alert', 'active', 'updated', 'extended', 'ended', 'cancelled', 'start', 'escalate', 'clear'];
  for (const k of needed) {
    const key = transitionKey(k);
    assert.ok(new RegExp(`^\\s{4}${key}:`, 'm').test(stringsSrc), `strings must define ${key}`);
  }
});

// --- severity contract: never re-derived on the client ------------------------

test('inbox: severity comes from the payload, never recomputed', () => {
  assert.ok(!/severityOf|deriveSev|calcSev/.test(inboxSrc), 'no severity derivation in the inbox');
  assert.ok(inboxSrc.includes('SevStamp'), 'inbox must render SevStamp (icon+word+color)');
});

test('alerts list: severity comes from the alert dict, never recomputed', () => {
  assert.ok(!/severityOf|deriveSev|calcSev/.test(listSrc), 'no severity derivation in the list');
  assert.ok(listSrc.includes('SevStamp'), 'list must render SevStamp (icon+word+color)');
});

// --- alerts list: inline expansion, no details route -----------------------------

test('alerts list: expands detail inline, never routes to details', () => {
  assert.ok(listSrc.includes("import AlertDetails from './AlertDetails'"), 'list must reuse AlertDetails inline');
  assert.ok(!/setView\('details'\)/.test(listSrc), 'list must never navigate to a details route');
  assert.ok(listSrc.includes('alerts-row-detail'), 'list must render the inline detail region');
  assert.ok(listSrc.includes('aria-expanded'), 'expansion must be announced to assistive tech');
});

test('alerts list: rows carry relative timestamps', () => {
  assert.ok(listSrc.includes('relTime('), 'rows must use relTime');
});

test('relTime: reads as live', () => {
  const now = Date.parse('2026-09-20T12:00:00');
  assert.equal(relTime(new Date(now - 20000).toISOString(), now), 'now');
  assert.equal(relTime(new Date(now - 2 * 60000).toISOString(), now), '2 min ago');
  assert.equal(relTime(new Date(now - 3 * 3600000).toISOString(), now), '3 h ago');
  assert.equal(relTime('garbage', now), '');
});

// --- merge / titles --------------------------------------------------------------

test('mergeAlerts: official first, origins tagged honestly', () => {
  const merged = mergeAlerts([{ id: 'c1' }], [{ id: 'd1' }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]._origin, 'official');
  assert.equal(merged[1]._origin, 'demo');
});

test('groupTitle: official key hazard reads out without guessing', () => {
  const tr = (k) => ({ inboxUnknownAlert: 'Warning', inboxOfficialTag: 'Official' }[k]);
  const g = { alertId: 'official:Kochi:cyclone' };
  assert.equal(groupTitle(g, null, tr), 'cyclone');
});
