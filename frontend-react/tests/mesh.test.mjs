// Phone-to-phone SOS (Bluetooth mesh) — the web half.
//
// meshLogic.js is pure and imported directly. The Android relay itself is
// tested on the JVM (android/app/src/test/.../MeshTest.java) and the server
// half in tests/test_mesh.py. JSX wiring is checked at the source level,
// like the rest of this directory.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const load = (p) => import(`data:text/javascript;base64,${Buffer.from(read(p)).toString('base64')}`);

const L = await load('../src/mesh/meshLogic.js');
const mesh = (await load('../src/strings/areas/mesh.js')).default;

const NOW = 1_790_000_000;
const msg = (t, o, p, extra = {}) => ({
  v: 1, t, id: extra.id || Math.random().toString(16).slice(2, 18).padEnd(16, '0'), o,
  ts: NOW - 60, exp: NOW + 3600, h: 1, hl: 0, p: JSON.stringify(p), s: 'sig', ...extra,
});

// --- distance and direction ------------------------------------------------------
test('distance and compass direction between two points', () => {
  const hyd = { lat: 17.385, lon: 78.4867 };
  const north = { lat: 17.395, lon: 78.4867 };
  const km = L.haversineKm(hyd, north);
  assert.ok(km > 1.0 && km < 1.2, `~1.1 km, got ${km}`);
  assert.equal(L.compass8(L.bearingDeg(hyd, north)), 'N');
  assert.equal(L.compass8(L.bearingDeg(hyd, { lat: 17.375, lon: 78.4967 })), 'SE');
  assert.equal(L.haversineKm(hyd, { lat: null, lon: 78 }), null, 'no location is not "0 km"');
});

test('distances read simply, and nothing is invented inside GPS error', () => {
  assert.equal(L.formatDistance(0), '< 30 m');
  assert.equal(L.formatDistance(0.234), '230 m');
  assert.equal(L.formatDistance(3.456), '3.5 km');
  assert.equal(L.formatDistance(23.4), '23 km');
  const [inc] = L.sortIncidents([{ status: 'active', lat: 17.385, lon: 78.4867, ts: 1 }], { lat: 17.385, lon: 78.4867 });
  assert.equal(inc.dir, null, 'no direction when the SOS is where you stand');
});

// --- folding SOS + updates ---------------------------------------------------------
test('an SOS with its updates: going counted once, rescued closes, only the sender cancels', () => {
  const sos = msg('sos', 'aaaaaaaaaaaaaaaa', { need: 'trapped', note: 'roof', ppl: 3, lat: 17.4, lon: 78.5 }, { id: '1111111111111111' });
  const going1 = msg('sos_upd', 'bbbbbbbbbbbbbbbb', { ref: sos.id, st: 'going' });
  const going1again = msg('sos_upd', 'bbbbbbbbbbbbbbbb', { ref: sos.id, st: 'going' }, { ts: NOW - 30 });
  const going2 = msg('sos_upd', 'cccccccccccccccc', { ref: sos.id, st: 'going' });
  const fakeCancel = msg('sos_upd', 'dddddddddddddddd', { ref: sos.id, st: 'cancel' });
  let [inc] = L.foldIncidents([sos, going1, going1again, going2, fakeCancel], 'cccccccccccccccc', NOW);
  assert.equal(inc.status, 'active', 'a stranger cannot cancel someone else\'s SOS');
  assert.deepEqual(inc.responders, ['bbbbbbbbbbbbbbbb', 'cccccccccccccccc']);
  assert.equal(inc.iAmGoing, true);
  assert.equal(inc.people, 3);
  assert.equal(inc.need, 'trapped');

  [inc] = L.foldIncidents([sos, msg('sos_upd', 'aaaaaaaaaaaaaaaa', { ref: sos.id, st: 'cancel' })], 'x', NOW);
  assert.equal(inc.status, 'cancelled');
  [inc] = L.foldIncidents([sos, msg('sos_upd', 'eeeeeeeeeeeeeeee', { ref: sos.id, st: 'rescued' })], 'x', NOW);
  assert.equal(inc.status, 'rescued');
});

test('expired SOS disappear; my own SOS is marked mine', () => {
  const old = msg('sos', 'aaaaaaaaaaaaaaaa', {}, { exp: NOW - 1 });
  const mine = msg('sos', 'ffffffffffffffff', { need: 'medical' });
  const list = L.foldIncidents([old, mine], 'ffffffffffffffff', NOW);
  assert.equal(list.length, 1);
  assert.equal(list[0].mine, true);
});

test('open calls first, nearest first', () => {
  const here = { lat: 17.385, lon: 78.4867 };
  const far = { id: 'far', status: 'active', lat: 17.5, lon: 78.6, ts: 10 };
  const near = { id: 'near', status: 'active', lat: 17.39, lon: 78.49, ts: 1 };
  const done = { id: 'done', status: 'rescued', lat: 17.385, lon: 78.4867, ts: 20 };
  assert.deepEqual(L.sortIncidents([far, done, near], here).map((i) => i.id), ['near', 'far', 'done']);
  assert.deepEqual(L.sortIncidents([near, far], null).map((i) => i.id), ['far', 'near'], 'no GPS: newest first');
});

test('duplicates keep the copy that took the fewest hops', () => {
  const a = { id: 'x', h: 4 };
  const b = { id: 'x', h: 1 };
  assert.equal(L.mergeMessages([a], [b])[0].h, 1);
  assert.equal(L.mergeMessages([b], [a])[0].h, 1);
});

