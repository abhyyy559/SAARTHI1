// Phone-to-phone mesh client.
//
// In the Android app this drives the native Bluetooth relay (the BleMesh
// plugin in android/app/src/main/java/.../mesh). In a plain browser, where
// Bluetooth phone-to-phone is impossible, it falls back to a SIMULATION:
// every open tab of this site in the same browser acts as a nearby phone, so
// the flow can be shown on a laptop. The simulation is labelled as such in
// the UI and its messages are never sent to the server.
//
// When a phone has internet it also works as a gateway: it hands the SOS
// messages it carries to the server, and drops the server's signed official
// alerts into the mesh for phones that have no connection.
import { useSyncExternalStore } from 'react';
import { registerPlugin } from '@capacitor/core';
import { api, apiBase } from '../api';
import { gatewayBatch, mergeMessages } from './meshLogic';

const BleMesh = registerPlugin('BleMesh');

const LS_ENABLED = 'wgpt.mesh.on';
const LS_ASKED = 'wgpt.mesh.asked';
const LS_UPLOADED = 'wgpt.mesh.uploaded';
const LS_SIM = 'wgpt.mesh.sim';
const LS_SIM_NODE = 'wgpt.mesh.simNode';
const LS_NAME = 'wgpt.mesh.name';
const SIM_CHANNEL = 'saarthi-mesh-sim';
const SIM_KEEP = 200;
const GATEWAY_EVERY_MS = 60_000;

const RULES = {
  sos: { hl: 0, ttl: 72 * 3600 },
  sos_upd: { hl: 0, ttl: 72 * 3600 },
  safe: { hl: 7, ttl: 24 * 3600 },
  report: { hl: 5, ttl: 12 * 3600 },
};

const read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

export const isNative = () => {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch { return false; }
};

// ---------------------------------------------------------------- the store

let state = {
  mode: 'sim', // 'native' | 'sim'
  ready: false,
  nodeId: '',
  status: { running: false, peers: 0, bluetoothOn: true, permissions: {} },
  messages: [],
  // The newest message from another phone, for the "SOS nearby" popup.
  incoming: null,
  openView: null,
};
const subs = new Set();
const set = (patch) => {
  state = { ...state, ...patch };
  subs.forEach((fn) => fn());
};
export const getMesh = () => state;
export const subscribeMesh = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export function useMesh() {
  return useSyncExternalStore(subscribeMesh, getMesh, getMesh);
}

function accept(message, mine) {
  if (!message || !message.id) return;
  const known = state.messages.some((m) => m.id === message.id);
  const messages = mergeMessages(state.messages, [message]);
  const patch = { messages };
  if (!known && !mine) patch.incoming = { message, at: Date.now() };
  set(patch);
  if (!known) scheduleGateway(1500);
}

export const myName = () => read(LS_NAME, '');
export const setMyName = (n) => write(LS_NAME, String(n || '').slice(0, 40));
export const meshEnabled = () => read(LS_ENABLED, '1') === '1';
export const clearIncoming = () => set({ incoming: null });
export const clearOpenView = () => set({ openView: null });

// ------------------------------------------------------------ native relay

async function initNative() {
  set({ mode: 'native' });
  await BleMesh.addListener('message', (ev) => accept(ev.message, ev.mine));
  await BleMesh.addListener('status', (s) => set({ status: { ...state.status, ...s } }));
  await BleMesh.addListener('open', (ev) => set({ openView: ev.view || null }));
  try {
    const { view } = await BleMesh.launchView();
    if (view) set({ openView: view });
  } catch { /* older build */ }
  try {
    const { messages, nodeId } = await BleMesh.list();
    set({ messages: mergeMessages(state.messages, messages), nodeId });
  } catch { /* nothing stored yet */ }
  if (meshEnabled()) {
    // Ask for Bluetooth/location/notification permission once, on first run;
    // after that start quietly and let the Nearby screen offer the button.
    const first = read(LS_ASKED, '') !== '1';
    write(LS_ASKED, '1');
    await start({ silent: !first });
  } else {
    await refreshStatus();
  }
}

export async function start({ silent = false } = {}) {
  write(LS_ENABLED, '1');
  if (state.mode !== 'native') {
    set({ status: { ...state.status, running: true } });
    return state.status;
  }
  try {
    const s = await BleMesh.start({ silent });
    set({ status: s, nodeId: s.nodeId || state.nodeId });
    return s;
  } catch (e) {
    set({ status: { ...state.status, error: String(e && e.message ? e.message : e) } });
    return state.status;
  }
}

export async function stop() {
  write(LS_ENABLED, '0');
  if (state.mode !== 'native') {
    set({ status: { ...state.status, running: false } });
    return;
  }
  try { set({ status: await BleMesh.stop() }); } catch { /* already stopped */ }
}

export async function refreshStatus() {
  if (state.mode !== 'native') return state.status;
  try {
    const s = await BleMesh.status();
    set({ status: s, nodeId: s.nodeId || state.nodeId });
  } catch { /* plugin missing */ }
  return state.status;
}

export async function enableBluetooth() {
  if (state.mode !== 'native') return;
  try { set({ status: await BleMesh.enableBluetooth() }); } catch { /* refused */ }
}

// ------------------------------------------------------- browser simulation

let channel = null;
const simPeers = new Map(); // node -> last heard (ms)

