import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/format.js', import.meta.url), 'utf8');
const { formatValidUntil, formatCountdown, minutesSince, isExpired } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// --- severity is server-owned --------------------------------------------

// Comments in format.js explain *why* there is no mapping here, so they mention
// severity constantly. Assert against executable code only.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('no client-side severity mapping exists any more', () => {
  // heroState used to live here. Two views each deriving severity from a
  // different slice of one payload is how the hero card and the alert centre
  // ended up contradicting each other. The mapping is server-side only now
  // (backend/services/verdict_service.py) — this guards against it creeping back.
  assert.doesNotMatch(code, /heroState/);
  assert.doesNotMatch(code, /CRITICAL|MODERATE/);
  assert.doesNotMatch(code, /severity/i);
});

test('HomeHero renders the backend verdict instead of deriving a level', () => {
  // Phase 0 (2026-09-21): HeroCard.jsx was dead code (nothing rendered it;
  // HomeHero.jsx is the live hero). The invariant moves to the live file.
  const hero = readFileSync(new URL('../src/components/HomeHero.jsx', import.meta.url), 'utf8');
  assert.match(hero, /warn\.verdict/, 'HomeHero must read the backend verdict');
  assert.doesNotMatch(hero, /heroState/, 'HomeHero must not derive severity locally');
});

test('AlertsList renders the same verdict, so the two views cannot disagree', () => {
  // Phase 0 (2026-09-21): AlertCenter.jsx was dead code (nothing rendered it;
  // AlertsList.jsx is the live alerts surface). The invariant moves to it.
  const alerts = readFileSync(new URL('../src/components/AlertsList.jsx', import.meta.url), 'utf8');
  assert.match(alerts, /warn\.verdict|\.verdict\b/, 'AlertsList must read the backend verdict');
  assert.doesNotMatch(alerts, /heroState/);
});

test('valid-until formats to HH:MM, garbage yields empty', () => {
  assert.equal(formatValidUntil('2026-09-17T20:29:27+05:30'), '20:29');
  assert.equal(formatValidUntil(''), '');
  assert.equal(formatValidUntil(null), '');
  assert.equal(formatValidUntil('not-a-date'), '');
});

test('countdown ticks down and names expiry honestly', () => {
  const now = Date.parse('2026-09-17T18:00:00+05:30');
  assert.equal(formatCountdown('2026-09-17T20:29:00+05:30', now), '2h 29m');
  assert.equal(formatCountdown('2026-09-17T18:38:00+05:30', now), '38m');
  assert.equal(formatCountdown('2026-09-17T17:59:00+05:30', now), 'expired');
  assert.equal(formatCountdown('', now), '');
  assert.equal(formatCountdown('junk', now), '');
});

test('minutes-since measures freshness, null when unknown', () => {
  const now = Date.parse('2026-09-17T18:00:00+05:30');
  assert.equal(minutesSince('2026-09-17T17:56:00+05:30', now), 4);
  assert.equal(minutesSince(null, now), null);
  assert.equal(minutesSince('junk', now), null);
});

test('expired means past valid_until only — never on missing data', () => {
  const now = Date.parse('2026-09-17T18:00:00+05:30');
  assert.equal(isExpired('2026-09-17T17:59:00+05:30', now), true);
  assert.equal(isExpired('2026-09-17T20:29:00+05:30', now), false);
  assert.equal(isExpired('', now), false);
  assert.equal(isExpired(null, now), false);
  assert.equal(isExpired('junk', now), false);
});

// --- sky hero (Crew A, 2026-09-21): creative weather band --------------------

test('sky band labels weather provenance from the payload, never hardcoded LIVE', () => {
  const hero = readFileSync(new URL('../src/components/HomeHero.jsx', import.meta.url), 'utf8');
  assert.match(hero, /setWxProv/, 'the hero must track weather provenance separately from the verdict');
  assert.match(hero, /d\.provenance \? d\.provenance : 'UNAVAILABLE'/, 'provenance must come from the API payload');
  assert.match(hero, /\{wxProvLabel\}/, 'the sky band must render the derived provenance');
  // The verdict provenance invariant from review.test.mjs is unchanged.
  assert.match(hero, /const evProv = pending \? '—' : aged \? 'CACHED'/);
  assert.doesNotMatch(hero, /heroState/, 'no client-side severity derivation');
});

test('the hero has a manual city fallback wired to the location search', () => {
  const hero = readFileSync(new URL('../src/components/HomeHero.jsx', import.meta.url), 'utf8');
  assert.match(hero, /api\.searchLocation/, 'the hero must use the existing location-search API');
  assert.match(hero, /setDistrict\(first\)/, 'applying a city must go through the store, never guessed coords');
  assert.match(hero, /cityNoMatch/, 'a no-match search is an honest translated state');
  assert.match(hero, /cityFailed/, 'a failed search is an honest translated state');
  assert.match(hero, /!locReady && \(/, 'the fallback shows when location is denied or unavailable');
});

test('safety lenses are descriptive, never a client-side severity', () => {
  const hero = readFileSync(new URL('../src/components/HomeHero.jsx', import.meta.url), 'utf8');
  for (const fn of ['heatWord', 'rainWord', 'windWord']) {
    assert.match(hero, new RegExp(fn), `${fn} must exist`);
  }
  for (const key of ['lensHeat', 'lensRain', 'lensWind', 'lensNA']) {
    assert.match(hero, new RegExp(key), `${key} must be rendered`);
  }
  // The verdict stamp keeps its one severity mapping; the lenses must not
  // invent another one (no risk scores, no low/high bucketing of values).
  assert.doesNotMatch(hero, /riskLevel|riskScore|lensSev/, 'no second severity concept');
  // Missing values render the honest "not available yet", never a dash or a
  // fake calm.
  assert.match(hero, /lensNA/, 'missing lens data must say it is not available');
});

test('new hero strings have EN/HI/TE parity and no Tamil script', () => {
  const s = readFileSync(new URL('../src/strings/areas/home2.js', import.meta.url), 'utf8');
  const keys = [
    'lensTitle', 'lensHeat', 'lensRain', 'lensWind', 'lensNA',
    'heatVeryHot', 'heatHot', 'heatWarm', 'heatMild', 'heatCool',
    'rainDry', 'rainLight', 'rainSteady', 'rainHeavy',
    'windCalm', 'windBreezy', 'windWindy', 'windGusty',
    'cityTitle', 'cityPh', 'cityApply', 'cityNoMatch', 'cityFailed', 'wxUnavailable',
  ];
  for (const key of keys) {
    const hits = s.match(new RegExp(`${key}: '`, 'g')) || [];
    assert.equal(hits.length, 3, `${key} must exist in EN/HI/TE`);
  }
  assert.doesNotMatch(s, /[\u0B80-\u0BFF]/, 'no Tamil script anywhere');
});
