// Regression tests for the October 2026 bug sweep (frontend half).
//
// Pure modules are imported through a data URL, the same way the other
// suites load alertWatch.js and inboxLogic.js; JSX-only code is checked at
// the source level, like the rest of this directory.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const load = (p) => import(`data:text/javascript;base64,${Buffer.from(read(p)).toString('base64')}`);

const { transitionInDistrict } = await load('../src/alertWatch.js');
const { alertState, isPastAlert } = await load('../src/components/inboxLogic.js');

// --- notifications never compare two different districts ---------------------
const HIGH = { level: 'HIGH', confirmed: true, basis: 'cap_alert', severity: 'ORANGE', hazard: 'Cyclone' };
const CALM = { level: 'LOW', confirmed: true, basis: 'none', severity: 'GREEN', hazard: null };

test('switching district is not "the warning ended" (or "started")', () => {
  // Visakhapatnam under ORANGE, then the user switches to calm Chennai.
  assert.equal(transitionInDistrict({ verdict: HIGH, district: 'Visakhapatnam' }, CALM, 'Chennai'), null);
  assert.equal(transitionInDistrict({ verdict: CALM, district: 'Chennai' }, HIGH, 'Visakhapatnam'), null);
});

test('within one district the transitions still fire', () => {
  assert.equal(transitionInDistrict({ verdict: HIGH, district: 'Chennai' }, CALM, 'Chennai').kind, 'clear');
  assert.equal(transitionInDistrict({ verdict: CALM, district: 'Chennai' }, HIGH, 'Chennai').kind, 'start');
  assert.equal(transitionInDistrict(null, HIGH, 'Chennai'), null, 'first sighting stays quiet');
});

test('HomeHero publishes only a verdict fetched for the district on screen', () => {
  const hero = read('../src/components/HomeHero.jsx');
  assert.match(hero, /setWarnFor\(loc\.district\)/);
  assert.match(hero, /if \(verdict && warnFor === loc\.district\) publishVerdict\(verdict, loc\.district\)/);
  const store = read('../src/store.jsx');
  assert.match(store, /transitionInDistrict\(prevVerdict\.current, verdict, district\)/);
  assert.match(store, /prevVerdict\.current = \{ verdict, district \}/);
});

// --- official alerts are not "Upcoming" -----------------------------------------
const NOW = Date.parse('2026-10-10T12:00:00+05:30');
const iso = (h) => new Date(NOW + h * 3600e3).toISOString();

test('an official alert inside its validity window is ACTIVE, not UPCOMING', () => {
  assert.equal(alertState({ source: 'NDMA-Sachet-CAP', sent: iso(-2), expires: iso(4) }, NOW), 'ACTIVE');
  assert.equal(alertState({ source: 'IMD', valid_until: iso(4) }, NOW), 'ACTIVE');
  assert.equal(alertState({ source: 'NDMA-Sachet-CAP' }, NOW), 'ACTIVE', 'no window: in force, never upcoming');
});

test('an expired official bulletin is past; an onset in the future is upcoming', () => {
  assert.equal(alertState({ expires: iso(-1) }, NOW), 'ENDED');
  assert.equal(isPastAlert({ expires: iso(-1) }, NOW), true);
  assert.equal(alertState({ onset: iso(2), expires: iso(8) }, NOW), 'UPCOMING');
});

test('demo alerts keep their own state; CANCELLED is past', () => {
  assert.equal(alertState({ id: 'demo-1', state: 'pre-alert', expires: iso(-5) }, NOW), 'PRE-ALERT');
  assert.equal(isPastAlert({ state: 'CANCELLED' }, NOW), true);
  assert.equal(isPastAlert({ state: 'ENDED' }, NOW), true);
  assert.equal(isPastAlert({ state: 'ACTIVE', expires: iso(-5) }, NOW), false, 'the store state wins');
});

test('every alert surface uses the shared lifecycle helper', () => {
  assert.match(read('../src/components/AlertDetails.jsx'), /const state = alertState\(alert\)/);
  assert.match(read('../src/components/AlertsList.jsx'), /const isEndedAlert = \(a\) => isPastAlert\(a, nowMs\)/);
  assert.match(read('../src/components/Home.jsx'), /const endedState = \(a\) => isPastAlert\(a\)/);
  assert.match(read('../src/components/DistrictMap.jsx'), /return isPastAlert\(a\)/);
});

// --- Hindi / Telugu avoidance lines reach the Avoid section ----------------------
const advisor = read('../src/components/Advisor.jsx');
const AVOID_RE = new Function(
  `${advisor.slice(advisor.indexOf('const EDGE_L'), advisor.indexOf('export function splitDoAvoid'))}; return AVOID_RE;`,
)();

test('avoidance words match in English, Hindi and Telugu', () => {
  for (const s of [
    'Avoid waterlogged roads and low-lying areas.',
    'जलभराव वाली सड़कों और निचले इलाकों से बचें।',
    'चेतावनी के चरम समय में ज़रूरी नहीं यात्रा टालें।',
    'నీటిలో వాహనం నడపవద్దు.',
    'అవసరం లేని ప్రయాణాన్ని వాయిదా వేయండి',
  ]) assert.ok(AVOID_RE.test(s), s);
});

