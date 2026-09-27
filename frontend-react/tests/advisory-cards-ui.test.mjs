// Crew F (advisory UI + answers): the Advisory section redesign — grounding
// banner naming alerts+weather with provenance, "what to do now" callouts on
// every card, severity-first signal flags — and the /api/advisory/cards
// grounding block that feeds it. Source-assertion style: the .jsx components
// can't run under plain node, so these assert the shipped structure, plus the
// real strings for EN/HI/TE parity.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import cards from '../src/strings/areas/advisorycards.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const adviceCards = read('../src/components/AdviceCards.jsx');
const weatherBasis = read('../src/components/WeatherBasis.jsx');
const apiPy = read('../../backend/api/advisory.py');

test('new advisory strings exist in EN/HI/TE with no Tamil script', () => {
  const keys = ['doNow', 'groundAlertsOne', 'groundAlertsMany', 'groundAlertsNone',
    'groundWxOn', 'groundWxOff', 'groundSources'];
  for (const k of keys) for (const lang of ['en', 'hi', 'te']) {
    assert.ok(cards[lang][k], `${k} missing in ${lang}`);
    assert.equal(typeof cards[lang][k], 'string', `${k}/${lang} must be a string`);
    assert.doesNotMatch(cards[lang][k], /[\u0B80-\u0BFF]/, `${k}/${lang}: no Tamil script`);
  }
});

test('grounding strings are sentence-case and the {n} slot survives', () => {
  for (const lang of ['en', 'hi', 'te']) {
    assert.match(cards[lang].doNow, /^\S/, `${lang}: doNow not empty`);
    assert.match(cards[lang].groundAlertsMany, /\{n\}/, `${lang}: {n} slot missing`);
  }
  // doNow label is a short imperative, not a sentence: no trailing period.
  for (const lang of ['en', 'hi', 'te']) {
    assert.doesNotMatch(cards[lang].doNow, /[।.]$/, `${lang}: doNow should be a short label`);
  }
});

test('AdviceCards renders the honest grounding banner: alerts + weather, provenance', () => {
  assert.match(adviceCards, /GroundingBanner/);
  assert.match(adviceCards, /basedOn/);
  assert.match(adviceCards, /groundSources/);
  assert.match(adviceCards, /groundWxOn/);
  assert.match(adviceCards, /groundWxOff/);
  assert.match(adviceCards, /groundAlertsNone/);
  // Banner never renders when the backend did not send a grounding block.
  assert.match(adviceCards, /if \(!grounding\) return null/);
});

test('every card leads with severity and puts the action first', () => {
  assert.match(adviceCards, /SevStamp/);
  assert.match(adviceCards, /data-sev=\{sev\}/);
  assert.match(adviceCards, /doNow/);
  assert.match(adviceCards, /advice-donow/);
  // Kind label + severity stamp stay in the card head; title stays the h3.
  assert.match(adviceCards, /advice-card-head/);
  assert.match(adviceCards, /className="advice-title"/);
  // Basis citations and validity stay visible under the action.
  assert.match(adviceCards, /card\.basis/);
  assert.match(adviceCards, /validFor/);
});

test('severity is never re-graded on the frontend: info stays INFO', () => {
  assert.match(adviceCards, /severity_word === 'info' \? 'INFO'/);
  assert.doesNotMatch(adviceCards, /severity_word = /);
});

test('WeatherBasis keeps its contract: facts-only line, no advice, no all-clear', () => {
  assert.match(weatherBasis, /formatWeatherBasis/);
  assert.match(weatherBasis, /r\.text/);
  assert.match(weatherBasis, /r\.provenance/);
  assert.match(weatherBasis, /role="note"/);
  const lower = weatherBasis.toLowerCase();
  assert.doesNotMatch(lower, /all clear/);
});

test('/api/advisory/cards returns a grounding block — derived, never inferred', () => {
  assert.match(apiPy, /_grounding_summary/);
  assert.match(apiPy, /"grounding": _grounding_summary\(/);
  // Alert truth stays with the verdict; weather stays append-only facts.
  assert.match(apiPy, /confirmed/);
  assert.match(apiPy, /observation_numbers/);
  assert.match(apiPy, /never softens|append-only/i);
  // No severity words are invented or promoted in the endpoint layer.
  assert.doesNotMatch(apiPy, /severity_word.*=.*["']RED/);
});
