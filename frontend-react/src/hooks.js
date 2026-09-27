// Shared hooks.
import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useApi(fetcher, deps): { data, error, loading, reload }.
 * fetcher must be a stable-ish async fn; deps re-trigger.
 */
export function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    setError(null);
    let cancelled = false;
    Promise.resolve()
      .then(() => fetcher())
      .then((d) => { if (!cancelled && alive.current) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled && alive.current) { setError(e); setLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => () => { alive.current = false; }, []);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, loading, reload };
}

/** useLocalStorage(key, initial): persistent state. */
export function useLocalStorage(key, initial) {
  const [val, setVal] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback((v) => {
    setVal((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, [key]);
  return [val, set];
}

/** useNow(intervalMs): re-renders on a timer — keeps "x min ago" fresh. */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** useOnKey: Escape closes sheets/dialogs. */
export function useEscape(onEscape) {
  useEffect(() => {
    if (!onEscape) return;
    const fn = (e) => { if (e.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onEscape]);
}
