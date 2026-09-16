// Offline resilience: snapshot last-good data, serve stale-labelled when cut off.
import { useEffect, useState } from 'react';

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

// Offline answer: cached guidance only; new warnings explicitly unverifiable (§26).
export function answerOffline(query, lang = 'en') {
  const q = (query || '').toLowerCase();
  if (/new warning|red alert|right now|last \d+ minutes|currently.*warning/.test(q)) {
    return 'I cannot verify new information because the device is offline. Last verified data is shown above.';
  }
  const g = (readCache().guidance || {}).data || {};
  for (const h of HAZARDS) {
    if (q.includes(h.slice(0, 5)) || q.includes({ flood: 'flood', thunderstorm: 'thunder', heatwave: 'heat', cyclone: 'cyclone' }[h])) {
      const hits = g[`${h}:${lang}`] || g[`${h}:en`] || [];
      if (hits.length) return `[CACHED guidance] ${hits[0].title}: ${hits[0].body}`;
    }
  }
  if (/flood|baarish|varada/.test(q)) {
    const hits = g['flood:en'] || [];
    if (hits.length) return `[CACHED guidance] ${hits[0].title}: ${hits[0].body}`;
  }
  return 'Offline: I can answer from cached emergency guidance (flood, thunderstorm, heatwave, cyclone) or show last verified data. I cannot check newly issued warnings while offline.';
}
