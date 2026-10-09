// Phone-to-phone relay store: what this phone received by scanning another
// phone's code. Kept on the phone (works offline), newest first, at most 10.
import { cache } from './cache.js';
import { MAX_HOPS, decodeSnapshot, payloadFromHash, readSnapshot } from './share.js';

const KEY = 'relay:list';

export function listReceived() {
  return cache.read(KEY)?.data || [];
}

function save(item) {
  const next = [item, ...listReceived().filter((x) => x.id !== item.id)].slice(0, 10);
  cache.save(KEY, next);
  return next;
}

// Turn scanned text into a received item. A WeatherGPT link carries a full
// snapshot (one more hop than it had); anything else is kept as plain text
// only when it is our own text QR.
export async function receiveScanned(text, now = Date.now()) {
  const raw = String(text || '').trim();
  const hashAt = raw.indexOf('#s=');
  if (hashAt >= 0) {
    const payload = payloadFromHash(raw.slice(hashAt));
    if (!payload) throw new Error('bad code');
    const snap = readSnapshot(await decodeSnapshot(payload));
    const hops = Math.min(MAX_HOPS, (snap.hops || 0) + 1);
    const id = `s:${snap.loc.district}:${snap.savedAt}`;
    return { list: save({ id, kind: 'snap', receivedAt: now, snap: { ...snap, hops } }), id };
  }
  if (raw.startsWith('WeatherGPT ·')) {
    const id = `t:${raw.slice(0, 80)}`;
    return { list: save({ id, kind: 'text', receivedAt: now, text: raw }), id };
  }
  throw new Error('not ours');
}

export function canPassOn(item) {
  return item.kind === 'snap' && (item.snap.hops || 0) < MAX_HOPS;
}
