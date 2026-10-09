import test from 'node:test';
import assert from 'node:assert/strict';
import { STR, t, ago, condText, dayName } from '../src/lib/i18n.js';
import { activeAlerts, conditionIcon, hazardIcon, severityTone, toneOf } from '../src/lib/weather.js';

test('every label exists in Hindi and Telugu (no English leaking into a safety screen)', () => {
  const en = Object.keys(STR.en);
  for (const lang of ['hi', 'te']) {
    const missing = en.filter((k) => !STR[lang][k]);
    assert.deepEqual(missing, [], `${lang} is missing ${missing.join(', ')}`);
    const extra = Object.keys(STR[lang]).filter((k) => !STR.en[k]);
    assert.deepEqual(extra, [], `${lang} has keys English lacks`);
  }
});

test('every verdict level has a label in every language', () => {
  for (const lang of ['en', 'hi', 'te']) {
    for (const lv of ['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'UNKNOWN']) {
      assert.notEqual(t(lang, `lv${lv}`), `lv${lv}`);
    }
  }
});

test('placeholders and fallbacks', () => {
  assert.equal(t('te', 'minAgo', { n: 5 }), '5 నిమిషాల క్రితం');
  assert.equal(t('xx', 'listen'), 'Listen');
  assert.equal(ago(0, 'en', 30 * 60000), '30 min ago');
  assert.equal(ago(0, 'hi', 3 * 3600000), '3 घंटे पहले');
  assert.equal(condText('Light Drizzle', 'te'), 'చిరుజల్లులు');
  assert.equal(condText('Weird', 'te'), 'Weird');
  assert.equal(dayName('2026-10-09', 'hi', 1), 'कल');
});

test('pictures for conditions and hazards', () => {
  assert.equal(conditionIcon('Thunderstorm'), 'storm');
  assert.equal(conditionIcon('Heavy Rain'), 'rain-heavy');
  assert.equal(conditionIcon('Clear', 0), 'sun');
  assert.equal(conditionIcon('Mostly Clear', 3), 'partly');
  assert.equal(hazardIcon('Thunderstorm with Lightning'), 'bolt');
  assert.equal(hazardIcon('TC ONE-26 cyclone'), 'cyclone');
  assert.equal(hazardIcon('Heat wave'), 'heat');
  assert.equal(hazardIcon('something odd'), 'alert');
});

test('unknown is grey, never green; severity is never re-graded here', () => {
  assert.equal(toneOf(null), 'grey');
  assert.equal(toneOf({ level: 'UNKNOWN' }), 'grey');
  assert.equal(toneOf({ level: 'LOW' }), 'green');
  assert.equal(toneOf({ level: 'CRITICAL' }), 'red');
  assert.equal(severityTone('orange'), 'orange');
  assert.equal(severityTone('Severe'), 'grey');
});

test('expired alerts drop out; worst first; duplicates collapse', () => {
  const now = Date.parse('2026-10-09T12:00:00+05:30');
  const list = [
    { identifier: 'a', severity: 'YELLOW', expires: '2026-10-09T15:00:00+05:30' },
    { identifier: 'b', severity: 'ORANGE', expires: '2026-10-09T10:00:00+05:30' },
    { identifier: 'c', severity: 'RED', expires: '2026-10-09T18:00:00+05:30' },
    { identifier: 'c', severity: 'RED', expires: '2026-10-09T18:00:00+05:30' },
    { identifier: 'd', severity: 'ORANGE' },
  ];
  assert.deepEqual(activeAlerts(list, now).map((a) => a.identifier), ['c', 'd', 'a']);
});

test('official hazard names are said in the reader\'s language', async () => {
  const { hazardText } = await import('../src/lib/i18n.js');
  assert.equal(hazardText('Lightning', 'en'), 'Lightning');
  assert.equal(hazardText('Lightning', 'te'), 'పిడుగులు');
  assert.equal(hazardText('Thunderstorm & Lightning', 'hi'), 'आंधी-तूफ़ान और बिजली');
  assert.equal(hazardText('Heavy Rainfall', 'te'), 'భారీ వర్షం');
  assert.equal(hazardText('Flood', 'hi'), 'बाढ़');
  assert.equal(hazardText('Something new', 'te'), 'Something new');
  assert.equal(hazardText(null, 'te'), '');
});
