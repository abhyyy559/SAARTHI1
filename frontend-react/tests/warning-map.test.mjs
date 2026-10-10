// Warning map on the Alerts page: district matching, layout, and wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const load = (p) => import(`data:text/javascript;base64,${Buffer.from(read(p)).toString('base64')}`);
const M = await load('../src/components/mapLogic.js');
const { INDIA_RINGS } = await load('../src/components/indiaOutline.js');
const alerts = (await load('../src/strings/areas/alerts.js')).default;

const NAMES = ['Hyderabad', 'Warangal', 'Mumbai', 'Mumbai Suburban', 'New Delhi'];

test('server rows (latitude) and the bundled list (lat) both give dots', () => {
  const out = M.normalizeCoords([
    { district: 'Hyderabad', state: 'Telangana', latitude: 17.385, longitude: 78.4867 },
    { district: 'Warangal', lat: 18.0, lon: 79.58 },
    { district: 'Broken', lat: 'x', lon: 1 },
    null,
  ]);
  assert.deepEqual(out.map((d) => d.name), ['Hyderabad', 'Warangal']);
  assert.equal(out[0].state, 'Telangana');
});

test('alerts find their district from the server list, a field, or the area text', () => {
  assert.deepEqual(M.districtsOfAlert({ named_districts: ['hyderabad'] }, NAMES), ['Hyderabad']);
  assert.deepEqual(M.districtsOfAlert({ district: 'Warangal' }, NAMES), ['Warangal']);
  assert.deepEqual(M.districtsOfAlert({ areaDesc: 'Hyderabad district, Telangana' }, NAMES), ['Hyderabad'],
    'the CAP area text used to match nothing, so the map stayed grey');
  assert.deepEqual(M.districtsOfAlert({ areaDesc: 'Mumbai Suburban district' }, NAMES), ['Mumbai Suburban']);
  assert.deepEqual(M.districtsOfAlert({ areaDesc: 'Coastal Andhra' }, NAMES), []);
});

test('each district shows its worst alert, worst first', () => {
  const by = M.alertsByDistrict([
    { named_districts: ['Warangal'], severity: 'YELLOW', headline: 'a' },
    { named_districts: ['Warangal'], severity: 'RED', headline: 'b' },
    { areaDesc: 'Hyderabad district', severity: 'orange' },
  ], NAMES);
  assert.equal(by.get('Warangal').sev, 'RED');
  assert.equal(by.get('Warangal').alerts[0].headline, 'b');
  assert.equal(by.get('Hyderabad').sev, 'ORANGE');
});

test('India keeps its shape and fits the full view', () => {
  const [x0, y0, s] = M.FULL_VIEW;
  for (const ring of INDIA_RINGS) {
    for (const [lon, lat] of ring) {
      const [x, y] = M.project(lon, lat);
      assert.ok(x >= x0 && x <= x0 + s && y >= y0 && y <= y0 + s, `${lon},${lat} outside the view`);
    }
  }
  const [hx] = M.project(78.4867, 17.385);
  const [mx] = M.project(72.8777, 19.076);
  assert.ok(hx > mx, 'Hyderabad is east of Mumbai');
});

test('"Near me" zooms around the user but never further than the region', () => {
  const [x, y, s] = M.viewAround([100, 200], [{ x: 104, y: 203 }, { x: 250, y: 20 }]);
  assert.ok(x < 100 && x + s > 100 && y < 200 && y + s > 200);
  assert.ok(s < M.FULL_VIEW[2] / 2, 'a far district does not undo the zoom');
  assert.deepEqual(M.viewAround(null, []), M.FULL_VIEW);
});

test('scale bar picks a round distance', () => {
  const full = M.scaleBar(320, 376);
  assert.equal(full.km, 500);
  assert.ok(full.px >= 40 && full.px <= 110);
  assert.equal(M.scaleBar(72, 376).km, 100);
  assert.equal(M.scaleBar(NaN, 1), null);
});

test('labels never overlap each other, a dot, or the edge', () => {
  const items = [
    { key: 'a', x: 50, y: 50, text: 'Hyderabad', size: 11, force: true },
    { key: 'b', x: 52, y: 51, text: 'Rangareddy', size: 11 },
    { key: 'c', x: 53, y: 49, text: 'Medchal', size: 11 },
    { key: 'd', x: 98, y: 50, text: 'Edge district', size: 11 },
  ];
  const placed = M.placeLabels(items, 1, [M.dotBox(50, 62, 3)], { x0: 0, x1: 100, y0: 0, y1: 100 });
  const box = (l) => {
    const w = l.text.length * l.fs * 0.58;
    const x0 = l.anchor === 'middle' ? l.lx - w / 2 : l.anchor === 'start' ? l.lx : l.lx - w;
    return { x0, x1: x0 + w, y0: l.ly - l.fs, y1: l.ly };
  };
  for (const l of placed) {
    const b = box(l);
    assert.ok(b.x0 >= 0 && b.x1 <= 100, `${l.text} is cut off`);
  }
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const p = box(placed[i]); const q = box(placed[j]);
      assert.ok(!(p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0), `${placed[i].text} overlaps ${placed[j].text}`);
    }
  }
  assert.ok(placed.some((l) => l.key === 'a'), 'your district is always labelled');
});

test('the map is wired: valid viewBox, nearby alerts, new strings in all languages', () => {
  const map = read('../src/components/DistrictMap.jsx');
  assert.match(map, /viewBox=\{\[vb\[0\], vb\[1\], vb\[2\], vb\[2\]\]/, 'a viewBox needs four numbers or the zoom is ignored');
  assert.match(map, /INDIA_RINGS/);
  assert.match(map, /prefers-reduced-motion/);
  const list = read('../src/components/AlertsList.jsx');
  assert.match(list, /<DistrictMap alerts=\{\[\.\.\.activeAlerts, \.\.\.nearbyAlerts\]\}/);
  assert.match(list, /districtsOfAlert\(a, \[name\]\)/, 'tapping uses the same matching as the colours');
  for (const k of ['mapNearMe', 'mapAllIndia', 'mapYou', 'mapOpenAlert', 'mapNoAlertHere', 'mapAlertedTitle', 'mapClose']) {
    for (const lang of ['en', 'hi', 'te']) assert.ok(alerts[lang][k], `${lang}.${k}`);
  }
});
