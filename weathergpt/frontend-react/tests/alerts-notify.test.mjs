import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Loaded the same way the other suites load browser modules: the source has no
// Vite-only syntax, so it is imported as-is through a data URL.
const source = readFileSync(new URL('../src/alertWatch.js', import.meta.url), 'utf8');
const { transition, tagFor, hazardOf } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const CALM = { level: 'LOW', basis: 'none', confirmed: true, severity: 'GREEN', hazard: null };
const MODERATE = { level: 'MODERATE', basis: 'cap_alert', confirmed: true, severity: 'YELLOW', hazard: 'Lightning' };
const HIGH = { level: 'HIGH', basis: 'cap_alert', confirmed: true, severity: 'ORANGE', hazard: 'Heavy rain' };
const CRITICAL = { level: 'CRITICAL', basis: 'verified_warning', confirmed: true, severity: 'RED', hazard: 'Cyclone' };
const UNKNOWN = { level: 'UNKNOWN', basis: 'unavailable', confirmed: false, severity: null, hazard: null };

test('the first verdict ever seen is not announced', () => {
  // A user opening the app must not be buzzed about a warning already on screen.
  assert.equal(transition(null, HIGH, 'Hyderabad'), null);
  assert.equal(transition(undefined, CRITICAL, 'Hyderabad'), null);
});

test('a warning starting fires exactly one start', () => {
  const c = transition(CALM, HIGH, 'Hyderabad');
  assert.equal(c.kind, 'start');
  assert.equal(c.district, 'Hyderabad');
  assert.equal(c.severity, 'ORANGE');
  assert.equal(c.hazard, 'Heavy rain');
  // Repeating the same verdict is not a new event.
  assert.equal(transition(HIGH, HIGH, 'Hyderabad'), null);
});

test('an escalation fires', () => {
  assert.equal(transition(MODERATE, HIGH, 'Hyderabad').kind, 'escalate');
  assert.equal(transition(HIGH, CRITICAL, 'Hyderabad').kind, 'escalate');
  // ...but a downgrade is not an escalation.
  assert.equal(transition(CRITICAL, HIGH, 'Hyderabad'), null);
});

test('a confirmed all-clear fires once the hazard is gone', () => {
  assert.equal(transition(HIGH, CALM, 'Hyderabad').kind, 'clear');
});

test('"we could not check" is NEVER delivered as an all-clear', () => {
  // The one that matters: a phone that says "safe now" because the warning
  // service broke is worse than a phone that stays quiet.
  assert.equal(transition(HIGH, UNKNOWN, 'Hyderabad'), null);
  assert.equal(transition(CRITICAL, UNKNOWN, 'Hyderabad'), null);
  // Nor is an unconfirmed verdict of any level.
  assert.equal(transition(HIGH, { ...CALM, confirmed: false }, 'Hyderabad'), null);
  // Nor a confirmed verdict that is not actually LOW.
  assert.equal(transition(HIGH, { ...UNKNOWN, confirmed: true }, 'Hyderabad'), null);
});

test('an unconfirmed alert never starts a notification', () => {
  assert.equal(transition(CALM, { ...HIGH, confirmed: false }, 'Hyderabad'), null);
  assert.equal(hazardOf({ level: 'CRITICAL', confirmed: false }), null);
  assert.equal(hazardOf(null), null);
  assert.equal(hazardOf({}), null);
});

test('tags are stable per event and distinct per kind', () => {
  const start = transition(CALM, HIGH, 'Hyderabad');
  const same = transition(CALM, HIGH, 'Hyderabad');
  assert.equal(tagFor(start), tagFor(same));
  assert.notEqual(tagFor(start), tagFor(transition(HIGH, CRITICAL, 'Hyderabad')));
  assert.notEqual(tagFor(start), tagFor(transition(HIGH, CALM, 'Hyderabad')));
  // A different district is a different event.
  assert.notEqual(tagFor(start), tagFor(transition(CALM, HIGH, 'Kamareddy')));
});
