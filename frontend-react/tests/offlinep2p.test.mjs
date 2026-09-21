// Agent 2 — Offline & P2P tests.
//
// Two layers:
//  1. Real unit tests over frontend-react/src/offlineEval.js (dependency-free,
//     so it imports cleanly in plain node): staleness labels, cached-alert
//     transition evaluation, fired-set dedup, queue replay.
//  2. Source-level contracts over OfflineP2P.jsx / offline.js / sw.js, in the
//     style of harbour.test.mjs: the SIMULATED stamp is unconditional, relay
//     states exist, severity is never derived client-side, Shell.jsx/views.jsx
//     are untouched by this agent.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  checkedAgo,
  drainQueue,
  evaluateCachedAlertTransitions,
  evaluateNewTransitions,
  loadFired,
  newTransitions,
  saveFired,
  transitionKey,
} from '../src/offlineEval.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const NOW = Date.parse('2026-09-20T12:00:00+05:30');
const iso = (minOffset) => new Date(NOW + minOffset * 60000).toISOString();
const DICT = { now: 'just now', min: '{n}m', hour: '{n}h', day: '{n}d' };

// --- checkedAgo ------------------------------------------------------------
test('checkedAgo labels staleness honestly across units', () => {
  assert.equal(checkedAgo(iso(0), NOW, DICT), 'just now');
  assert.equal(checkedAgo(iso(-12), NOW, DICT), '12m');
  assert.equal(checkedAgo(iso(-59), NOW, DICT), '59m');
  assert.equal(checkedAgo(iso(-60), NOW, DICT), '1h');
  assert.equal(checkedAgo(iso(-180), NOW, DICT), '3h');
  assert.equal(checkedAgo(iso(-1500), NOW, DICT), '1d');
  assert.equal(checkedAgo(iso(-3000), NOW, DICT), '2d');
});

test('checkedAgo never lies about unparseable or missing stamps', () => {
  assert.equal(checkedAgo(null, NOW, DICT), 'just now');
  assert.equal(checkedAgo('not-a-date', NOW, DICT), 'just now');
  // A future stamp (clock skew) is clamped to "just now", not "-5m".
  assert.equal(checkedAgo(iso(5), NOW, DICT), 'just now');
});

// --- evaluateCachedAlertTransitions ----------------------------------------
const ALERT = {
  id: 'a1', title: 'Severe Thunderstorm Warning', severity: 'ORANGE',
  cached_at: iso(-30), // cached 30 min ago
  pre_alert_at: iso(-25), // crossed 25 min ago -> fires
  starts_at: iso(-10), // crossed 10 min ago -> fires
  ends_at: iso(60), // future -> silent
};

test('crossed boundaries fire; future boundaries stay silent', () => {
  const out = evaluateCachedAlertTransitions([ALERT], NOW);
  assert.deepEqual(out.map((o) => o.transition), ['pre-alert', 'active']);
  assert.ok(out.every((o) => o.key === transitionKey('a1', o.transition)));
  // Severity is carried along from the payload, never derived.
  assert.ok(out.every((o) => o.severity === 'ORANGE'));
});

test('boundaries already past at cache time do not re-fire', () => {
  const a = { ...ALERT, cached_at: iso(-5) }; // cached after both crossings
  assert.deepEqual(evaluateCachedAlertTransitions([a], NOW), []);
});

test('unknown severity stays UNKNOWN, never promoted', () => {
  const out = evaluateCachedAlertTransitions([{ ...ALERT, severity: '' }], NOW);
  assert.ok(out.every((o) => o.severity === 'UNKNOWN'));
});

test('malformed alerts are skipped, never crash the evaluation', () => {
  assert.deepEqual(evaluateCachedAlertTransitions([null, {}, { id: 'x', starts_at: 'junk' }], NOW), []);
});

// --- fired-set dedup ---------------------------------------------------------
test('newTransitions drops already-fired keys', () => {
  const crossed = evaluateCachedAlertTransitions([ALERT], NOW);
  const fresh = newTransitions(crossed, new Set([transitionKey('a1', 'pre-alert')]));
  assert.deepEqual(fresh.map((o) => o.transition), ['active']);
});

test('evaluateNewTransitions evaluates, filters and records in one step', () => {
  const mem = (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; })();
  const first = evaluateNewTransitions([ALERT], NOW, mem);
  assert.equal(first.length, 2);
  const second = evaluateNewTransitions([ALERT], NOW, mem);
  assert.equal(second.length, 0, 'a re-render must never double-notify');
  assert.deepEqual([...loadFired(mem)].sort(), [transitionKey('a1', 'active'), transitionKey('a1', 'pre-alert')].sort());
});

