// Alerts redesign (Worker 2) regression tests.
//
// Contracts:
// - EN/HI/TE exact parity for every new alert-redesign string in the
//   clearly-marked ALERTS_REDESIGN block in i18n.js; no Tamil script anywhere.
// - No string area file redefines the new keys (area files win over i18n.js,
//   so a duplicate would silently change shared chrome).
// - The emergency list is emergency-only: AlertsList filters community-
//   provenance items out of the main list and renders them in a separate,
//   honestly-badged COMMUNITY section below it.
// - AlertDetails exports the pure lifecycleDetail helper and renders the
//   full lifecycle (started / completed-or-expected-end / issuer / reason /
//   effects) with an honest "not available" fallback — never a guess.
// - AlertsList (the live verdict surface) renders AlertDetails inline, so the
//   lifecycle has exactly one implementation — Phase 0 (2026-09-21) deleted
//   the dead AlertCenter.jsx that used to share the helper by import.
// - AlertDetails and AlertsList keep no severity math: severity still renders
//   from the backend payload only.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const TAMIL = /[\u0B80-\u0BFF]/;

const i18nSrc = read('../src/i18n.js');
const listSrc = read('../src/components/AlertsList.jsx');
const detailsSrc = read('../src/components/AlertDetails.jsx');
const emgSrc = read('../src/components/Emergency.jsx');

const NEW_KEYS = [
  'detLifecycle', 'detStarted', 'detEndedAt', 'detExpectedEnd', 'detIssuer',
  'detReason', 'detEffects', 'detNotAvailable', 'alertsEmergencyTitle',
  'commSecTitle', 'commSecSub', 'commReportType',
];

// --- string parity ----------------------------------------------------------

test('alerts redesign: ALERTS_REDESIGN block exists with en/hi/te exact parity', () => {
  const m = i18nSrc.match(/const ALERTS_REDESIGN = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'i18n.js must have a clearly-marked ALERTS_REDESIGN block');
  const block = m[1];
  const keys = {};
  for (const lang of ['en', 'hi', 'te']) {
    const lm = block.match(new RegExp(`${lang}: \\{([\\s\\S]*?)\\n  \\},`));
    assert.ok(lm, `ALERTS_REDESIGN must have an ${lang} block`);
    keys[lang] = new Set([...lm[1].matchAll(/^\s{4}(\w+):/gm)].map((x) => x[1]));
  }
  for (const key of NEW_KEYS) {
    for (const lang of ['en', 'hi', 'te']) {
      assert.ok(keys[lang].has(key), `key ${key} missing in ${lang}`);
    }
  }
  assert.deepEqual([...keys.hi].sort(), [...keys.en].sort(), 'hi keys must match en exactly');
  assert.deepEqual([...keys.te].sort(), [...keys.en].sort(), 'te keys must match en exactly');
});

test('alerts redesign: DICT merges the redesign block', () => {
  assert.match(i18nSrc, /ALERTS_REDESIGN\.en/, 'DICT must merge ALERTS_REDESIGN.en');
  assert.match(i18nSrc, /ALERTS_REDESIGN\.hi/, 'DICT must merge ALERTS_REDESIGN.hi');
  assert.match(i18nSrc, /ALERTS_REDESIGN\.te/, 'DICT must merge ALERTS_REDESIGN.te');
});

test('alerts redesign: no string area redefines the new keys', () => {
  const dir = new URL('../src/strings/areas/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = read(`../src/strings/areas/${file}`);
    for (const key of NEW_KEYS) {
      assert.ok(
        !new RegExp(`^\\s*${key}:`, 'm').test(src),
        `${file}: '${key}' would shadow the base dictionary`,
      );
    }
  }
});

test('alerts redesign: no Tamil script in touched files', () => {
  for (const [name, src] of [['AlertsList.jsx', listSrc], ['AlertDetails.jsx', detailsSrc]]) {
    assert.ok(!TAMIL.test(src), `${name} must contain no Tamil script`);
  }
});

// --- emergency list is official-sources-only --------------------------------

test('alerts list: only official sources render — third-party feeds are filtered out', () => {
  assert.match(listSrc, /export function isOfficialSource/, 'AlertsList must export the source guard');
  assert.match(listSrc, /official === false/, 'an explicit backend opt-out always filters the alert');
  // WeatherAPI.com and GDACS feed the verdict engine but must never render
  // here as warnings; the guard names the admission set.
  assert.match(listSrc, /WeatherAPI\.com|GDACS/, 'the guard documents the excluded third-party providers');
  assert.match(listSrc, /SACHET/, 'SACHET is admitted');
  assert.match(listSrc, /IMD/, 'IMD is admitted');
  assert.match(listSrc, /\.filter\(isOfficialSource\)/, 'the merged list is filtered by the source guard');
});