test('ordinary instructions stay in "Do this now"', () => {
  for (const s of [
    'Follow local authority instructions.',
    'स्थानीय प्रशासन के निर्देशों का पालन करें।', // contains "न करें" inside "पालन करें"
    'స్థానిక అధికారుల సూచనలు పాటించండి.',
  ]) assert.ok(!AVOID_RE.test(s), s);
});

// --- offline questions replay one at a time ---------------------------------------
test('queued offline questions replay sequentially, not on a timer', () => {
  const chat = read('../src/components/HomeChat.jsx');
  assert.match(chat, /await ask\(q\[i\]\.text, \{ live: true \}\)/, 'each turn finishes before the next');
  assert.doesNotMatch(chat, /setTimeout\(next, 1200\)/, 'the fixed timer aborted the previous answer');
  const replay = chat.slice(chat.indexOf('const replay = async'), chat.indexOf('const tId = setTimeout(replay'));
  assert.match(replay, /clearQueue\(\)/, 'the queue is cleared when the replay starts, not before');
  assert.match(replay, /queueQuery\(item\)/, 'an interrupted replay re-queues what is left');
});

// --- the overlay admits only what the Alerts view lists --------------------------
test('alert overlay uses the Alerts view admission rules', () => {
  const overlay = read('../src/components/AlertOverlay.jsx');
  assert.match(overlay, /a\.official === false/, 'third-party alerts never reach the pill');
  assert.match(overlay, /d\.verified && d\.verified\.verified/, 'an unvalidated IMD warning is not announced');
});

// --- the weather card never turns "no reading" into zero ---------------------------
const card = read('../src/components/WeatherCard.jsx');
const block = (start, end) => card.slice(card.indexOf(start), card.indexOf(end, card.indexOf(start)));
const { compassPoint, finiteNum } = new Function(
  `${block('const COMPASS', '// Condition word')}\n${block('function finiteNum', 'export default function WeatherCard')}\n`
  + 'return { compassPoint, finiteNum };',
)();

test('missing readings stay missing on the weather card', () => {
  assert.equal(finiteNum(null), null, 'Number(null) is 0 — a missing temperature read as 0°');
  assert.equal(finiteNum(undefined), null);
  assert.equal(finiteNum(''), null);
  assert.equal(finiteNum(0), 0, 'a real zero is still a reading');
  assert.equal(finiteNum('12.5'), 12.5);
  assert.equal(compassPoint(null), null, 'no direction must not render as "N · 0°"');
  assert.equal(compassPoint(undefined), null);
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(90), 'E');
  assert.equal(compassPoint(-90), 'W');
});

// --- screens that wait on outside sources get a realistic timeout ---------------
test('weather, warnings and advice calls wait long enough for outside sources', () => {
  const api = read('../src/api.js');
  assert.match(api, /UPSTREAM_TIMEOUT_MS = 15000/);
  for (const call of ['current: (lat, lon) => up(', 'forecast: (lat, lon) => up(',
    'warnings: (district, lat, lon) =>\n    up(', 'advisoryCards: (loc, persona, language) => up(']) {
    assert.ok(api.replace(/\r\n/g, '\n').includes(call), call);
  }
  assert.match(api, /chat: \(body\) => post\(`\$\{V\}\/chat`, body, CHAT_TIMEOUT_MS\)/);
});

// --- the Home safety box names the source that answered --------------------------
test('home safety box does not stamp UNAVAILABLE over a live SACHET answer', () => {
  const hero = read('../src/components/HomeHero.jsx');
  assert.match(hero, /\.find\(\(p\) => p && p !== 'UNAVAILABLE' && p !== 'UNCONFIGURED'\)/);
});

// --- QR sharing works for alerts without an id -----------------------------------
test('QR picker lists alerts that carry no id (IMD warning, empty SACHET id)', () => {
  const relay = read('../src/components/QrRelay.jsx');
  const fn = relay.slice(relay.indexOf('function alertId'), relay.indexOf('export default function QrRelay'));
  const alertId = new Function(`${fn}; return alertId;`)();
  assert.ok(alertId({ source: 'IMD', hazard: 'Thunderstorm', message: 'Storm likely', issued_at: 'x' }));
  assert.equal(alertId({ identifier: 'cap-1' }), 'cap-1');
  assert.notEqual(alertId({ hazard: 'Rain' }), alertId({ hazard: 'Heat' }));
  assert.doesNotMatch(relay, /filter\(\(a\) => a && \(a\.id \|\| a\.alert_id \|\| a\.identifier\)\)/);
});

// --- offline guidance keeps every language it has fetched -------------------------
test('guidance cache merges languages instead of overwriting them', () => {
  const offline = read('../src/offline.js');
  assert.match(offline, /saveCache\('guidance', \{ \.\.\.prev, \.\.\.all \}\)/);
});