test('saveFired/loadFired survive a missing store', () => {
  const broken = { getItem: () => { throw new Error('nope'); }, setItem: () => { throw new Error('nope'); } };
  assert.doesNotThrow(() => saveFired(new Set(['a:b']), broken));
  assert.deepEqual(loadFired(broken), new Set());
});

// --- drainQueue --------------------------------------------------------------
test('drainQueue sends in order, keeps failures, never throws', async () => {
  const entries = [{ text: 'q1' }, { text: 'q2' }, { text: 'q3' }];
  const seen = [];
  const { sent, kept } = await drainQueue(entries, async (e) => {
    seen.push(e.text);
    if (e.text === 'q2') throw new Error('offline again');
  });
  assert.deepEqual(seen, ['q1', 'q2', 'q3']);
  assert.deepEqual(sent.map((e) => e.text), ['q1', 'q3']);
  assert.deepEqual(kept.map((e) => e.text), ['q2']);
});

test('drainQueue on an empty queue resolves cleanly', async () => {
  const { sent, kept } = await drainQueue([], async () => {});
  assert.deepEqual([sent, kept], [[], []]);
});

// --- source contracts ----------------------------------------------------------
test('OfflineP2P always renders the SIMULATED stamp and never derives severity', () => {
  const code = read('../src/components/OfflineP2P.jsx');
  assert.match(code, /p2pSimulated/, 'must render the translated simulated label');
  assert.match(code, /data-testid="p2p-simulated"/, 'stamp must be test-identifiable');
  // The stamp is in the static JSX of the P2P card — no conditional can hide it.
  assert.match(code, /actions=\{<span className="rubber-stamp"/);
  assert.match(code, /SevStamp/, 'severity must go through the translator component');
  assert.doesNotMatch(code, /severity ===|severity \?/, 'must not branch on severity values');
});

test('OfflineP2P carries the full relay state machine', () => {
  const code = read('../src/components/OfflineP2P.jsx');
  for (const s of ['idle', 'sending', 'relayed', 'failed']) assert.match(code, new RegExp(`'${s}'`), `missing relay state ${s}`);
  assert.match(code, /fail_at_hop/, 'must support the simulated failed-hop demo');
  assert.match(code, /demoRelay/, 'must call the demo-gated relay endpoint');
  assert.match(code, /demoMode/, 'relay must be gated on demo mode');
  assert.match(code, /minHeight: 44/, 'touch targets must meet the 44px rule');
  assert.match(code, /aria-live/, 'async relay state must be announced');
});

test('OfflineP2P labels cached data honestly', () => {
  const code = read('../src/components/OfflineP2P.jsx');
  assert.match(code, /checkedAgo/, 'staleness must be labelled, never implied fresh');
  assert.match(code, /op2pTransCachedNote/, 'offline transitions must say they come from saved data');
  assert.match(code, /op2pNoCache/, 'missing cache must say so, never fake an all-clear');
  assert.doesNotMatch(code, /all clear|All clear/, 'must never render a fake all-clear');
});

test('offline.js gained the advisory snapshot helpers', () => {
  const code = read('../src/offline.js');
  assert.match(code, /saveAdvisorySnapshot/, 'advisory cache saver must exist');
  assert.match(code, /readAdvisorySnapshot/, 'advisory cache reader must exist');
});

test('sw.js answers the offline probe honestly', () => {
  const code = read('../src/sw.js');
  assert.match(code, /OFFLINE_PROBE/, 'worker must answer the panel\'s controlling-page probe');
  assert.match(code, /OFFLINE_PROBE_RESULT/, 'probe must return a result message');
  assert.doesNotMatch(code, /cache\.addAll|precacheAndRoute\(self\.__WB_MANIFEST, \{/, 'caching strategy stays workbox-owned');
});

// Agent 4 (IA) completed the documented mount on 2026-09-20: Shell.jsx stays
// untouched; views.jsx routes `offline` through OfflineView.jsx, which renders
// <OfflineP2P> with the contract props from agent2-integration.md.
test('offline mount completed by Agent 4 per the integration contract', () => {
  assert.doesNotMatch(read('../src/components/Shell.jsx'), /OfflineP2P/, 'Shell must stay untouched');
  const views = read('../src/views.jsx');
  assert.match(views, /OfflineView/, 'views.jsx must route the offline view');
  const shell = read('../src/components/OfflineView.jsx');
  assert.match(shell, /<OfflineP2P/, 'the offline route shell must render the panel');
  assert.match(shell, /demoMode=\{demoMode\}/, 'relay stays demo-gated');
});

test('offlinep2p strings exist in EN/HI/TE with no Tamil script', () => {
  const code = read('../src/strings/areas/offlinep2p.js');
  for (const lang of ['en:', 'hi:', 'te:']) assert.match(code, new RegExp(`^  ${lang}`, 'm'), `missing ${lang} block`);
  for (const key of ['op2pTitle', 'op2pRelayBtn', 'op2pRelayFailed', 'agoMin', 'op2pQueueReplay', 'op2pTrActive']) {
    const hits = code.match(new RegExp(`${key}:`, 'g')) || [];
    assert.equal(hits.length, 3, `${key} must be translated in all three languages`);
  }
  // Tamil Unicode block U+0B80–U+0BFF must never appear.
  assert.doesNotMatch(code, /[\u0B80-\u0BFF]/, 'no Tamil script content');
});

// --- Worker 5 (offline + P2P testability) -------------------------------------
test('sw.js serves the app shell for deep-link navigations when offline', () => {
  const code = read('../src/sw.js');
  assert.match(code, /NavigationRoute/, 'must register a navigation fallback route');
  assert.match(code, /createHandlerBoundToURL\('\/index\.html'\)/, 'fallback must serve the precached shell');
  // API traffic must keep failing loudly offline — never served from cache.
  assert.match(code, /denylist/, 'the navigation route must denylist API paths');
  assert.match(code, /\^\\\/api/, 'the denylist must cover /api');
  // Caching stays workbox-owned; the push/message handlers are untouched.
  assert.match(code, /precacheAndRoute\(self\.__WB_MANIFEST\)/, 'precache stays workbox-owned');
  assert.match(code, /addEventListener\('push'/, 'push handler must be untouched');
  assert.match(code, /addEventListener\('notificationclick'/, 'notificationclick handler must be untouched');
  assert.match(code, /OFFLINE_PROBE/, 'offline probe handler must be untouched');
});

test('offline.js exposes the shell probe and demo-alerts snapshot helpers', () => {
  const code = read('../src/offline.js');
  assert.match(code, /export function probeOfflineShell/, 'shell readiness probe must exist');
  assert.match(code, /OFFLINE_PROBE/, 'probe must use the SW message channel');
  assert.match(code, /no-controller/, 'a page with no controlling worker must report not-ready');
  assert.match(code, /export function saveDemoAlertsSnapshot/, 'demo alerts snapshot saver must exist');
  assert.match(code, /export function readDemoAlertsSnapshot/, 'demo alerts snapshot reader must exist');
  assert.match(code, /Array\.isArray\(d\.alerts\)/, 'the reader must never invent a list');
});

test('OfflineP2P keeps the two-tab relay flow live and offers the offline simulator', () => {
  const code = read('../src/components/OfflineP2P.jsx');
  assert.match(code, /BroadcastChannel/, 'sibling tabs must hear about a finished relay instantly');
  assert.match(code, /saarthi-p2p-relay/, 'the channel name must be stable for both tabs');
  assert.match(code, /setInterval\(loadRelayLog/, 'the relay log must poll for second-device relays');
  assert.match(code, /op2pRelayArrived/, 'cross-tab arrival must be announced, translated');
  assert.match(code, /api\.demoAlerts\(district\)/, 'the panel must fetch demo alerts for the relay picker');
  assert.match(code, /saveDemoAlertsSnapshot/, 'demo alerts must be snapshotted for offline');
  assert.match(code, /onToggleSimOffline/, 'the built-in offline simulator toggle must be wired');
  assert.match(code, /op2pSimulateOffline/, 'the simulator label must be translated');
  assert.match(code, /probeOfflineShell/, 'the shell-readiness chip must probe the worker');
  assert.match(code, /op2pShellSaved|op2pShellNotSaved/, 'shell state must be labelled honestly');
  assert.match(code, /p2pSimulated/, 'the SIMULATED stamp stays unconditional');
});

test('OfflineView wires the simulator and merges demo alerts without touching the store', () => {
  const code = read('../src/components/OfflineView.jsx');
  assert.match(code, /simOffline, setSimOffline/, 'must read the store simulator state');
  assert.match(code, /onToggleSimOffline=\{/, 'must pass the toggle down to the panel');
  assert.match(code, /demo_alerts/, 'must merge the demo-alerts snapshot into the alert list');
  assert.doesNotMatch(code, /setOfflineSim\(/, 'must not call the API cut directly — the store owns that');
});

test('Worker 5 strings exist in EN/HI/TE with no Tamil script', () => {
  const code = read('../src/strings/areas/offlinep2p.js');
  for (const key of ['op2pShellSaved', 'op2pShellNotSaved', 'op2pShellChecking',
                     'op2pSimulateOffline', 'op2pSimulateOfflineNote', 'op2pRelayArrived']) {
    const hits = code.match(new RegExp(`${key}:`, 'g')) || [];
    assert.equal(hits.length, 3, `${key} must be translated in all three languages`);
  }
  assert.match(code, /Worker 5/, 'new strings must sit in a clearly-marked block');
  assert.doesNotMatch(code, /[\u0B80-\u0BFF]/, 'no Tamil script content');
});
