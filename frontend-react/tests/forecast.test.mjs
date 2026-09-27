// 7-day forecast section (2026-09-23): ForecastCard on Home below the
// WeatherCard, with a provenance chip and an honest UNAVAILABLE state.
// Source-assertion style: the .jsx can't run under plain node, so these
// assert the shipped structure; forecastUtils.js is plain JS and gets real
// unit tests. EN/HI/TE parity + no-Tamil are ship gates.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import forecastStrings from '../src/strings/areas/forecast.js';
import { finiteNum, conditionIconName, dayLabel } from '../src/components/forecastUtils.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const card = read('../src/components/ForecastCard.jsx');
const css = read('../src/components/ForecastCard.css');
const home = read('../src/components/Home.jsx');
const wxCard = read('../src/components/WeatherCard.jsx');
const wxCss = read('../src/components/WeatherCard.css');
const apiSrc = read('../src/api.js');

const TAMIL_RE = /[\u0B80-\u0BFF]/;
const KEYS = ['fcTitle', 'fcSeeWeek', 'fcToday', 'fcTomorrow', 'fcHigh', 'fcLow',
  'fcRainChance', 'fcChecking', 'fcUnavailableTitle', 'fcUnavailableBody',
  'fcRetry', 'fcStale'];

test('forecast strings exist in EN/HI/TE with no Tamil script', () => {
  for (const k of KEYS) for (const lang of ['en', 'hi', 'te']) {
    const v = forecastStrings[lang][k];
    assert.ok(typeof v === 'string' && v.length > 0, `${k} missing in ${lang}`);
    assert.ok(!TAMIL_RE.test(v), `${k}/${lang} contains Tamil script`);
  }
  // Sentence case for the English chrome (no shouty all-caps).
  assert.ok(!/^[A-Z ]{4,}$/.test(forecastStrings.en.fcTitle), 'fcTitle must not be all-caps');
});

test('ForecastCard fetches the v1 forecast for the user location', () => {
  assert.ok(apiSrc.includes('forecast: (lat, lon) => j(`${V}/weather/forecast?lat=${lat}&lon=${lon}`)'),
    'api.forecast must hit the v1 route');
  assert.ok(card.includes('api.forecast(loc.lat, loc.lon)'), 'ForecastCard must request the forecast for the user location');
});

test('ForecastCard renders the full day row: high/low, rain chance %, condition icon + word', () => {
  assert.ok(card.includes('d.forecast.days'), 'must read days from the forecast payload');
  assert.ok(card.includes('max_temperature'), 'high must come from max_temperature');
  assert.ok(card.includes('min_temperature'), 'low must come from min_temperature');
  assert.ok(card.includes('rain_chance'), 'rain chance must come from rain_chance');
  assert.ok(card.includes('%'), 'rain chance must render as a % (precipitation probability 0-100)');
  assert.ok(card.includes('conditionIconName('), 'condition must map through the icon helper');
  assert.ok(card.includes('<Icon name={conditionIconName(') || card.includes('conditionIconName(cond)'), 'condition must render as icon');
  assert.ok(card.includes('fc-cond-word'), 'condition word must render next to the icon — never color alone');
});

test('ForecastCard carries a provenance chip matching the Prov style', () => {
  assert.ok(card.includes("from './ui'") && card.includes('<Prov value={prov}'), 'must use the shared Prov component');
  assert.ok(card.includes('d.provenance'), 'provenance must be read from the payload');
  assert.ok(card.includes("provValue === 'CACHED'") || card.includes("prov === 'CACHED'"), 'CACHED provenance must be handled');
});

test('ForecastCard has an honest UNAVAILABLE state — never fake numbers', () => {
  assert.ok(card.includes('fcUnavailableTitle') && card.includes('fcUnavailableBody'), 'unavailable copy must exist');
  assert.ok(card.includes('.catch('), 'fetch failure must be caught');
  assert.ok(card.includes('fcRetry'), 'unavailable state needs a retry button');
  // A failed fetch degrades to UNAVAILABLE with an empty day list.
  assert.ok(card.includes("setProv('UNAVAILABLE')"), 'failures must set UNAVAILABLE provenance');
});

