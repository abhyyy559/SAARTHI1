// QR P2P alert relay — framing protocol.
//
// Pure, dependency-free module: chunk an alert envelope into numbered QR
// frames on the sender, reassemble + validate on the receiver. No network, no
// DOM, no React — so plain node tests can exercise every path.
//
// Frame wire format (JSON string, one QR code per frame):
//   { kind:'saarthi-p2p-frame', v:1, rid, i, n, h, d }
//   rid = relay id (uuid-ish), i = frame index (0-based), n = total frames,
//   h   = FNV-1a hex of the FULL envelope JSON (integrity of the whole
//         payload, not just one frame), d = envelope-JSON slice.
//
// Envelope (what the frames reassemble into):
//   { kind:'saarthi-p2p-alert', v:1, relay_id, sent_at, hops, hop_limit,
//     official, source, path:[...], alert:{...sanitized alert...} }
//
// Honesty rules:
// - `official` is carried ONLY from an explicit `official: true` flag in the
//   sender's data and is NEVER derived here (fail closed: ambiguous -> community).
// - hop count travels in the payload; canRelay()/nextHop() enforce the limit.
// - Oversized alerts are sanitized to essential fields (never silently
//   dropped, never truncated mid-field).

export const P2P_QR_FRAME_KIND = 'saarthi-p2p-frame';
export const P2P_QR_ENVELOPE_KIND = 'saarthi-p2p-alert';
export const P2P_QR_VERSION = 1;

// QR payload budget per frame. Byte-mode QR at error-correction M holds ~800
// chars at a version phone cameras scan comfortably; 700 leaves margin.
export const FRAME_CHARS = 700;
// Envelope ceiling: 12KB -> at most 18 frames. Bigger than this means the
// sender packed something wrong; sanitizeAlert() keeps real alerts far below.
export const MAX_ENVELOPE_CHARS = 12000;

// Hop policy: normal alerts travel at most 5 hops, critical (RED/severe)
// alerts at most 10. A phone at the limit must refuse to relay further.
export const HOP_LIMIT_NORMAL = 5;
export const HOP_LIMIT_CRITICAL = 10;

const CRITICAL_SEV = new Set(['RED', 'SEVERE', 'EXTREME', 'CRITICAL']);

export function hopLimitFor(alert) {
  const sev = String((alert && (alert.severity || alert.level)) || '').toUpperCase();
  return CRITICAL_SEV.has(sev) ? HOP_LIMIT_CRITICAL : HOP_LIMIT_NORMAL;
}

// FNV-1a 32-bit, hex. Small, dependency-free, good enough as a
// corruption check for a camera channel (not a security boundary).
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function rid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

// Keep the relay payload small and honest: essential fields only, in a fixed
// order. Unknown extra fields are dropped (they would only bloat the QR).
const ALERT_FIELDS = [
  'id', 'alert_id', 'title', 'hazard', 'severity', 'level',
  'description', 'instruction', 'area', 'district',
  'starts_at', 'ends_at', 'issued_at', 'source', 'official',
  'event', 'headline', 'urgency', 'certainty',
];

export function sanitizeAlert(alert) {
  if (!alert || typeof alert !== 'object') return null;
  const out = {};
  for (const f of ALERT_FIELDS) {
    const v = alert[f];
    if (v === undefined || v === null) continue;
    out[f] = typeof v === 'string' ? v.slice(0, 1200) : v;
  }
  // Stable id: prefer explicit ids, else derive one from content hash so a
  // re-scan of the same alert dedupes instead of duplicating.
  if (!out.id && !out.alert_id) {
    out.id = `p2p-${hashString(JSON.stringify(out)).slice(0, 12)}`;
  }
  return out;
}

export function isOfficialAlert(alert) {
  // Fail closed: ONLY an explicit `official: true` flag on the sender's own
  // data counts. Source-name sniffing ("CAP" substring etc.) is a
  // false-positive factory — "CAP volunteer team" must never badge Official.
  // Missing/ambiguous -> community.
  if (!alert || typeof alert !== 'object') return false;
  return alert.official === true;
}

// Build the envelope for one alert. `hops` lets a phone that RECEIVED the
// alert via P2P re-relay it with its hop count preserved (the receiver path
// uses nextHop() instead).
export function buildEnvelope(alert, { hops = 0, deviceLabel = '' } = {}) {
  const clean = sanitizeAlert(alert);
  if (!clean) return { ok: false, error: 'empty-alert' };
  const envelope = {
    kind: P2P_QR_ENVELOPE_KIND,
    v: P2P_QR_VERSION,
    relay_id: rid(),
    sent_at: new Date().toISOString(),
    hops,
    hop_limit: hopLimitFor(alert),
    official: isOfficialAlert(alert),
    source: String(alert.source || 'community').slice(0, 80),
    path: deviceLabel ? [String(deviceLabel).slice(0, 40)] : [],
    alert: clean,
  };
  const json = JSON.stringify(envelope);
  if (json.length > MAX_ENVELOPE_CHARS) {
    return { ok: false, error: 'too-large', size: json.length };
  }
  return { ok: true, envelope };
}

// Split the envelope into numbered frames. Each frame is a JSON string ready
// to be rendered as one QR code.
export function chunkEnvelope(envelope, frameChars = FRAME_CHARS) {
  const json = JSON.stringify(envelope);
  const h = hashString(json);
  const n = Math.max(1, Math.ceil(json.length / frameChars));
  const frames = [];
  for (let i = 0; i < n; i++) {
    frames.push(JSON.stringify({
      kind: P2P_QR_FRAME_KIND,
      v: P2P_QR_VERSION,
      rid: envelope.relay_id,
      i,
      n,
      h,
      d: json.slice(i * frameChars, (i + 1) * frameChars),
    }));
  }
  return frames;
}

