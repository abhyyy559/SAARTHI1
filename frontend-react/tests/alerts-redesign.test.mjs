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
// - AlertCenter (verdict surface) shares lifecycleDetail instead of growing
//   its own copy.
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
const centerSrc = read('../src/components/AlertCenter.jsx');

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
  for (const [name, src] of [['AlertsList.jsx', listSrc], ['AlertDetails.jsx', detailsSrc], ['AlertCenter.jsx', centerSrc]]) {
    assert.ok(!TAMIL.test(src), `${name} must contain no Tamil script`);
  }
});

// --- emergency list is emergency-only ---------------------------------------

test('alerts list: community items are filtered out of the main list', () => {
  assert.match(listSrc, /isCommunityItem/, 'AlertsList must define the community guard');
  assert.match(listSrc, /\.filter\(\(a\) => !isCommunityItem\(a\)\)/, 'the merged list must drop community items');
});

test('alerts list: community renders in its own honestly-badged section', () => {
  assert.match(listSrc, /commSecTitle/, 'AlertsList must render the community section title');
  assert.match(listSrc, /commSecSub/, 'AlertsList must render the community honesty copy');
  assert.match(listSrc, /community-sec/, 'the section must carry the separator class');
  assert.match(listSrc, /prov COMMUNITY/, 'community rows must carry the machine-readable COMMUNITY badge');
  assert.match(listSrc, /api\.reports\(/, 'the section is fed by the community reports API');
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

test('alert center: shares the lifecycle helper instead of forking it', () => {
  assert.match(centerSrc, /import \{ lifecycleDetail \} from '\.\/AlertDetails'/);
  assert.match(centerSrc, /lifecycleDetail\(a\)/, 'AlertCard must use the shared helper');
});

test('alert details: acknowledge and timeline keep working', () => {
  assert.match(detailsSrc, /api\.ack/, 'Acknowledge still POSTs');
  assert.match(detailsSrc, /detTimeline/, 'the existing timeline stays');
  assert.match(detailsSrc, /detValidity/, 'validity window stays');
  assert.match(detailsSrc, /detInstruction/, 'instruction stays');
});