// --- payloads -------------------------------------------------------------------------
test('SOS payload is bounded and precise; "I\'m safe" is deliberately coarse', () => {
  const p = L.sosPayload({ need: 'bogus', note: 'x'.repeat(300), name: ' Asha ', people: 4, lat: 17.3851234, lon: 78.4867891, acc: 12.7 });
  assert.equal(p.need, 'other');
  assert.equal(p.note.length, L.NOTE_MAX);
  assert.equal(p.name, 'Asha');
  assert.equal(p.ppl, 4);
  assert.equal(p.lat, 17.38512);
  assert.equal(p.acc, 13);
  assert.equal(L.sosPayload({ people: 1 }).ppl, undefined, 'one person is the default, not sent');
  const s = L.safePayload({ name: 'Ravi', lat: 17.3851234, lon: 78.4867891 });
  assert.deepEqual(s, { name: 'Ravi', lat: 17.39, lon: 78.49 }, 'about 1 km: enough for family, not a home address');
});

test('every Emergency console button maps onto a mesh message', () => {
  assert.deepEqual(L.emergencyToMesh('NEED_HELP', false), { type: 'sos', need: 'other' });
  assert.deepEqual(L.emergencyToMesh('NEED_HELP', true), { type: 'sos', need: 'medical' });
  assert.deepEqual(L.emergencyToMesh('PEOPLE_TRAPPED'), { type: 'sos', need: 'trapped' });
  assert.deepEqual(L.emergencyToMesh('IM_SAFE'), { type: 'safe' });
  assert.equal(L.emergencyToMesh('ROAD_BLOCKED').type, 'report');
});

test('gateway uploads signed SOS traffic once, never demo or report messages', () => {
  const sos = msg('sos', 'aaaaaaaaaaaaaaaa', {}, { id: 'a000000000000001' });
  const sim = msg('sos', 'aaaaaaaaaaaaaaaa', {}, { id: 'a000000000000002', sim: true });
  const unsigned = msg('sos', 'aaaaaaaaaaaaaaaa', {}, { id: 'a000000000000003', s: '' });
  const report = msg('report', 'aaaaaaaaaaaaaaaa', {}, { id: 'a000000000000004' });
  const done = msg('safe', 'aaaaaaaaaaaaaaaa', {}, { id: 'a000000000000005' });
  const batch = L.gatewayBatch([sos, sim, unsigned, report, done], ['a000000000000005'], NOW);
  assert.deepEqual(batch.map((m) => m.id), ['a000000000000001']);
});

// --- strings ---------------------------------------------------------------------------
test('mesh strings exist in English, Hindi and Telugu', () => {
  const keys = (l) => Object.keys(mesh[l]).sort().join(',');
  assert.equal(keys('en'), keys('hi'));
  assert.equal(keys('en'), keys('te'));
  for (const need of L.NEEDS) assert.ok(mesh.en[`meshNeed_${need}`], need);
});

// --- wiring -------------------------------------------------------------------------------
test('the SOS console sends over Bluetooth before trying the server', () => {
  const emg = read('../src/components/Emergency.jsx');
  const send = emg.slice(emg.indexOf('async function send('), emg.indexOf('function onSos'));
  assert.ok(send.indexOf('sendByBluetooth(') < send.indexOf('api.sos('), 'Bluetooth first: it needs no network');
  assert.match(send, /setNote\(btNote \|\| t\(lang, 'emgNotSent'\)\)/, 'no server is not "not sent" when Bluetooth took it');
});

test('Nearby is a registered view and reachable from the More sheet and the SOS sheet', () => {
  assert.match(read('../src/App.jsx'), /nearby: NearbyView/);
  assert.match(read('../src/store.jsx'), /'nearby'/);
  assert.match(read('../src/components/Shell.jsx'), /\{ view: 'nearby'/);
  assert.match(read('../src/components/SosSheet.jsx'), /setView\('nearby'\)/);
  assert.match(read('../src/components/Shell.jsx'), /<IncomingSos \/>/, 'the "SOS nearby" popup is mounted app-wide');
});

test('the Android app gets its server address at runtime', () => {
  const api = read('../src/api.js');
  assert.match(api, /localStorage\.getItem\('wgpt\.server'\)/);
  assert.match(api, /const full = \(p\) => \(p\.startsWith\('\/api'\) \? `\$\{apiBase\(\)\}\$\{p\}`/);
  assert.match(read('../src/useVoiceInput.js'), /const base = apiBase\(\)/, 'voice websocket follows the same address');
  assert.match(read('../src/main.jsx'), /!insideAndroidApp/, 'no service worker inside the APK');
});

// --- nothing floats over the page ----------------------------------------------------------
test('SOS is docked in the bar and the rail, never floating over content', () => {
  const shell = read('../src/components/Shell.jsx');
  assert.match(shell, /<SosFab variant="nav"/);
  assert.match(shell, /<SosFab variant="rail"/);
  assert.doesNotMatch(shell, /QuickActions/, 'the floating quick actions covered page content');
  const css = read('../src/styles.css');
  const fab = css.match(/\n\.sos-fab \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(fab, /position:\s*fixed/);
  assert.match(css, /\.mnav-inner \{ display: grid; grid-template-columns: repeat\(5, minmax\(0, 1fr\)\); \}/);
});

test('the alert strip docks above the bar and the page makes room for it', () => {
  const css = read('../src/styles.css');
  assert.match(css, /html\[data-alert-strip="on"\] #main \{ padding-bottom: calc\(env\(safe-area-inset-bottom\) \+ 148px\); \}/);
  assert.match(read('../src/components/AlertOverlay.jsx'), /setAttribute\('data-alert-strip', 'on'\)/);
});

test('settings role cards cannot push the page wider than the phone', () => {
  const css = read('../src/styles.css');
  assert.match(css, /\.role-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});
