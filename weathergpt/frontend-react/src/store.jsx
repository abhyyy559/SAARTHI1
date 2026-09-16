// Single application store. Views read from here instead of prop-drilling, and
// `ask()` is registered by ChatPanel from inside an EFFECT (never during render).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, HYD } from './api';
import { cacheGuidance, useOnline } from './offline';

const AppCtx = createContext(null);

// useApp is the read half of the store contract with AppProvider below; the rule is
// switched off for this file in .oxlintrc.json/overrides because co-location is intended.
export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

const readPref = (key, fallback) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};
const writePref = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};

export function AppProvider({ children }) {
  const [view, setView] = useState('situation');
  const [lang, setLang] = useState(() => readPref('wgpt.lang', 'en'));
  const [persona, setPersona] = useState('general');
  const [theme, setTheme] = useState(() => readPref('wgpt.theme', 'auto'));
  const [demoMode, setDemoMode] = useState(true);
  const [backendState, setBackendState] = useState('…');
  const [sources, setSources] = useState(null);
  const [pipe, setPipe] = useState({ lit: [], detail: {} });
  const [result, setResult] = useState(null);        // last chat turn → Evidence view
  const [disaster, setDisaster] = useState(false);
  const [simOffline, setSimOffline] = useState(false);
  const online = useOnline();
  const askRef = useRef(null);

  // ChatPanel publishes its submit handler here from an effect — safe, no render-time ref write.
  const registerAsk = useCallback((fn) => { askRef.current = fn; }, []);
  const ask = useCallback((text) => { if (askRef.current) askRef.current(text); }, []);

  useEffect(() => {
    writePref('wgpt.theme', theme);
    const el = document.documentElement;
    if (theme === 'auto') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    writePref('wgpt.lang', lang);
    cacheGuidance(api, lang);
  }, [lang]);

  useEffect(() => {
    let dead = false;
    api.sources().then((s) => { if (!dead) setSources(s); }).catch(() => {});
    api.health().then((h) => { if (!dead) setDemoMode(!!h.demo_mode); }).catch(() => {});
    api.status()
      .then((s) => { if (!dead) setBackendState(s.state); })
      .catch(() => { if (!dead) setBackendState('?'); });
    // Disaster mode: verified ORANGE/RED collapses the console to safety-first.
    api.warnings(HYD.district, HYD.lat, HYD.lon)
      .then((w) => {
        const v = w && w.verified;
        if (!dead && v && v.verified && (v.severity === 'ORANGE' || v.severity === 'RED')) setDisaster(true);
      })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  // A grounded answer arrives: record it and light the real path it travelled.
  const handleResult = useCallback((r) => {
    setResult(r);
    const ev = r.evidence || [];
    setPipe({
      lit: ['SOURCES', 'VALIDATE', 'RISK', 'ANSWER'],
      detail: {
        SOURCES: ev.map((e) => `${e.source}/${e.provenance}`).join(' | ') || '-',
        VALIDATE: r.warning && r.warning.valid_until ? `valid to ${r.warning.valid_until}` : 'no active warning',
        RISK: `${(r.risk && r.risk.level) || '?'} (${(r.risk && r.risk.source) || 'WEATHERGPT'})`,
        ANSWER: `${(r.answer || '').length} chars, grounded`,
      },
    });
  }, []);

  const offline = simOffline || !online;
  const conn = offline ? 'OFFLINE' : backendState;

  const value = useMemo(() => ({
    view, setView,
    lang, setLang,
    persona, setPersona,
    theme, setTheme,
    demoMode, backendState, sources, setSources,
    conn, offline, online, simOffline, setSimOffline,
    pipe, setPipe, result, handleResult,
    disaster, setDisaster,
    ask, registerAsk,
    loc: HYD,
  }), [view, lang, persona, theme, demoMode, backendState, sources, conn, offline, online,
    simOffline, pipe, result, handleResult, disaster, ask, registerAsk]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}