function simNode() {
  let id = read(LS_SIM_NODE, '');
  if (!/^[0-9a-f]{16}$/.test(id)) {
    const b = new Uint8Array(8);
    (globalThis.crypto || window.crypto).getRandomValues(b);
    id = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    write(LS_SIM_NODE, id);
  }
  return id;
}

function simPeerCount() {
  const now = Date.now();
  for (const [k, t] of simPeers) if (now - t > 20_000) simPeers.delete(k);
  return simPeers.size;
}

function simSave() {
  const keep = state.messages.filter((m) => m.sim).slice(-SIM_KEEP);
  write(LS_SIM, JSON.stringify(keep));
}

function initSim() {
  const node = simNode();
  const stored = readJson(LS_SIM, []).filter((m) => Number(m.exp) > Date.now() / 1000);
  set({
    mode: 'sim',
    nodeId: node,
    messages: mergeMessages(state.messages, stored),
    status: { running: meshEnabled(), peers: 0, bluetoothOn: true, sim: true, permissions: { bluetooth: true } },
  });
  if (typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(SIM_CHANNEL);
  channel.onmessage = (ev) => {
    const d = ev.data || {};
    if (d.from === node) return;
    simPeers.set(d.from, Date.now());
    if (d.kind === 'hello' && state.status.running) {
      // A tab that just opened gets everything this "phone" carries (store and forward).
      channel.postMessage({ kind: 'sync', from: node, messages: state.messages.filter((m) => m.sim) });
    }
    if (!state.status.running) return;
    const incoming = d.kind === 'msg' ? [d.message] : d.kind === 'sync' ? d.messages || [] : [];
    for (const m of incoming) {
      if (!m || state.messages.some((x) => x.id === m.id)) continue;
      accept({ ...m, h: (Number(m.h) || 0) + 1 }, false);
    }
    simSave();
    set({ status: { ...state.status, peers: simPeerCount() } });
  };
  const hello = () => {
    channel.postMessage({ kind: 'hello', from: node });
    set({ status: { ...state.status, peers: simPeerCount() } });
  };
  hello();
  setInterval(hello, 8000);
}

function simMessage(type, payload) {
  const r = RULES[type];
  const ts = Math.floor(Date.now() / 1000);
  const b = new Uint8Array(8);
  (globalThis.crypto || window.crypto).getRandomValues(b);
  return {
    v: 1, t: type, id: [...b].map((x) => x.toString(16).padStart(2, '0')).join(''),
    o: state.nodeId, ts, exp: ts + r.ttl, h: 0, hl: r.hl, p: JSON.stringify(payload), sim: true,
  };
}

// ---------------------------------------------------------------- sending

/** Send a message from this phone. Kept and passed on even with nobody in range yet. */
export async function send(type, payload) {
  if (state.mode === 'native') {
    const { message } = await BleMesh.send({ type, payload });
    accept(message, true);
    return message;
  }
  const m = simMessage(type, payload);
  accept(m, true);
  simSave();
  if (channel && state.status.running) channel.postMessage({ kind: 'msg', from: state.nodeId, message: m });
  return m;
}

export const sendUpdate = (ref, st) => send('sos_upd', { ref, st });

// ---------------------------------------------------------------- gateway

let gatewayTimer = null;
function scheduleGateway(ms) {
  clearTimeout(gatewayTimer);
  gatewayTimer = setTimeout(() => { gateway(lastDistrict).catch(() => {}); }, ms);
}

/** Hand carried SOS messages to the server, and bring official alerts back. */
export async function gateway(district) {
  if (state.mode !== 'native') return { skipped: 'simulation' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { skipped: 'offline' };
  if (!apiBase() && isNative()) return { skipped: 'no server address' };
  const uploaded = readJson(LS_UPLOADED, []);
  const batch = gatewayBatch(state.messages, uploaded);
  const out = {};
  if (batch.length) {
    const r = await api.meshRelay(batch);
    const refused = new Set((r.rejected || []).map((x) => x.id));
    const ok = batch.map((m) => m.id).filter((id) => !refused.has(id));
    write(LS_UPLOADED, JSON.stringify([...uploaded, ...ok].slice(-2000)));
    out.uploaded = ok.length;
  }
  if (district) {
    const a = await api.meshAlerts(district);
    if (a && a.key) await BleMesh.setAlertKey({ key: a.key });
    let added = 0;
    for (const m of (a && a.messages) || []) {
      const r = await BleMesh.ingest({ message: m });
      if (r.accepted) added += 1;
    }
    out.alerts = added;
  }
  return out;
}

// ------------------------------------------------------------------- start

let started = false;
let lastDistrict = '';
export function initMesh() {
  if (started) return;
  started = true;
  const run = isNative() ? initNative : initSim;
  Promise.resolve(run())
    .catch(() => { /* the relay is an extra; the app works without it */ })
    .finally(() => set({ ready: true }));
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => scheduleGateway(500));
    setInterval(() => { gateway(lastDistrict).catch(() => {}); }, GATEWAY_EVERY_MS);
  }
}

/** The app tells the mesh which district it is showing, for the alert hand-off. */
export function setMeshDistrict(d) {
  if (d && d !== lastDistrict) {
    lastDistrict = d;
    scheduleGateway(2000);
  }
}

/** Current position for an SOS: GPS when it answers quickly, else null. */
export function currentPosition(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => finish({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
