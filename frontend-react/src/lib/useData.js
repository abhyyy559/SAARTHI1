import { useCallback, useEffect, useRef, useState } from 'react';
import { cache, fetchWithCache } from './cache';

// Back-off for a screen that has nothing saved yet (cold start, weak signal).
const RETRY_MS = [4000, 10000, 25000];

// Online/offline as the browser sees it.
export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

// Saved copy paints instantly; the live fetch replaces it when it lands.
// Refetches on reconnect and every `refreshMs` while the screen is open.
export function useData(key, fetcher, { refreshMs = 10 * 60 * 1000, enabled = true } = {}) {
  const online = useOnline();
  const [state, setState] = useState(() => {
    const hit = key ? cache.read(key) : null;
    return hit
      ? { data: hit.data, savedAt: hit.savedAt, source: 'saved', loading: true, error: null }
      : { data: null, savedAt: null, source: 'none', loading: !!key, error: null };
  });
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; });
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!key || !enabled) return;
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    const r = await fetchWithCache(key, () => fetcherRef.current());
    if (mine === seq.current) setState({ ...r, loading: false });
  }, [key, enabled]);

  // New key (district / language / role changed): show its saved copy first,
  // derived during render so no extra pass is needed.
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    const hit = key ? cache.read(key) : null;
    setState(hit
      ? { data: hit.data, savedAt: hit.savedAt, source: 'saved', loading: true, error: null }
      : { data: null, savedAt: null, source: 'none', loading: !!key, error: null });
  }
  useEffect(() => { load(); }, [load]);

  // Nothing saved and the first fetch failed (cold server start, weak signal):
  // keep trying a few times instead of leaving an empty card.
  const retries = useRef(0);
  useEffect(() => { retries.current = 0; }, [key]);
  useEffect(() => {
    if (state.loading || state.source !== 'none' || !state.error || !online) return undefined;
    if (retries.current >= RETRY_MS.length) return undefined;
    const id = setTimeout(() => { retries.current += 1; load(); }, RETRY_MS[retries.current]);
    return () => clearTimeout(id);
  }, [state.loading, state.source, state.error, online, load]);

  // Back online: refresh whatever is showing from the saved copy.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) load();
    wasOnline.current = online;
  }, [online, load]);

  useEffect(() => {
    if (!refreshMs) return undefined;
    const id = setInterval(() => { if (navigator.onLine) load(); }, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, load]);

  return { ...state, reload: load };
}
