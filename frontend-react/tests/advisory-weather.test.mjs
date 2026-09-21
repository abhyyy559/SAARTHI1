// Worker 6 (advisory-weather): the persona advisory surfaces its weather basis
// honestly — observed numbers plus provenance, or an explicit unavailable line.
// The formatter is pure (translator injected), so these run under plain node
// against the real round2 strings.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import round2 from '../src/strings/areas/round2.js';
import { formatWeatherBasis } from '../src/weatherBasis.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
// Same fallback the app's t() uses: missing key -> English -> key itself.
const tr = (lang) => (key) => round2[lang]?.[key] || round2.en[key] || key;

test('basis line renders observed numbers, units and the alert count', () => {
  const r = formatWeatherBasis(
    { temp_c: 34, humidity_pct: 62, rain_mm: 12, wind_kph: null, provenance: 'LIVE' },
    1, tr('en'));
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Based on: 34°C, 62% humidity, 12 mm rain + 1 active alert');
  assert.equal(r.provenance, 'LIVE');
});

test('alert count pluralises; zero or unknown counts are omitted', () => {
  const many = formatWeatherBasis({ temp_c: 34, provenance: 'DEMO' }, 3, tr('en'));
  assert.match(many.text, /\+ 3 active alerts/);
  const none = formatWeatherBasis({ temp_c: 34, provenance: 'DEMO' }, 0, tr('en'));
  assert.doesNotMatch(none.text, /active alert/);
  const unknown = formatWeatherBasis({ temp_c: 34, provenance: 'DEMO' }, undefined, tr('en'));
  assert.doesNotMatch(unknown.text, /active alert/);
});

test('unavailable weather renders the honest fallback in EN/HI/TE — never calm', () => {
  for (const lang of ['en', 'hi', 'te']) {
    const r = formatWeatherBasis({ provenance: 'UNAVAILABLE' }, 2, tr(lang));
    assert.equal(r.ok, false, lang);
    assert.equal(r.text, round2[lang].advWxUnavailable, lang);
    assert.doesNotMatch(r.text.toLowerCase(), /all clear/, `${lang}: never an all-clear`);
    assert.doesNotMatch(r.text, /\d+°C/, `${lang}: never invented numbers`);
  }
});

test('missing basis and a valueless basis also fall back honestly', () => {
  assert.equal(formatWeatherBasis(null, 0, tr('en')).ok, false);
  assert.equal(formatWeatherBasis(undefined, 0, tr('en')).ok, false);
  assert.equal(formatWeatherBasis({ provenance: 'LIVE' }, 0, tr('en')).ok, false);
  // Non-numeric values are not rendered as numbers.
  const weird = formatWeatherBasis({ temp_c: 'hot', provenance: 'LIVE' }, 0, tr('en'));
  assert.equal(weird.ok, false);
});

test('hindi and telugu render translated units', () => {
  const hi = formatWeatherBasis(
    { temp_c: 34, humidity_pct: 62, rain_mm: 12, wind_kph: 45, provenance: 'LIVE' }, 0, tr('hi'));
  assert.match(hi.text, /34°C/);
  assert.match(hi.text, /62% आर्द्रता/);
  assert.match(hi.text, /12 मिमी वर्षा/);
  assert.match(hi.text, /45 किमी\/घंटा हवा/);
  const te = formatWeatherBasis(
    { temp_c: 34, humidity_pct: 62, provenance: 'LIVE' }, 0, tr('te'));
  assert.match(te.text, /62% తేమ/);
  assert.match(te.text, /^ఆధారం:/);
});

test('every new key exists in EN/HI/TE with no Tamil script', () => {
  const keys = ['advWxBasis', 'advWxTemp', 'advWxHumidity', 'advWxRain', 'advWxWind',
    'advWxAlertOne', 'advWxAlertMany', 'advWxUnavailable'];
  for (const k of keys) for (const lang of ['en', 'hi', 'te']) {
    assert.ok(round2[lang][k], `${k} missing in ${lang}`);
    assert.doesNotMatch(round2[lang][k], /[\u0B80-\u0BFF]/, `${k}/${lang}: no Tamil script`);
  }
});

test('Advisor renders the WeatherBasis line', () => {
  // Phase 0 (2026-09-21): ProfileAdvice.jsx was dead code (nothing rendered
  // it); Advisor.jsx is the live advisory surface and already renders it.
  assert.match(read('../src/components/Advisor.jsx'), /<WeatherBasis/);
  assert.match(read('../src/components/Advisor.jsx'), /data\.weather_basis/);
  assert.match(read('../src/components/WeatherBasis.jsx'), /formatWeatherBasis/);
});