test('ForecastCard is anchored for the role-brief "see the week" link', () => {
  assert.ok(card.includes('id="forecast-week"'), 'ForecastCard needs the forecast-week anchor');
  assert.ok(wxCard.includes('href="#forecast-week"'), 'WeatherCard brief must link to the forecast anchor');
  assert.ok(wxCard.includes("t(lang, 'fcSeeWeek')"), 'link must use the fcSeeWeek string');
});

test('Home mounts ForecastCard directly below WeatherCard, above HomeAlerts', () => {
  const wx = home.indexOf('<WeatherCard');
  const fc = home.indexOf('<ForecastCard');
  const alerts = home.indexOf('<HomeAlerts');
  assert.ok(wx !== -1 && fc !== -1 && alerts !== -1, 'all three sections must mount on Home');
  assert.ok(wx < fc, 'ForecastCard must come after WeatherCard');
  assert.ok(fc < alerts, 'ForecastCard must come before HomeAlerts');
  // One heading per view: the forecast section has its own h2, not a second page title.
  assert.ok(card.includes('<h2'), 'forecast section carries its own h2');
  assert.ok(card.includes("aria-label={t(lang, 'fcTitle')}"), 'section must be labelled for screen readers');
});

test('ForecastCard styles follow Harbour Signal in its own CSS', () => {
  assert.ok(css.includes('var(--paper)'), 'card must be paper');
  assert.ok(css.includes('2px solid var(--ink)'), 'card must use 2px ink borders');
  assert.ok(!/background:\s*(red|green|blue|#[0-9a-f]{3,6})/i.test(css) || css.includes('--tint'),
    'no raw color fills for severity');
});

test('no Tamil script in any forecast file', () => {
  for (const [name, src] of [['ForecastCard.jsx', card], ['forecastUtils.js', read('../src/components/forecastUtils.js')], ['WeatherCard.jsx', wxCard], ['Home.jsx', home], ['forecast.css', css], ['WeatherCard.css', wxCss]]) {
    assert.ok(!TAMIL_RE.test(src), `${name} contains Tamil script`);
  }
});

test('finiteNum: numbers pass through, everything else is null', () => {
  assert.equal(finiteNum(31.4), 31.4);
  assert.equal(finiteNum('45'), 45);
  assert.equal(finiteNum(null), null);
  assert.equal(finiteNum(undefined), null);
  assert.equal(finiteNum(''), null);
  assert.equal(finiteNum('   '), null); // whitespace is missing, not zero
  assert.equal(finiteNum(NaN), null);
});

test('conditionIconName: coarse, deterministic, never empty', () => {
  assert.equal(conditionIconName('Rain'), 'rain');
  assert.equal(conditionIconName('light rain'), 'rain');
  assert.equal(conditionIconName('Thunderstorm'), 'storm');
  assert.equal(conditionIconName('Clear'), 'sun');
  assert.equal(conditionIconName('Overcast clouds'), 'cloud');
  assert.equal(conditionIconName('Fog'), 'fog');
  assert.equal(conditionIconName('Dust'), 'cloud'); // unknown → cloud, never ''.
  assert.equal(conditionIconName(null), 'cloud');
});

test('dayLabel: Today / Tomorrow for the first two days, weekday after', () => {
  const tt = (k) => ({ fcToday: 'Today', fcTomorrow: 'Tomorrow' }[k] || k);
  assert.equal(dayLabel('2026-09-23', 0, 'en', tt).main, 'Today');
  assert.equal(dayLabel('2026-09-24', 1, 'en', tt).main, 'Tomorrow');
  const third = dayLabel('2026-09-25', 2, 'en', tt);
  assert.ok(third.main && third.main.length > 0, 'day 2 needs a weekday label');
  assert.ok(third.sub && third.sub.length > 0, 'day 2 needs a date sub-line');
  // Unparseable dates never crash the card.
  const bad = dayLabel('nonsense', 3, 'en', tt);
  assert.ok(typeof bad.main === 'string' && bad.main.length > 0, 'bad date falls back to the raw string');
});
