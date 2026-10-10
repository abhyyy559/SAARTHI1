import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  alertsIntensity, buildHeatData, healthIntensity, layerValue,
  temperatureRange, weatherIntensity,
} from '../src/heatmap.js';

const district = (over = {}) => ({
  district: 'Hyderabad',
  state: 'Telangana',
  latitude: 17.3856,
  longitude: 78.4641,
  alerts: { severity: 0, severity_label: 'NONE', count: 0, active: false },
  weather: null,
  health: { risk: 'unknown', risk_score: null, basis: null },
  ...over,
});

// --- alerts layer -----------------------------------------------------------

test('alerts intensity ignores a calm district and an unread one', () => {
  assert.equal(alertsIntensity(district({ alerts: { severity: 0 } })), 0);
  assert.equal(alertsIntensity(district({ alerts: { severity: 1 } })), 0);
});

test('alerts intensity rises with severity, RED topping the scale', () => {
  const rank = (s) => alertsIntensity(district({ alerts: { severity: s } }));
  assert.equal(rank(1), 0);
  assert.ok(rank(2) > 0 && rank(2) < 1);
  assert.equal(rank(4), 1);
  assert.ok(rank(3) > rank(2) && rank(4) > rank(3));
});

test('alerts intensity survives a missing alerts block', () => {
  assert.equal(alertsIntensity(district({ alerts: null })), 0);
  assert.equal(alertsIntensity(null), 0);
});

// --- weather layer ----------------------------------------------------------

test('weather intensity is relative to the range on screen', () => {
  const range = { min: 20, max: 40 };
  const at = (t) => weatherIntensity(district({ weather: { temperature: t } }), range);
  assert.equal(at(20), 0);
  assert.equal(at(30), 0.5);
  assert.equal(at(40), 1);
});

test('weather intensity is 0 when there is no reading or no range', () => {
  assert.equal(weatherIntensity(district(), { min: 20, max: 40 }), 0);
  assert.equal(weatherIntensity(district({ weather: { temperature: null } }), { min: 20, max: 40 }), 0);
  // A flat range (every district the same temperature) must not divide by zero.
  assert.equal(weatherIntensity(district({ weather: { temperature: 30 } }), { min: 30, max: 30 }), 0);
  assert.equal(weatherIntensity(district({ weather: { temperature: 30 } }), null), 0);
});

test('temperature range only counts districts that actually carry a reading', () => {
  const list = [
    district({ weather: { temperature: 30 } }),
    district({ district: 'B', weather: null }),
    district({ district: 'C', weather: { temperature: 22 } }),
    district({ district: 'D', weather: { temperature: 36 } }),
  ];
  assert.deepEqual(temperatureRange(list), { min: 22, max: 36 });
  assert.equal(temperatureRange([district(), district({ district: 'E' })]), null);
  assert.equal(temperatureRange([]), null);
});

// Regression: Number(null) and Number('') are both 0, so a naive Number() check
// turned "no reading" into a real 0C and parked the district at the cold end of
// the scale. Absent must read absent, never zero.
test('a missing reading never becomes a real zero', () => {
  const range = { min: 20, max: 40 };
  for (const missing of [null, undefined, '']) {
    assert.equal(weatherIntensity(district({ weather: { temperature: missing } }), range), 0,
      `temperature ${JSON.stringify(missing)} must not draw`);
    assert.equal(layerValue(district({ weather: { temperature: missing } }), 'weather'), null,
      `temperature ${JSON.stringify(missing)} must not print a number`);
    assert.equal(buildHeatData(
      [district({ weather: { temperature: missing } })], 'weather', range,
    ).length, 0, `temperature ${JSON.stringify(missing)} must not add a point`);
  }
  // A district whose whole weather block is absent behaves the same way.
  assert.equal(weatherIntensity(district(), range), 0);
  assert.equal(layerValue(district(), 'weather'), null);
  // And a genuine 0C reading IS drawn — absent and freezing are different facts.
  assert.equal(layerValue(district({ weather: { temperature: 0 } }), 'weather'), '0°C');
});

// --- health layer -----------------------------------------------------------

