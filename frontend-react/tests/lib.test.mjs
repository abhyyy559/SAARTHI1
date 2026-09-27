// Unit tests for the pure presentation logic in src/lib.js.
// Assertions match the real implementations (no invented behavior).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  conditionKind, skyTheme, severityMeta, sourceStatusMeta, sourceGroup, sourceDisplayName,
  agoParts, fmtTemp, fmtWind, compass, weekdayLabel,
  alertIsActive, alertLevel, normalizeAlert, collectAlerts, sortAlerts,
} from '../src/lib.js';

test('conditionKind classifies conditions', () => {
  assert.equal(conditionKind('Thunderstorm'), 'storm');
  assert.equal(conditionKind('Heavy Rain'), 'rain');
  assert.equal(conditionKind('Clear'), 'clear');
  assert.equal(conditionKind('Cloudy'), 'cloudy');
  assert.equal(conditionKind('partly cloudy'), 'cloudy');
  assert.equal(conditionKind('Fog'), 'fog');
  assert.equal(conditionKind('Haze'), 'fog');
  assert.equal(conditionKind('Snow'), 'snow');
  assert.equal(conditionKind(''), 'clear');
  assert.equal(conditionKind(null), 'clear');
});

test('skyTheme picks day/night variants (hour numbers are tz-independent)', () => {
  assert.equal(skyTheme('Thunderstorm', 21), 'storm-night');
  assert.equal(skyTheme('Thunderstorm', 12), 'storm-day');
  assert.equal(skyTheme('Clear', 12), 'clear-day');
  assert.equal(skyTheme('Clear', 3), 'clear-night');
  assert.equal(skyTheme('Fog', 22), 'fog-night');
  assert.equal(skyTheme(null, 12), 'clear-day');
});

test('severityMeta maps levels with unknown fallback', () => {
  assert.equal(severityMeta('EXTREME').key, 'sevExtreme');
  assert.equal(severityMeta('RED').key, 'sevSevere');
  assert.equal(severityMeta('severe').key, 'sevSevere');
  assert.equal(severityMeta('ORANGE').key, 'sevModerate');
  assert.equal(severityMeta('YELLOW').key, 'sevModerate');
  assert.equal(severityMeta('GREEN').key, 'sevMinor');
  assert.equal(severityMeta('').key, 'sevUnknown');
  assert.equal(severityMeta('bogus').key, 'sevUnknown');
  assert.ok(severityMeta('RED').rank > severityMeta('GREEN').rank);
});

test('sourceStatusMeta maps statuses with error fallback', () => {
  assert.equal(sourceStatusMeta('LIVE').key, 'stLive');
  assert.equal(sourceStatusMeta('live').key, 'stLive');
  assert.equal(sourceStatusMeta('CACHED').key, 'stCached');
  assert.equal(sourceStatusMeta('UNCONFIGURED').key, 'stUnconfigured');
  assert.equal(sourceStatusMeta('OFFLINE').key, 'stOffline');
  assert.equal(sourceStatusMeta('READY').key, 'stReady');
  assert.equal(sourceStatusMeta('').key, 'stError');
  assert.equal(sourceStatusMeta('zzz').key, 'stError');
});

test('sourceGroup buckets sources', () => {
  assert.equal(sourceGroup('imd'), 'gWeather');
  assert.equal(sourceGroup('Open-Meteo'), 'gWeather');
  assert.equal(sourceGroup('sachet'), 'gAlerts');
  assert.equal(sourceGroup('cap'), 'gAlerts');
  assert.equal(sourceGroup('stt'), 'gVoice');
  assert.equal(sourceGroup('gis'), 'gMore');
  assert.equal(sourceGroup('mystery'), 'gMore');
  assert.equal(sourceGroup(null), 'gMore');
});

test('sourceDisplayName maps known sources, null for unknowns', () => {
  assert.equal(sourceDisplayName('imd'), 'src_imd');
  assert.equal(sourceDisplayName('IMD'), 'src_imd');
  assert.equal(sourceDisplayName('open-meteo'), 'src_open_meteo');
  assert.equal(sourceDisplayName('cap'), 'src_cap');
  assert.equal(sourceDisplayName('stt'), 'src_stt');
  assert.equal(sourceDisplayName('mystery-source'), null);
});

test('agoParts buckets relative time', () => {
  const now = new Date('2026-09-27T12:00:00+05:30').getTime();
  assert.equal(agoParts('2026-09-27T11:59:40+05:30', now).key, 'justNow');
  assert.equal(agoParts('2026-09-27T11:55:00+05:30', now).key, 'minAgo');
  assert.deepEqual(agoParts('2026-09-27T11:55:00+05:30', now).params, { n: 5 });
  assert.equal(agoParts('2026-09-27T10:30:00+05:30', now).key, 'hrAgo');
  assert.equal(agoParts('2026-09-25T12:00:00+05:30', now), null); // too old
  assert.equal(agoParts('2026-09-28T12:00:00+05:30', now).key, 'justNow'); // future clamps
  assert.equal(agoParts(null, now), null);
});

test('formatters handle missing values', () => {
  assert.equal(fmtTemp(null), '–');
  assert.equal(fmtTemp(30.5), '31°');
  assert.equal(fmtTemp(30), '30°');
  assert.equal(fmtWind(null), '–');
  assert.equal(fmtWind(7.8), '8');
  assert.equal(compass(0), 'N');
  assert.equal(compass(90), 'E');
  assert.equal(compass(180), 'S');
  assert.equal(compass(270), 'W');
});

