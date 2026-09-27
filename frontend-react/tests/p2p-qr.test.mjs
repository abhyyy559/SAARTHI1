// QR P2P relay tests.
//
// Two layers:
//  1. Real unit tests over frontend-react/src/p2pqr.js (dependency-free, so
//     it imports cleanly in plain node): framing, chunking, reassembly,
//     checksums, hop limits, provenance.
//  2. Source-level contracts over QrRelay.jsx / QrScan.jsx: the sender path
//     makes ZERO network calls, the real QR path never carries the SIMULATED
//     stamp, and the P2P provenance badge is unconditional.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  HOP_LIMIT_CRITICAL,
  HOP_LIMIT_NORMAL,
  buildEnvelope,
  canRelay,
  chunkEnvelope,
  hashString,
  hopLimitFor,
  isOfficialAlert,
  nextHop,
  parseFrame,
  queueP2PAck,
  readP2PAcks,
  reassembleFrames,
  sanitizeAlert,
  syncP2PAcks,
} from '../src/p2pqr.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// In-memory localStorage for the ack-queue tests (p2pqr.js touches it only
// inside functions, so stubbing here is enough).
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
};

const ALERT = {
  id: 'cap-thunder-1',
  title: 'Thunderstorm with lightning likely at isolated places.',
  severity: 'ORANGE',
  hazard: 'thunderstorm',
  description: 'Stay indoors.',
  instruction: 'Unplug appliances.',
  source: 'NDMA-SACHET CAP',
  official: true, // explicit flag on the sender's data — the ONLY thing that badges Official
  starts_at: '2026-09-21T14:00:00+05:30',
  ends_at: '2026-09-21T19:00:00+05:30',
};

// --- hashing ---------------------------------------------------------------
test('hashString is deterministic and distinguishes inputs', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
  assert.match(hashString('abc'), /^[0-9a-f]{8}$/);
});

// --- hop policy ------------------------------------------------------------
test('hopLimitFor: normal alerts get 5, RED/critical get 10', () => {
  assert.equal(hopLimitFor({ severity: 'ORANGE' }), HOP_LIMIT_NORMAL);
  assert.equal(hopLimitFor({ severity: 'YELLOW' }), HOP_LIMIT_NORMAL);
  assert.equal(hopLimitFor({}), HOP_LIMIT_NORMAL);
  assert.equal(hopLimitFor({ severity: 'RED' }), HOP_LIMIT_CRITICAL);
  assert.equal(hopLimitFor({ severity: 'severe' }), HOP_LIMIT_CRITICAL);
  assert.equal(hopLimitFor({ level: 'EXTREME' }), HOP_LIMIT_CRITICAL);
});

test('isOfficialAlert is fail-closed: ONLY an explicit official:true flag counts', () => {
  assert.equal(isOfficialAlert({ official: true, source: 'x' }), true);
  // Source-name sniffing must NOT badge Official — these are all community.
  assert.equal(isOfficialAlert({ source: 'NDMA-SACHET CAP' }), false);
  assert.equal(isOfficialAlert({ source: 'IMD' }), false);
  assert.equal(isOfficialAlert({ source: 'CAP volunteer team' }), false);
  assert.equal(isOfficialAlert({ source: 'community' }), false);
  assert.equal(isOfficialAlert({ official: false, source: 'NDMA-SACHET CAP' }), false);
  assert.equal(isOfficialAlert({}), false);
  assert.equal(isOfficialAlert(null), false);
});

test('official:false is never upgraded by a source name in the envelope', () => {
  const env = envelopeOf({ ...ALERT, official: false });
  assert.equal(env.official, false);
});

// --- sanitize ----------------------------------------------------------------
test('sanitizeAlert keeps essential fields, drops unknown bloat, caps strings', () => {
  const clean = sanitizeAlert({ ...ALERT, injected: 'x'.repeat(5000), description: 'd'.repeat(5000) });
  assert.equal(clean.injected, undefined);
  assert.equal(clean.title, ALERT.title);
  assert.ok(clean.description.length <= 1200);
  assert.equal(clean.id, 'cap-thunder-1');
});