// Parse one scanned QR payload. Returns { ok, frame } or { ok:false, reason }.
// Non-frame QR codes (a random QR on a wall) are rejected, not crashed on.
export function parseFrame(text) {
  if (typeof text !== 'string' || !text) return { ok: false, reason: 'empty' };
  let o;
  try {
    o = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!o || o.kind !== P2P_QR_FRAME_KIND || o.v !== P2P_QR_VERSION) {
    return { ok: false, reason: 'not-a-p2p-frame' };
  }
  if (typeof o.rid !== 'string' || !Number.isInteger(o.i) || !Number.isInteger(o.n) ||
      typeof o.h !== 'string' || typeof o.d !== 'string') {
    return { ok: false, reason: 'malformed-frame' };
  }
  if (o.i < 0 || o.i >= o.n || o.n > 64) return { ok: false, reason: 'bad-index' };
  return { ok: true, frame: o };
}

// Reassemble collected frames (any order, duplicates fine).
// Returns:
//   { complete:false, rid, total, received, missing:[idx...] }  — keep scanning
//   { complete:true, ok:true, envelope }                        — validated
//   { complete:true, ok:false, error:'checksum'|'bad-envelope' } — reject it
export function reassembleFrames(frameTexts) {
  const seen = new Map(); // i -> frame
  let meta = null;
  for (const t of frameTexts) {
    const p = parseFrame(t);
    if (!p.ok) continue;
    const f = p.frame;
    if (!meta) {
      meta = { rid: f.rid, n: f.n, h: f.h };
    } else if (f.rid !== meta.rid || f.n !== meta.n || f.h !== meta.h) {
      // A different relay's frame wandered in (two phones showing QR codes
      // side by side). Ignore it — never mix relays.
      continue;
    }
    if (!seen.has(f.i)) seen.set(f.i, f);
  }
  if (!meta) return { complete: false, rid: null, total: 0, received: 0, missing: [] };
  const missing = [];
  for (let i = 0; i < meta.n; i++) if (!seen.has(i)) missing.push(i);
  if (missing.length) {
    return { complete: false, rid: meta.rid, total: meta.n, received: seen.size, missing };
  }
  const joined = [...seen.values()].sort((a, b) => a.i - b.i).map((f) => f.d).join('');
  if (hashString(joined) !== meta.h) {
    return { complete: true, ok: false, error: 'checksum' };
  }
  let envelope;
  try {
    envelope = JSON.parse(joined);
  } catch {
    return { complete: true, ok: false, error: 'bad-envelope' };
  }
  if (!envelope || envelope.kind !== P2P_QR_ENVELOPE_KIND) {
    return { complete: true, ok: false, error: 'bad-envelope' };
  }
  return { complete: true, ok: true, envelope };
}

// Hop policy ---------------------------------------------------------------
export function canRelay(envelope) {
  if (!envelope || typeof envelope.hops !== 'number' || typeof envelope.hop_limit !== 'number') return false;
  return envelope.hops < envelope.hop_limit;
}

// The receiver becomes the next sender: bump hops, extend the path, mint a
// fresh relay_id (so the next hop's frames never mix with this hop's).
// Returns null when the hop limit is reached — the caller must refuse.
export function nextHop(envelope, deviceLabel = '') {
  if (!canRelay(envelope)) return null;
  const path = Array.isArray(envelope.path) ? envelope.path.slice(0, 10) : [];
  if (deviceLabel) path.push(String(deviceLabel).slice(0, 40));
  return {
    ...envelope,
    relay_id: rid(),
    sent_at: new Date().toISOString(),
    hops: envelope.hops + 1,
    path,
  };
}

// Ack outbox: acknowledgements queued while offline, synced when online.
// Dedicated localStorage list (separate from the chat-question queue —
// different shape, different endpoint).
const ACK_KEY = 'wgpt-p2p-acks-v1';
const ACK_MAX = 50;

function readLS(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeLS(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}

export function queueP2PAck({ alert_id, relay_id, hops, device }) {
  const q = readLS(ACK_KEY);
  // Dedup: one pending ack per relay.
  if (!q.some((e) => e.relay_id === relay_id)) {
    q.push({
      alert_id: String(alert_id || ''),
      relay_id: String(relay_id || ''),
      hops: Number(hops) || 0,
      device: String(device || 'phone').slice(0, 40),
      queued_at: new Date().toISOString(),
    });
  }
  while (q.length > ACK_MAX) q.shift();
  writeLS(ACK_KEY, q);
  return q.length;
}

export function readP2PAcks() {
  return readLS(ACK_KEY);
}

export function dropP2PAck(relay_id) {
  writeLS(ACK_KEY, readLS(ACK_KEY).filter((e) => e.relay_id !== relay_id));
}

// POST queued acks to /api/notifications/ack. `api` is the app's backend
// client ({ notificationsAck }). Returns { sent, kept }.
export async function syncP2PAcks(api, device) {
  const q = readLS(ACK_KEY);
  const kept = [];
  let sent = 0;
  for (const e of q) {
    try {
      await api.notificationsAck({ alert_id: e.alert_id, device: device || e.device });
      sent += 1;
    } catch {
      kept.push(e);
    }
  }
  writeLS(ACK_KEY, kept);
  return { sent, kept };
}