test('alerts list: demo alerts are admitted but always labelled DEMO', () => {
  assert.match(listSrc, /export function isDemoAlert/, 'AlertsList must export the demo guard');
  assert.match(listSrc, /isDemoAlert\(a\) \? t\(lang, 'listDemoTag'\)/, 'demo alerts wear the DEMO chip, never the Official one');
  // Demo-mode warnings payloads are simulated content: every fixture alert
  // is badged DEMO instead of looking official.
  assert.match(listSrc, /responseIsDemo/, 'demo-mode fixture alerts are stamped demo');
});

test('alerts list: community has no place on this page', () => {
  assert.doesNotMatch(listSrc, /community-sec/, 'no community section');
  assert.doesNotMatch(listSrc, /api\.reports\(/, 'community reports are not fetched');
  assert.doesNotMatch(listSrc, /isCommunityItem|REPORT_WORD/, 'the old community plumbing is gone');
});

test('alerts list: main list is headed as emergency alerts', () => {
  assert.match(listSrc, /alertsEmergencyTitle/, 'the main list must be headed "Emergency alerts"');
});

test('alerts list: detail still expands inline with working controls', () => {
  assert.match(listSrc, /<AlertDetails/, 'detail expands inline');
  assert.match(listSrc, /alertsListen/, 'Listen stays working');
});

// --- full lifecycle detail ---------------------------------------------------

test('alert details: exports the pure lifecycleDetail helper', () => {
  assert.match(detailsSrc, /export function lifecycleDetail/, 'lifecycleDetail must be exported for reuse');
  assert.match(detailsSrc, /lifecycle_detail/, "it must read the backend's lifecycle_detail first");
  assert.match(detailsSrc, /not inventing|never a guess|honest/, 'the honesty contract must be documented');
});

test('alert details: renders the full lifecycle with honest fallbacks', () => {
  for (const key of ['detLifecycle', 'detStarted', 'detEndedAt', 'detExpectedEnd', 'detIssuer', 'detReason', 'detEffects', 'detNotAvailable']) {
    assert.match(detailsSrc, new RegExp(`'${key}'`), `AlertDetails must render ${key}`);
  }
});

test('alert details: severity still comes from the backend payload only', () => {
  assert.match(detailsSrc, /const sev = alert\.severity \|\| 'UNKNOWN'/, 'severity is read, never re-derived');
});

test('alerts list: the lifecycle has one implementation, rendered inline', () => {
  // Phase 0 (2026-09-21): the dead AlertCenter.jsx used to import the shared
  // lifecycleDetail helper. The live surface (AlertsList) renders AlertDetails
  // inline instead, so there is exactly one lifecycle implementation and
  // nothing to fork.
  assert.match(listSrc, /<AlertDetails/, 'AlertsList must render AlertDetails inline');
  assert.match(detailsSrc, /export function lifecycleDetail/, 'the helper must stay exported for reuse');
});

test('alert details: acknowledge and timeline keep working', () => {
  assert.match(detailsSrc, /api\.ack/, 'Acknowledge still POSTs');
  assert.match(detailsSrc, /detTimeline/, 'the existing timeline stays');
  assert.match(detailsSrc, /detValidity/, 'validity window stays');
  assert.match(detailsSrc, /detInstruction/, 'instruction stays');
});

test('alert details: no bolt-on widgets — title and full details only', () => {
  // Phase 1 (2026-09-21): the demo P2P relay panel is stripped from alert
  // details. The backend /api/demo/relay endpoint stays; the Alerts page
  // shows title + complete details per alert, nothing more.
  assert.doesNotMatch(detailsSrc, /p2p-panel/, 'no P2P relay panel in details');
  assert.doesNotMatch(detailsSrc, /doRelay|relayState|relayTrace/, 'no relay state machine in details');
  assert.doesNotMatch(detailsSrc, /demoAlertApi/, 'no demo-alerts API import left behind');
});

test('emergency: P2PDemo is gone, SOS arm-then-fire flow untouched', () => {
  // Coordination (Phase 1 Crew H): P2PDemo.jsx is deleted in parallel, so
  // Emergency.jsx must not import or render it — the build would break.
  assert.doesNotMatch(emgSrc, /P2PDemo/, 'no P2PDemo import or render');
  assert.doesNotMatch(emgSrc, /p2p-panel|simulateRelay|p2pState/, 'no relay logic left behind');
  // The SOS send flow keeps working exactly as before.
  assert.match(emgSrc, /is-armed/, 'ARM → SEND sequence intact');
  assert.match(emgSrc, /api\.sos\(/, 'SOS still POSTs');
  assert.match(emgSrc, /api\.inbox\(/, 'session-scoped inbox intact');
  assert.match(emgSrc, /api\.syncEmergency\(/, 'sync button intact');
});