test('sanitizeAlert derives a stable id when none is present', () => {
  const a = sanitizeAlert({ title: 'Flood' });
  const b = sanitizeAlert({ title: 'Flood' });
  assert.ok(a.id.startsWith('p2p-'));
  assert.equal(a.id, b.id); // same content -> same id -> dedupes on re-scan
});

test('sanitizeAlert rejects empty input', () => {
  assert.equal(sanitizeAlert(null), null);
  assert.equal(sanitizeAlert('nope'), null);
});

// --- envelope + chunk round-trip --------------------------------------------
function envelopeOf(alert = ALERT, opts = {}) {
  const r = buildEnvelope(alert, opts);
  assert.equal(r.ok, true, `buildEnvelope failed: ${r.error}`);
  return r.envelope;
}

test('single-frame round-trip: chunk then reassemble returns the envelope', () => {
  const env = envelopeOf();
  const frames = chunkEnvelope(env);
  assert.equal(frames.length, 1);
  const r = reassembleFrames(frames);
  assert.equal(r.complete, true);
  assert.equal(r.ok, true);
  assert.equal(r.envelope.alert.title, ALERT.title);
  assert.equal(r.envelope.official, true); // official provenance survives
  assert.equal(r.envelope.hop_limit, HOP_LIMIT_NORMAL);
});

test('multi-frame round-trip: a long alert splits and reassembles', () => {
  const big = { ...ALERT, description: 'Rain. '.repeat(600) };
  const env = envelopeOf(big);
  const frames = chunkEnvelope(env, 200); // force many frames
  assert.ok(frames.length > 3, `expected several frames, got ${frames.length}`);
  const r = reassembleFrames(frames);
  assert.equal(r.complete, true);
  assert.equal(r.ok, true);
  assert.equal(r.envelope.alert.description, big.description.slice(0, 1200));
});

test('out-of-order frames reassemble (camera catches frames in any order)', () => {
  const env = envelopeOf();
  const frames = chunkEnvelope(env, 200);
  const shuffled = [...frames].reverse();
  const r = reassembleFrames(shuffled);
  assert.equal(r.complete, true);
  assert.equal(r.ok, true);
  assert.equal(r.envelope.relay_id, env.relay_id);
});

test('duplicate scans are ignored, not double-counted', () => {
  const env = envelopeOf();
  const frames = chunkEnvelope(env, 200);
  const r = reassembleFrames([...frames, ...frames, ...frames]);
  assert.equal(r.complete, true);
  assert.equal(r.ok, true);
});

test('a missing frame reports incomplete with the exact missing indices', () => {
  const env = envelopeOf();
  const frames = chunkEnvelope(env, 200);
  assert.ok(frames.length >= 3);
  const partial = frames.filter((_, i) => i !== 1);
  const r = reassembleFrames(partial);
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, [1]);
  assert.equal(r.received, frames.length - 1);
  assert.equal(r.total, frames.length);
});

test('a corrupted frame fails the checksum instead of delivering garbage', () => {
  const env = envelopeOf();
  const frames = chunkEnvelope(env, 200);
  const tampered = frames.map((f, i) => {
    if (i !== 0) return f;
    const o = JSON.parse(f);
    o.d = o.d.slice(0, -2) + (o.d.endsWith('aa') ? 'bb' : 'aa');
    return JSON.stringify(o);
  });
  const r = reassembleFrames(tampered);
  assert.equal(r.complete, true);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'checksum');
});

