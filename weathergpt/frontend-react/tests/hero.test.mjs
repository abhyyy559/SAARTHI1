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

test('HeroCard renders the backend verdict instead of deriving a level', () => {
  const hero = readFileSync(new URL('../src/components/HeroCard.jsx', import.meta.url), 'utf8');
  assert.match(hero, /warn\.verdict/, 'HeroCard must read the backend verdict');
  assert.doesNotMatch(hero, /heroState/, 'HeroCard must not derive severity locally');
});

test('AlertCenter renders the same verdict, so the two views cannot disagree', () => {
  const alerts = readFileSync(new URL('../src/components/AlertCenter.jsx', import.meta.url), 'utf8');
  assert.match(alerts, /warn\.verdict|\.verdict\b/, 'AlertCenter must read the backend verdict');
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