test('weekdayLabel returns localized short names', () => {
  assert.equal(weekdayLabel('2026-09-28', 'en'), 'Mon'); // 2026-09-28 is a Monday
  assert.equal(weekdayLabel('2026-09-28', 'hi'), 'सोम');
  assert.equal(weekdayLabel('2026-09-28', 'te'), 'సోమ');
  assert.equal(weekdayLabel('bad-date', 'en'), 'bad-date');
});

test('alertIsActive never treats missing/expired end as active', () => {
  const now = new Date('2026-09-27T12:00:00+05:30').getTime();
  assert.equal(alertIsActive({ expires: '2026-09-28T12:00:00+05:30' }, now), true);
  assert.equal(alertIsActive({ ends_at: '2026-09-28T12:00:00+05:30' }, now), true);
  assert.equal(alertIsActive({ valid_until: '2026-09-28T12:00:00+05:30' }, now), true);
  assert.equal(alertIsActive({ expires: '2026-09-26T12:00:00+05:30' }, now), false);
  assert.equal(alertIsActive({}, now), false);
  assert.equal(alertIsActive({ expires: 'garbage' }, now), false);
  assert.equal(alertIsActive({ ends: '2026-09-26T12:00:00+05:30' }, now), false);
  assert.equal(alertIsActive({ lifecycle_state: 'expired', expires: '2026-09-28T12:00:00+05:30' }, now), false);
  assert.equal(alertIsActive(null, now), false);
});

test('alertLevel normalizes severities', () => {
  assert.equal(alertLevel({ severity: 'EXTREME' }), 'extreme');
  assert.equal(alertLevel({ severity: 'RED' }), 'severe');
  assert.equal(alertLevel({ severity: 'ORANGE' }), 'moderate');
  assert.equal(alertLevel({ severity: 'YELLOW' }), 'moderate');
  assert.equal(alertLevel({ severity: 'GREEN' }), 'minor');
  assert.equal(alertLevel({}), 'unknown');
  assert.equal(alertLevel({ severity: 'weird' }), 'unknown');
});

test('normalizeAlert handles IMD and CAP shapes', () => {
  const imd = normalizeAlert({
    source: 'IMD', hazard: 'Heat Wave', severity: 'ORANGE', district: 'Hyderabad',
    message: 'Stay hydrated', issued_at: '2026-09-27T10:00:00+05:30', valid_until: '2026-09-28T10:00:00+05:30',
  });
  assert.equal(imd.title, 'Heat Wave');
  assert.equal(imd.body, 'Stay hydrated');
  assert.equal(imd.sender, 'IMD');
  assert.equal(imd.area, 'Hyderabad');
  assert.equal(imd.official, true);
  assert.equal(imd.nearby, false);

  const cap = normalizeAlert({
    identifier: 'NDMA-1', headline: 'Flood warning', severity: 'RED',
    message: 'River rising', instruction: 'Move to high ground',
    expires: '2026-09-28T10:00:00+05:30', sender: 'NDMA', area: 'Ganga basin',
  }, { nearby: true });
  assert.equal(cap.id, 'NDMA-1');
  assert.equal(cap.title, 'Flood warning');
  assert.equal(cap.instruction, 'Move to high ground');
  assert.equal(cap.nearby, true);

  // Idempotent: normalizing a normalized alert keeps every field.
  const twice = normalizeAlert(cap);
  assert.deepEqual(twice, cap);
});

test('collectAlerts combines warning + cap_alerts + nearby_alerts', () => {
  const data = {
    status: 'ok',
    warning: { source: 'IMD', hazard: 'Heat', severity: 'YELLOW', district: 'X',
      issued_at: '2026-09-27T10:00:00+05:30', valid_until: '2026-09-29T10:00:00+05:30' },
    cap_alerts: [{ identifier: 'a1', headline: 'Storm', severity: 'RED',
      expires: '2026-09-28T10:00:00+05:30' }],
    nearby_alerts: [{ identifier: 'a2', headline: 'Flood nearby', severity: 'GREEN',
      expires: '2026-09-28T10:00:00+05:30' }],
    generated_at: '2026-09-27T11:00:00+05:30',
  };
  const out = collectAlerts(data);
  assert.equal(out.length, 3);
  assert.equal(out[0].id, 'a1'); // active + highest severity first
  assert.equal(out.filter((x) => x.nearby).length, 1);
  assert.deepEqual(collectAlerts(null), []);
  assert.deepEqual(collectAlerts({ status: 'unavailable' }), []);
});

test('sortAlerts puts active first, then by severity', () => {
  const now = new Date('2026-09-27T12:00:00+05:30').getTime();
  const a = { id: 'a', expires: '2026-09-28T12:00:00+05:30', severity: 'Minor' };
  const b = { id: 'b', expires: '2026-09-28T12:00:00+05:30', severity: 'Extreme' };
  const c = { id: 'c', expires: '2026-09-26T12:00:00+05:30', severity: 'Extreme' };
  const sorted = sortAlerts([a, b, c], now).map((x) => x.id);
  assert.deepEqual(sorted, ['b', 'a', 'c']);
});