test('frames from a different relay never mix into this one', () => {
  const envA = envelopeOf({ ...ALERT, id: 'a' });
  const envB = envelopeOf({ ...ALERT, id: 'b' });
  const framesA = chunkEnvelope(envA, 200);
  const framesB = chunkEnvelope(envB, 200);
  // A completes on its own; B's stray frame is ignored, never merged.
  const r = reassembleFrames([...framesA, framesB[0]]);
  assert.equal(r.complete, true);
  assert.equal(r.ok, true);
  assert.equal(r.envelope.alert.id, 'a');
  // And a lone stray frame from another relay cannot complete anything.
  const r2 = reassembleFrames([framesB[0]]);
  assert.equal(r2.complete, false);
});

// --- parseFrame --------------------------------------------------------------
test('parseFrame rejects non-relay QR codes without throwing', () => {
  assert.equal(parseFrame('').ok, false);
  assert.equal(parseFrame('not json').ok, false);
  assert.equal(parseFrame(JSON.stringify({ kind: 'something-else' })).ok, false);
  assert.equal(parseFrame(JSON.stringify({ kind: 'saarthi-p2p-frame', v: 999 })).ok, false);
  const env = envelopeOf();
  const good = chunkEnvelope(env)[0];
  assert.equal(parseFrame(good).ok, true);
  assert.equal(parseFrame(JSON.stringify({ ...JSON.parse(good), i: 99 })).ok, false); // bad index
});

// --- hop enforcement -----------------------------------------------------------
test('canRelay refuses at the limit; nextHop increments and re-mints the relay id', () => {
  const env = envelopeOf(); // normal: limit 5
  assert.equal(canRelay({ ...env, hops: 4 }), true);
  assert.equal(canRelay({ ...env, hops: 5 }), false);
  const nxt = nextHop({ ...env, hops: 4 }, 'phone-b');
  assert.ok(nxt);
  assert.equal(nxt.hops, 5);
  assert.notEqual(nxt.relay_id, env.relay_id); // fresh id: frames never mix
  assert.deepEqual(nxt.path, ['phone-b']);
  assert.equal(canRelay(nxt), false); // at the limit now
  assert.equal(nextHop(nxt, 'phone-c'), null); // must refuse
});

test('a received relay keeps its hop count when re-relayed', () => {
  const env = envelopeOf(ALERT, { hops: 2 });
  const nxt = nextHop(env, 'phone-c');
  assert.equal(nxt.hops, 3);
  assert.equal(nxt.hop_limit, env.hop_limit);
});

test('canRelay rejects malformed envelopes instead of relaying blindly', () => {
  assert.equal(canRelay(null), false);
  assert.equal(canRelay({}), false);
  assert.equal(canRelay({ hops: 0 }), false);
});

test('buildEnvelope refuses oversized alerts instead of emitting 40 QR codes', () => {
  const huge = { ...ALERT, description: 'x'.repeat(20000) };
  // sanitize caps each string field at 1200 chars, so this stays fittable…
  const r = buildEnvelope(huge);
  assert.equal(r.ok, true);
  // …but a genuinely oversized envelope is refused, not truncated mid-field.
  const fat = { id: 'fat' };
  for (const f of ['title', 'headline', 'description', 'instruction', 'area', 'district', 'event', 'urgency', 'certainty', 'source']) {
    fat[f] = 'x'.repeat(1200);
  }
  const r2 = buildEnvelope(fat);
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'too-large');
  assert.ok(r2.size > 12000);
});

// --- ack queue -----------------------------------------------------------------
test('ack queue dedupes by relay and syncs through the api client', async () => {
  memStore.clear();
  queueP2PAck({ alert_id: 'a1', relay_id: 'r1', hops: 1, device: 'phone-x' });
  queueP2PAck({ alert_id: 'a1', relay_id: 'r1', hops: 1, device: 'phone-x' }); // dup
  queueP2PAck({ alert_id: 'a2', relay_id: 'r2', hops: 2, device: 'phone-x' });
  assert.equal(readP2PAcks().length, 2);
  const calls = [];
  const api = { notificationsAck: async (p) => { calls.push(p); } };
  const { sent, kept } = await syncP2PAcks(api, 'phone-x');
  assert.equal(sent, 2);
  assert.equal(kept.length, 0);
  assert.equal(readP2PAcks().length, 0);
  assert.deepEqual(calls[0], { alert_id: 'a1', device: 'phone-x' });
});

