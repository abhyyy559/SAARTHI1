// Phone-to-phone mesh: the pure part (no React, no Bluetooth), so it is
// unit-tested directly. The Android code moves and verifies messages; this
// file turns the pile of messages a phone holds into what a person needs:
// who needs help, how far away, in which direction, and whether someone is
// already on the way.
//
// Message shape (same as MeshProtocol.java / mesh_service.py):
//   { v, t, id, o (sender's node id), ts, exp, h (phones it passed through),
//     hl, p (payload JSON string), s (signature) }
// Types: sos · sos_upd (going / rescued / cancel) · safe · report · alert

export const NOTE_MAX = 140;
export const NEEDS = ['medical', 'trapped', 'water', 'fire', 'flood', 'other'];
// How long a "safe" check-in stays on screen, matching its mesh lifetime.
export const SAFE_TTL_SEC = 24 * 3600;

const RAD = Math.PI / 180;
const finite = (x) => typeof x === 'number' && Number.isFinite(x);

export function haversineKm(a, b) {
  if (!a || !b || !finite(a.lat) || !finite(a.lon) || !finite(b.lat) || !finite(b.lon)) return null;
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Initial bearing from a to b, 0-360 (0 = north). */
export function bearingDeg(a, b) {
  if (!a || !b || !finite(a.lat) || !finite(a.lon) || !finite(b.lat) || !finite(b.lon)) return null;
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD)
    - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compass8(deg) {
  if (!finite(deg)) return null;
  return COMPASS8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** "80 m", "1.2 km", "14 km" — short, never more precision than GPS gives. */
export const VERY_CLOSE_KM = 0.03;
export function formatDistance(km) {
  if (!finite(km)) return '';
  // Inside GPS error: a number and a direction would be made up.
  if (km < VERY_CLOSE_KM) return '< 30 m';
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function parsePayload(m) {
  try {
    const p = JSON.parse(m && m.p ? m.p : '{}');
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch { return {}; }
}

const num = (x) => (finite(Number(x)) && x !== null && x !== '' ? Number(x) : null);

/** The payload for a new SOS: trimmed, bounded, coordinates rounded to ~1 m. */
export function sosPayload({ need, note, name, people, lat, lon, acc } = {}) {
  const out = { need: NEEDS.includes(need) ? need : 'other' };
  const n = String(note || '').trim().slice(0, NOTE_MAX);
  if (n) out.note = n;
  const who = String(name || '').trim().slice(0, 40);
  if (who) out.name = who;
  const ppl = Math.round(Number(people));
  if (ppl > 1) out.ppl = Math.min(ppl, 999);
  if (finite(lat) && finite(lon)) {
    out.lat = Math.round(lat * 1e5) / 1e5;
    out.lon = Math.round(lon * 1e5) / 1e5;
    if (finite(acc)) out.acc = Math.round(acc);
  }
  return out;
}

/** "I'm safe": the place is rounded to ~1 km, enough for family, not a home address. */
export function safePayload({ name, lat, lon } = {}) {
  const out = {};
  const who = String(name || '').trim().slice(0, 40);
  if (who) out.name = who;
  if (finite(lat) && finite(lon)) {
    out.lat = Math.round(lat * 100) / 100;
    out.lon = Math.round(lon * 100) / 100;
  }
  return out;
}

/** The existing Emergency console's message types, mapped onto the mesh. */
export function emergencyToMesh(messageType, medical) {
  switch (messageType) {
    case 'IM_SAFE': return { type: 'safe' };
    case 'MEDICAL_HELP': return { type: 'sos', need: 'medical' };
    case 'PEOPLE_TRAPPED': return { type: 'sos', need: 'trapped' };
    case 'NEED_WATER':
    case 'NEED_FOOD': return { type: 'sos', need: 'water' };
    case 'DANGER_HERE': return { type: 'sos', need: 'other' };
    case 'ROAD_BLOCKED': return { type: 'report', kind: 'road' };
    case 'IM_HERE': return { type: 'report', kind: 'here' };
    default: return { type: 'sos', need: medical ? 'medical' : 'other' };
  }
}

/** Add messages to a list, keeping one copy per id (the fewest hops wins). */
export function mergeMessages(list, incoming) {
  const byId = new Map((list || []).map((m) => [m.id, m]));
  for (const m of incoming || []) {
    if (!m || !m.id) continue;
    const prev = byId.get(m.id);
    if (!prev || (Number(m.h) || 0) < (Number(prev.h) || 0)) byId.set(m.id, m);
  }
  return [...byId.values()];
}

/**
 * Every SOS this phone knows of, with its latest status.
 *   going   — anyone can say they are on the way (counted once per phone)
 *   rescued — anyone can close it (the helper who got there)
 *   cancel  — only the phone that sent the SOS (a false alarm)
 */
export function foldIncidents(messages, myNode, nowSec = Date.now() / 1000) {
  const live = (messages || []).filter((m) => m && Number(m.exp) > nowSec);
  const out = new Map();
  for (const m of live) {
    if (m.t !== 'sos') continue;
    const p = parsePayload(m);
    out.set(m.id, {
      id: m.id,
      origin: m.o,
      mine: !!myNode && m.o === myNode,
      ts: Number(m.ts) || 0,
      exp: Number(m.exp) || 0,
      hops: Number(m.h) || 0,
      lat: num(p.lat),
      lon: num(p.lon),
      acc: num(p.acc),
      need: NEEDS.includes(p.need) ? p.need : 'other',
      note: typeof p.note === 'string' ? p.note.slice(0, NOTE_MAX) : '',
      name: typeof p.name === 'string' ? p.name.slice(0, 40) : '',
      people: Math.max(1, Math.round(Number(p.ppl) || 1)),
      status: 'active',
      responders: [],
      iAmGoing: false,
      sim: !!m.sim,
    });
  }
  const updates = live.filter((m) => m.t === 'sos_upd').sort((a, b) => (a.ts || 0) - (b.ts || 0));
  for (const u of updates) {
    const p = parsePayload(u);
    const inc = out.get(p.ref);
    if (!inc) continue;
    if (p.st === 'going' && !inc.responders.includes(u.o)) {
      inc.responders.push(u.o);
      if (myNode && u.o === myNode) inc.iAmGoing = true;
    } else if (p.st === 'rescued') {
      inc.status = 'rescued';
    } else if (p.st === 'cancel' && u.o === inc.origin) {
      inc.status = 'cancelled';
    }
  }
  return [...out.values()];
}

/** Open calls first; then nearest when we know where we are, else newest. */
export function sortIncidents(list, here) {
  const withPlace = list.map((i) => {
    const km = haversineKm(here, i);
    const deg = bearingDeg(here, i);
    return { ...i, km, dir: km != null && km >= VERY_CLOSE_KM ? compass8(deg) : null };
  });
  return withPlace.sort((a, b) => {
    const oa = a.status === 'active' ? 0 : 1;
    const ob = b.status === 'active' ? 0 : 1;
    if (oa !== ob) return oa - ob;
    if (a.km != null && b.km != null && a.km !== b.km) return a.km - b.km;
    return b.ts - a.ts;
  });
}

/** Latest "I'm safe" per person. */
export function safeCheckins(messages, nowSec = Date.now() / 1000) {
  const latest = new Map();
  for (const m of messages || []) {
    if (!m || m.t !== 'safe' || Number(m.exp) <= nowSec) continue;
    const prev = latest.get(m.o);
    if (!prev || prev.ts < m.ts) latest.set(m.o, m);
  }
  return [...latest.values()]
    .map((m) => { const p = parsePayload(m); return { origin: m.o, ts: Number(m.ts) || 0, hops: Number(m.h) || 0, name: typeof p.name === 'string' ? p.name : '', lat: num(p.lat), lon: num(p.lon) }; })
    .sort((a, b) => b.ts - a.ts);
}

/** Official alerts that arrived phone to phone (server-signed, checked on the phone). */
export function relayedAlerts(messages, nowSec = Date.now() / 1000) {
  return (messages || [])
    .filter((m) => m && m.t === 'alert' && Number(m.exp) > nowSec)
    .map((m) => ({ id: m.id, ts: Number(m.ts) || 0, hops: Number(m.h) || 0, ...parsePayload(m) }))
    .sort((a, b) => b.ts - a.ts);
}

/** Messages a phone that just got internet should hand to the server. */
export function gatewayBatch(messages, uploaded, nowSec = Date.now() / 1000, max = 200) {
  const done = new Set(uploaded || []);
  return (messages || [])
    .filter((m) => m && ['sos', 'sos_upd', 'safe'].includes(m.t) && m.s && !m.sim
      && Number(m.exp) > nowSec && !done.has(m.id))
    .slice(0, max);
}

/** Minutes/hours ago, in the user's language. */
export function ago(tsSec, lang = 'en', nowMs = Date.now()) {
  if (!finite(Number(tsSec)) || !tsSec) return '';
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'te' ? 'te-IN' : 'en-IN';
  const mins = Math.round((nowMs - Number(tsSec) * 1000) / 60000);
  try {
    const f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (Math.abs(mins) < 60) return f.format(-Math.max(0, mins), 'minute');
    if (Math.abs(mins) < 48 * 60) return f.format(-Math.round(mins / 60), 'hour');
    return f.format(-Math.round(mins / 1440), 'day');
  } catch { return `${mins} min`; }
}
