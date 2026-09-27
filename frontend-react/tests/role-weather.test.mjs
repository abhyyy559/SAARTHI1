// Role-first weather brief (2026-09-23): the Home WeatherCard must lead with
// what the weather MEANS for the user's role (backend role_brief), with raw
// numbers as supporting detail — never the headline. Source-assertion style:
// the .jsx components can't run under plain node, so these assert the shipped
// structure, the new strings for EN/HI/TE parity, and the desktop gutter fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import roleweather from '../src/strings/areas/roleweather.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const card = read('../src/components/WeatherCard.jsx');
const cardCss = read('../src/components/WeatherCard.css');
const apiSrc = read('../src/api.js');
const styles = read('../src/styles.css');

const TAMIL_RE = /[\u0B80-\u0BFF]/;

test('roleweather strings exist in EN/HI/TE with no Tamil script', () => {
  for (const k of ['wxForYou', 'wxListen', 'wxStop']) for (const lang of ['en', 'hi', 'te']) {
    assert.ok(roleweather[lang][k], `${k} missing in ${lang}`);
    assert.equal(typeof roleweather[lang][k], 'string', `${k}/${lang} must be a string`);
    assert.ok(!TAMIL_RE.test(roleweather[lang][k]), `${k}/${lang} contains Tamil script`);
  }
});

test('WeatherCard requests the role brief with role + lang', () => {
  assert.ok(card.includes("role: persona || 'general'"), 'brief request must send the user role');
  assert.ok(card.includes('lang }') || card.includes(', lang'), 'brief request must send the language');
  assert.ok(apiSrc.includes('&role=') && apiSrc.includes('&lang='), 'api.current must forward role & lang');
});

test('WeatherCard renders the brief headline + lines above the numbers grid', () => {
  assert.ok(card.includes('role_brief'), 'must read role_brief from the payload');
  assert.ok(card.includes('wx-brief-head'), 'brief headline must render');
  assert.ok(card.includes('wx-brief-line'), 'brief focus lines must render');
  assert.ok(card.includes('wxForYou'), 'brief needs the "what this means for you" eyebrow');
  // Brief block sits before the numbers grid: interpretation leads.
  assert.ok(card.indexOf('wx-brief') < card.indexOf('wx-grid'), 'brief must render above the numbers grid');
});

test('WeatherCard brief has a listen button speaking the interpreted brief', () => {
  const helper = read('../src/components/briefSpeech.js');
  assert.ok(helper.includes('export function briefSpeechText'), 'briefSpeech must export the pure helper');
  assert.ok(card.includes("from './briefSpeech'"), 'WeatherCard must import the speech helper');
  assert.ok(card.includes('wx-brief-listen'), 'brief needs a listen button');
  assert.ok(card.includes('speak(briefText)'), 'listen must speak the interpreted brief');
});

test('WeatherCard CSS styles the brief in Harbour Signal', () => {
  for (const cls of ['.wx-brief', '.wx-brief-head', '.wx-brief-line', '.wx-brief-listen']) {
    assert.ok(cardCss.includes(cls), `${cls} missing from WeatherCard.css`);
  }
});

test('desktop uses the width: wider column, tighter gutters, mobile untouched', () => {
  assert.ok(styles.includes('@media (min-width: 861px)'), 'desktop rule must use the 861px breakpoint');
  const desktopBlock = styles.slice(styles.indexOf('@media (min-width: 861px)'));
  assert.ok(desktopBlock.includes('max-width: 1120px'), 'desktop #main must widen past 880px');
  assert.ok(desktopBlock.includes('#main'), 'desktop rule must target #main');
  // Mobile column cap must still exist for narrow viewports.
  assert.ok(styles.includes('max-width: 880px'), 'mobile 880px cap must remain');
});