test('failed ack syncs stay queued for the next attempt', async () => {
  memStore.clear();
  queueP2PAck({ alert_id: 'a1', relay_id: 'r9', hops: 1, device: 'phone-x' });
  const api = { notificationsAck: async () => { throw new Error('offline'); } };
  const { sent, kept } = await syncP2PAcks(api, 'phone-x');
  assert.equal(sent, 0);
  assert.equal(kept.length, 1);
  assert.equal(readP2PAcks().length, 1);
});

// --- source contracts ----------------------------------------------------------
test('QrRelay.jsx: the sender path makes zero network calls', () => {
  const src = read('../src/components/QrRelay.jsx');
  assert.ok(!src.includes('fetch('), 'sender must never fetch');
  assert.ok(!src.includes('XMLHttpRequest'), 'sender must never XHR');
  assert.ok(!/api\.\w+\(/.test(src), 'sender must not call the backend client');
  assert.ok(!src.includes('axios'), 'sender must not use axios');
});

test('QrScan.jsx: the only network call is the queued ack via the api prop', () => {
  const src = read('../src/components/QrScan.jsx');
  assert.ok(!src.includes('fetch('), 'scanner must never fetch directly');
  assert.ok(!src.includes('XMLHttpRequest'), 'scanner must never XHR');
  // The ack sync goes through the injected api client, never a raw call.
  assert.ok(src.includes('syncP2PAcks(api'), 'acks sync via the api prop');
});

// The separate P2P page was removed in Phase 1 (the QR relay is a background
// capability only), so embedding is a prop contract now, not a panel check.
test('QrRelay.jsx: bare mode avoids duplicate card titles when embedded', () => {
  const src = read('../src/components/QrRelay.jsx');
  assert.ok(src.includes('bare'), 'bare prop exists for embedding');
  assert.ok(/bare[\s\S]*?Card/.test(src), 'bare mode renders via Card');
});

test('the real QR path never wears the SIMULATED stamp', () => {
  for (const f of ['../src/components/QrRelay.jsx', '../src/components/QrScan.jsx', '../src/p2pqr.js']) {
    const src = read(f);
    assert.ok(!src.includes('p2pSimulated'), `${f} must not claim SIMULATED`);
    assert.ok(!src.includes('ntfSimulatedTag'), `${f} must not claim SIMULATED`);
  }
});

test('QrScan.jsx: P2P provenance badge and no-server-verification note are unconditional', () => {
  const src = read('../src/components/QrScan.jsx');
  assert.ok(src.includes("t(lang, 'qrViaP2p')"), 'via-P2P badge must always render');
  assert.ok(src.includes("t(lang, 'qrReceivedSub')"), 'could-not-verify note must always render');
  assert.ok(src.includes("t(lang, 'qrOfficialKept')"), 'official source badge kept');
  assert.ok(src.includes("t(lang, 'qrCommunityKept')"), 'community never upgraded to official');
});

test('p2pqr strings exist in all three languages', () => {
  const src = read('../src/strings/areas/p2pqr.js');
  for (const key of ['qrTitle', 'qrViaP2p', 'qrReceivedSub', 'qrHopChip', 'qrChecksumFail', 'qrAckQueued']) {
    const occurrences = src.split(key + ':').length - 1;
    assert.equal(occurrences, 3, `string key ${key} must exist in en/hi/te`);
  }
});

// (The old 'OfflineP2P.jsx mounts the QR card' test was removed with the
// P2P page in Phase 1; QrRelay/QrScan import coverage above still holds.)

