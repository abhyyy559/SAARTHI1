// Dynamic keys that flow through t(variable): enumerate every possible value
// from the pure logic and assert translations exist. Closes the gap static
// grep cannot see (SevBadge, StatusPill, Trust groups, source names).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STRINGS } from '../src/strings/index.js';
import { severityMeta, sourceStatusMeta, sourceDisplayName, sourceGroup } from '../src/lib.js';

const LANGS = ['en', 'hi', 'te'];

function assertTranslated(keys, where) {
  const missing = [];
  const bad = [];
  for (const k of keys) {
    for (const lang of LANGS) {
      const v = STRINGS[lang][k];
      if (v === undefined) missing.push(`${lang}.${k} [${where}]`);
      else if (typeof v !== 'string' || v.trim() === '' || v === k) bad.push(`${lang}.${k} = ${JSON.stringify(v)} [${where}]`);
    }
  }
  assert.deepEqual(missing, [], `missing:\n${missing.join('\n')}`);
  assert.deepEqual(bad, [], `echoes:\n${bad.join('\n')}`);
}

test('severityMeta keys are translated (SevBadge)', () => {
  const keys = new Set();
  for (const s of ['EXTREME', 'SEVERE', 'RED', 'MODERATE', 'ORANGE', 'YELLOW', 'MINOR', 'GREEN', '', 'bogus']) {
    keys.add(severityMeta(s).key);
  }
  assertTranslated([...keys], 'severityMeta');
});

test('sourceStatusMeta keys are translated (StatusPill)', () => {
  const keys = new Set();
  for (const s of ['LIVE', 'CACHED', 'UNCONFIGURED', 'OFFLINE', 'READY', 'ERROR', '', 'weird']) {
    keys.add(sourceStatusMeta(s).key);
  }
  assertTranslated([...keys], 'sourceStatusMeta');
});

test('trust group keys are translated', () => {
  assertTranslated(['gWeather', 'gAlerts', 'gVoice', 'gMore'], 'trust groups');
});

test('sourceDisplayName map values are translated', () => {
  const names = ['imd', 'open-meteo', 'owm', 'cap', 'sachet', 'govdata', 'stt', 'tts', 'gis', 'IMD', 'Open-Meteo'];
  const keys = names.map((n) => sourceDisplayName(n)).filter(Boolean);
  assert.ok(keys.length > 0);
  assertTranslated([...new Set(keys)], 'sourceDisplayName');
});

test('sourceGroup covers every known source without crashing', () => {
  for (const n of ['imd', 'open-meteo', 'cap', 'stt', 'tts', 'gis', 'nwp', 'something-new']) {
    const g = sourceGroup(n);
    assert.ok(['gWeather', 'gAlerts', 'gVoice', 'gMore'].includes(g), n);
  }
});
