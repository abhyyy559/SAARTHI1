// Offline resilience: snapshot last-good data, serve stale-labelled when cut off.
import { useEffect, useState } from 'react';
import { t } from './i18n';

const KEY = 'wgpt-cache-v1';

export function saveCache(name, data) {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || '{}');
    c[name] = { at: new Date().toISOString(), data };
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch { /* storage unavailable — ignore */ }
}

export function readCache() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

// Notifications cache: saved on every successful list fetch, served with a
// Notifications cache: saved on every successful list fetch, served with a
// plain "Saved on this phone" label when the server is unreachable (B3).
export function saveNotificationSnapshot(items) {
  saveCache('notifications', { items: items || [], at: new Date().toISOString() });
}
export function readNotificationSnapshot() {
  return (readCache().notifications || {}).data || null;
}

// Last verified warning snapshot: saved on every successful fetch, served
// stale-labelled when the backend is unreachable. A warning with a future
// valid_until stays meaningful offline; expiry is checked at render time.
export function saveWarningSnapshot(warning, verified, district) {
  if (warning) saveCache('warning', { warning, verified: verified || null, district, at: new Date().toISOString() });
}

export function readWarningSnapshot() {
  return (readCache().warning || {}).data || null;
}

// Last verified observation snapshot (bucket 3 mirror for the structured
// fallback card): { obs, at }. Age-checked at render (30-min TTL).
export function saveObservationSnapshot(obs) {
  if (obs) saveCache('observation', { obs, at: new Date().toISOString() });
}

export function readObservationSnapshot() {
  return (readCache().observation || {}).data || null;
}

// Round2 S3.1.2: cached ALERT viewing (demo/official alert snapshot).
// Saved on every successful alerts fetch; rendered offline with a CACHED chip.
// Stale (>60min) dims the card, expired (>6h, mirrors backend ALERT_TTL) greys
// it out — never rendered as live, never invented when absent.
export const ALERT_STALE_MIN = 60;
export const ALERT_EXPIRE_MIN = 360; // 6h — mirrors backend ALERT_TTL

export function saveAlertSnapshot(alert, district) {
  if (alert) saveCache('alert', { alert, district, at: new Date().toISOString() });
}

export function readAlertSnapshot() {
  return (readCache().alert || {}).data || null;
}

export function alertAgeMin(snap, nowMs = Date.now()) {
  try {
    if (!snap || !snap.at) return null;
    return Math.max(0, Math.floor((nowMs - new Date(snap.at).getTime()) / 60000));
  } catch {
    return null;
  }
}

// { ageMin, stale, expired, chip: 'CACHED'|'STALE'|'EXPIRED'|'FRESH', greyOut }
export function alertCacheStatus(snap, nowMs = Date.now()) {
  const ageMin = alertAgeMin(snap, nowMs);
  if (ageMin == null) return { ageMin: null, stale: false, expired: false, chip: 'CACHED', greyOut: false };
  const expired = ageMin > ALERT_EXPIRE_MIN;
  const stale = !expired && ageMin > ALERT_STALE_MIN;
  return {
    ageMin,
    stale,
    expired,
    chip: expired ? 'EXPIRED' : stale ? 'STALE' : 'CACHED',
    greyOut: expired, // expired greys out fully; stale only dims (caller adds .is-stale)
  };
}

// Advisory snapshot: last-known advisory cards with a checked stamp. Saved by
// the Advisory view on every successful fetch; the Offline & P2P panel renders
// them stale-labelled when the backend is unreachable. Never invented.
export function saveAdvisorySnapshot(cards, district) {
  if (cards) saveCache('advisory', { cards, district, at: new Date().toISOString() });
}

export function readAdvisorySnapshot() {
  return (readCache().advisory || {}).data || null;
}

// Demo alerts snapshot: the demo alert LIST for the P2P relay picker. The
// verdict/warning cache does not carry demo alerts, so the Offline & P2P panel
// fetches them itself whenever online in demo mode and snapshots them here.
// Rendered with a DEMO stamp — never as official. { alerts, district, at }.
export function saveDemoAlertsSnapshot(alerts, district) {
  saveCache('demo_alerts', { alerts: Array.isArray(alerts) ? alerts : [], district, at: new Date().toISOString() });
}

