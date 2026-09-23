// Crew: Advisory page improvement + read-aloud (Advisor.jsx / Advisor2.css /
// strings/areas/advisory2.js). Source-assertion style: the .jsx components
// can't run under plain node, so these assert the shipped structure, plus the
// real strings for EN/HI/TE parity.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import adv2 from '../src/strings/areas/advisory2.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const advisor = read('../src/components/Advisor.jsx');
const advisor2Css = read('../src/components/Advisor2.css');

const KEYS = ['advReadAloud', 'advStop', 'advWhatsHappening', 'advDoThisNow', 'advAvoid'];

test('new advisory2 strings exist in EN/HI/TE with no Tamil script', () => {
  for (const k of KEYS) for (const lang of ['en', 'hi', 'te']) {
    assert.ok(adv2[lang][k], `${k} missing in ${lang}`);
    assert.equal(typeof adv2[lang][k], 'string', `${k}/${lang} must be a string`);
    assert.doesNotMatch(adv2[lang][k], /[\u0B80-\u0BFF]/, `${k}/${lang}: no Tamil script`);
  }
});

test('labels are sentence-case: short labels, no trailing periods', () => {
  for (const lang of ['en', 'hi', 'te']) {
    for (const k of KEYS) {
      assert.match(adv2[lang][k], /^\S/, `${lang}/${k}: not empty`);
      assert.doesNotMatch(adv2[lang][k], /[।.]$/, `${lang}/${k}: label should not end in a period`);
    }
  }
});

test('Advisor imports the co-located CSS and renders the read-aloud button', () => {
  assert.match(advisor, /import '\.\/Advisor2\.css'/, 'must import the co-located CSS');
  assert.match(advisor, /adv2-readaloud/, 'prominent read-aloud class');
  assert.match(advisor, /btn btn-signal/, 'read-aloud is a primary button, not a ghost');
  assert.match(advisor, /speechState/, 'reads the store speech state');
  assert.match(advisor, /stopSpeaking/, 'becomes Stop while speaking');
  assert.match(advisor, /aria-pressed/, 'speaking state exposed to AT');
});

test('Advisor structures advice into labelled sections with an Avoid split', () => {
  assert.match(advisor, /splitDoAvoid/, 'do/avoid splitter present');
  assert.match(advisor, /advWhatsHappening/, "What's happening section");
  assert.match(advisor, /advDoThisNow/, 'Do this now section');
  assert.match(advisor, /advAvoid/, 'Avoid section');
  // The full advisory (lead + bullets) is what gets spoken — no
  // pre-processing; backend TTS normalization already handles numbers/units.
  assert.match(advisor, /\[split\.lead, \.\.\.doList, \.\.\.avoidList\]/, 'spoken text = lead + every bullet');
  // WeatherBasis stays inside What's happening, caveat/provenance kept.
  assert.match(advisor, /WeatherBasis/, 'weather basis kept');
  assert.match(advisor, /data\.caveat/, 'occupational caveat kept');
});

test('Advisor2.css is Harbour Signal: 2px ink borders, icon+word labels, avoid accent', () => {
  assert.match(advisor2Css, /2px solid var\(--ink\)/, '2px ink borders');
  assert.match(advisor2Css, /\.adv2-label/, 'icon + word section labels');
  assert.match(advisor2Css, /\.adv2-avoid/, 'avoid section');
  assert.match(advisor2Css, /--sev-red/, 'avoid carries a red accent');
  assert.doesNotMatch(advisor2Css, /uppercase/, 'sentence case — never uppercased');
});