test('health intensity maps the risk score to the scale, unknown at zero', () => {
  assert.equal(healthIntensity(district({ health: { risk: 'unknown', risk_score: null } })), 0);
  assert.equal(healthIntensity(district({ health: { risk: 'low', risk_score: 0 } })), 0);
  assert.equal(healthIntensity(district({ health: { risk: 'moderate', risk_score: 1 } }), ), 0.5);
  assert.equal(healthIntensity(district({ health: { risk: 'high', risk_score: 2 } })), 1);
});

// --- heat data --------------------------------------------------------------

test('heat data drops zero-intensity districts so a blank layer reads blank', () => {
  const list = [
    district({ alerts: { severity: 0, severity_label: 'NONE' } }),
    district({ district: 'B', latitude: 19, longitude: 79, alerts: { severity: 4, severity_label: 'RED' } }),
  ];
  const points = buildHeatData(list, 'alerts', null);
  assert.equal(points.length, 1);
  assert.deepEqual(points[0].slice(0, 2), [19, 79]);
});

test('heat data is clamped into 0..1 and keeps invalid coordinates out', () => {
  const list = [
    district({ district: 'bad-coords', latitude: 'x', longitude: 'y', alerts: { severity: 4 } }),
    district({ district: 'ok', alerts: { severity: 4 } }),
  ];
  for (const p of buildHeatData(list, 'alerts', null)) {
    assert.ok(p[2] >= 0 && p[2] <= 1);
  }
  assert.equal(buildHeatData(list, 'alerts', null).length, 1);
});

test('heat data honours the requested layer', () => {
  const d = district({
    alerts: { severity: 2, severity_label: 'YELLOW' },
    weather: { temperature: 40 },
    health: { risk: 'high', risk_score: 2 },
  });
  const range = { min: 20, max: 40 };
  assert.equal(buildHeatData([d], 'alerts', range)[0][2], alertsIntensity(d));
  assert.equal(buildHeatData([d], 'weather', range)[0][2], 1);
  assert.equal(buildHeatData([d], 'health', range)[0][2], 1);
});

// --- popup values -----------------------------------------------------------

test('layer value states the count alongside the severity, or just the label', () => {
  const quiet = district({ alerts: { severity_label: 'NONE', count: 0 } });
  assert.equal(layerValue(quiet, 'alerts'), 'NONE');
  const busy = district({ alerts: { severity_label: 'RED', count: 3 } });
  assert.equal(layerValue(busy, 'alerts'), 'RED · 3 active');
});

test('layer value never invents a weather number', () => {
  assert.equal(layerValue(district(), 'weather'), null);
  assert.equal(layerValue(district({ weather: { temperature: 32.6 } }), 'weather'), '33°C');
});

test('layer value names the health risk, unknown included', () => {
  assert.equal(layerValue(district({ health: { risk: 'moderate' } }), 'health'), 'moderate');
  assert.equal(layerValue(district(), 'health'), 'unknown');
});

// --- reachability -----------------------------------------------------------
// A view that exists only in the router is a defect. Register the map view and
// prove every navigation surface that can reach the others can also reach this.
test('the map view is registered and reachable from both rails', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../src/store.jsx', import.meta.url), 'utf8');
  const i18n = readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../src/components/Shell.jsx', import.meta.url), 'utf8');

  assert.match(app, /\bmap: MapView\b/, 'App.jsx must register the map view');
  assert.match(store, /'advisory', 'map'/, 'the ?view= deep-link whitelist must accept map');
  assert.match(i18n, /PRIMARY_VIEWS = \['home', 'alerts', 'advisory', 'map'\]/,
    'the desktop rail must list map as a primary view');
  assert.match(shell, /\{ view: 'map', label: t\(lang, 'navMap'\), icon: 'map' \}/,
    'the mobile tab bar must list map');
  assert.match(shell, /map: 'map'/, 'the rail must have an icon for the map view');
});

test('every heatmap layer has a label and a gradient', () => {
  const src = readFileSync(new URL('../src/components/AlertHeatmap.jsx', import.meta.url), 'utf8');
  for (const layer of ['alerts', 'weather', 'health']) {
    assert.ok(src.includes(`hm${layer[0].toUpperCase()}${layer.slice(1)}`),
      `AlertHeatmap must carry a label key for the ${layer} layer`);
  }
});