export function readDemoAlertsSnapshot() {
  const d = (readCache().demo_alerts || {}).data || null;
  return d && Array.isArray(d.alerts) ? d : null;
}

// App-shell readiness probe (Worker 5): asks the service worker whether it is
// actively CONTROLLING this page. A worker that is merely registered — or an
// app opened for the first time — cannot serve the shell offline, and the
// Offline & P2P panel reports that honestly ("not saved yet") instead of a
// green dot that lies. Resolves { ready: true } or { ready: false, reason }.
export function probeOfflineShell(timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
        resolve({ ready: false, reason: 'no-controller' });
        return;
      }
      const timer = setTimeout(() => {
        navigator.serviceWorker.removeEventListener('message', onMsg);
        resolve({ ready: false, reason: 'timeout' });
      }, timeoutMs);
      const onMsg = (e) => {
        if (e.data && e.data.type === 'OFFLINE_PROBE_RESULT') {
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener('message', onMsg);
          resolve(e.data.controlling ? { ready: true } : { ready: false, reason: 'not-controlling' });
        }
      };
      navigator.serviceWorker.addEventListener('message', onMsg);
      navigator.serviceWorker.controller.postMessage({ type: 'OFFLINE_PROBE' });
    } catch {
      resolve({ ready: false, reason: 'error' });
    }
  });
}

// Offline query queue: localStorage, HARD CAP 20 entries, oldest evicted.
// Each entry is a small JSON blob (<2KB) — quota-safe by three orders.
// (IndexedDB migration only if spare time allows; the cap is the safety.)
const QKEY = 'wgpt-queue-v1';
const QMAX = 20;

export function queueQuery(entry) {
  try {
    const q = JSON.parse(localStorage.getItem(QKEY) || '[]');
    q.push({ ...entry, id: Date.now() + Math.floor(Math.random() * 1000), at: new Date().toISOString() });
    while (q.length > QMAX) q.shift();
    localStorage.setItem(QKEY, JSON.stringify(q));
    return q.length;
  } catch {
    return 0;
  }
}

export function readQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(QKEY) || '[]');
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

export function clearQueue() {
  try { localStorage.removeItem(QKEY); } catch { /* ignore */ }
}

export function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

const HAZARDS = ['flood', 'thunderstorm', 'heatwave', 'cyclone'];

// Pre-fetch emergency guidance while online so offline Q&A can answer from cache.
export async function cacheGuidance(api, lang = 'en') {
  try {
    const all = {};
    for (const h of HAZARDS) {
      const d = await api.guidance(h, lang);
      all[`${h}:${lang}`] = d.hits || [];
    }
    saveCache('guidance', all);
  } catch { /* ignore */ }
}

// Offline answer: cached guidance only, in the user's language; new warnings
// explicitly unverifiable (§26). Every path carries the mandatory
// "cannot check now" wording — an offline answer must never read as an
// all-clear.
export function answerOffline(query, lang = 'en') {
  const q = (query || '').toLowerCase();
  if (/new warning|red alert|right now|last \d+ minutes|currently.*warning/.test(q)) {
    return t(lang, 'offlineNewWarning');
  }
  const g = (readCache().guidance || {}).data || {};
  const tag = t(lang, 'offlineCachedTag');
  for (const h of HAZARDS) {
    if (q.includes(h.slice(0, 5)) || q.includes({ flood: 'flood', thunderstorm: 'thunder', heatwave: 'heat', cyclone: 'cyclone' }[h])) {
      const hits = g[`${h}:${lang}`] || g[`${h}:en`] || [];
      if (hits.length) return `[${tag}] ${hits[0].title}: ${hits[0].body}`;
    }
  }
  if (/flood|baarish|varada/.test(q)) {
    const hits = g['flood:en'] || [];
    if (hits.length) return `[${tag}] ${hits[0].title}: ${hits[0].body}`;
  }
  return t(lang, 'offlineNoAnswer');
}
