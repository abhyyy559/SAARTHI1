// Offline evaluation helpers — dependency-free pure functions.
//
// Why a separate module: offline.js pulls in react and the i18n graph (which
// uses import.meta.glob), so it cannot be unit-tested in plain node. These
// helpers take every external input as an argument (timestamps, string
// templates, storage), so the test file can exercise them directly. offline.js
// re-exports thin wrappers bound to the real localStorage queue and the
// translator.
//
// Rules these enforce:
// - Staleness is always labelled ("checked X min ago"); never a fake all-clear.
// - Cached alert transitions are evaluated from schedule fields the backend
//   wrote; severity is carried along, never derived.
// - Fired transitions are recorded so a re-render never double-notifies.

/** Localised "checked X ago" label. `dict` carries the templates:
 *  { now, min: '{n} min ago', hour: '{n} h ago', day: '{n} d ago' } */
export function checkedAgo(atIso, nowMs = Date.now(), dict) {
  const d = dict || { now: 'Just now', min: '{n} min ago', hour: '{n} h ago', day: '{n} d ago' };
  let ageMin = null;
  try {
    if (atIso) {
      const t = new Date(atIso).getTime();
      if (Number.isFinite(t)) ageMin = Math.max(0, Math.floor((nowMs - t) / 60000));
    }
  } catch { /* unparseable -> null */ }
  if (ageMin == null) return d.now;
  if (ageMin < 1) return d.now;
  if (ageMin < 60) return String(d.min).replace('{n}', String(ageMin));
  const h = Math.floor(ageMin / 60);
  if (h < 24) return String(d.hour).replace('{n}', String(h));
  return String(d.day).replace('{n}', String(Math.floor(h / 24)));
}

export const transitionKey = (alertId, transition) => `${alertId}:${transition}`;

// Schedule fields the backend writes on every alert: pre_alert_at, starts_at,
// ends_at. A boundary "crossed" while the device was offline fires a local
// transition notice — evaluated from cached data, labelled as such.
const BOUNDARIES = [
  ['pre_alert_at', 'pre-alert'],
  ['starts_at', 'active'],
  ['ends_at', 'ended'],
];

function parseT(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** All transitions whose boundary has crossed by nowMs. Pure. */
export function evaluateCachedAlertTransitions(alerts, nowMs = Date.now()) {
  const out = [];
  for (const a of alerts || []) {
    const id = String(a && (a.id || a.alert_id) || '');
    if (!id) continue;
    const cachedAt = parseT(a.cached_at || a.at);
    for (const [field, transition] of BOUNDARIES) {
      const crossedAt = parseT(a[field]);
      if (crossedAt == null || crossedAt > nowMs) continue;
      // Only fire for boundaries that crossed while we held the cache — a
      // boundary that was already past when the data was saved was already
      // notified about when it was fresh.
      if (cachedAt != null && crossedAt <= cachedAt) continue;
      out.push({
        key: transitionKey(id, transition),
        alertId: id,
        transition,
        crossedAt,
        title: a.title || a.hazard || '',
        severity: String(a.severity || 'UNKNOWN').toUpperCase(),
      });
    }
  }
  // Deterministic order: oldest crossing first.
  out.sort((x, y) => x.crossedAt - y.crossedAt);
  return out;
}

/** Drop transitions already fired (recorded in the fired set). Pure. */
export function newTransitions(crossed, fired) {
  const seen = fired instanceof Set ? fired : new Set(fired || []);
  return (crossed || []).filter((c) => !seen.has(c.key));
}

// --- fired-transition persistence (injectable storage for tests) -----------
const FIRED_KEY = 'wgpt-offline-fired-v1';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

export function loadFired(storage) {
  const s = storage || (typeof localStorage !== 'undefined' ? localStorage : memStorage());
  try {
    const raw = s.getItem(FIRED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveFired(firedSet, storage) {
  const s = storage || (typeof localStorage !== 'undefined' ? localStorage : memStorage());
  try {
    s.setItem(FIRED_KEY, JSON.stringify([...firedSet]));
  } catch { /* storage unavailable — the in-memory set still guards this session */ }
}

/** Convenience: evaluate + filter + record, returning only the new ones. */
export function evaluateNewTransitions(alerts, nowMs = Date.now(), storage) {
  const fired = loadFired(storage);
  const fresh = newTransitions(evaluateCachedAlertTransitions(alerts, nowMs), fired);
  for (const f of fresh) fired.add(f.key);
  if (fresh.length) saveFired(fired, storage);
  return fresh;
}

// --- offline queue replay ---------------------------------------------------
// Queue entries are { text, lang, persona, district, ... }. sendFn receives
// one entry and must resolve on success / reject on failure. Failures stay in
// the queue, in order; successes are dropped. Never throws.
/** @returns {Promise<{sent: object[], kept: object[]}>} */
export async function drainQueue(entries, sendFn) {
  const sent = [];
  const kept = [];
  for (const e of entries || []) {
    try {
      await sendFn(e);
      sent.push(e);
    } catch {
      kept.push(e);
    }
  }
  return { sent, kept };
}
