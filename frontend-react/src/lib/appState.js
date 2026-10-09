import { createContext, useContext } from 'react';

export const AppCtx = createContext(null);

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used inside <App>');
  return ctx;
}

const PREF = 'wgpt2.pref.';
export function readPref(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREF + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
export function writePref(key, value) {
  try { localStorage.setItem(PREF + key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

// Cache keys shared by Today, Alerts, Ask (offline answer) and Share.
export const keys = {
  warnings: (loc) => `warn:${loc.district}`,
  current: (loc) => `now:${loc.district}`,
  forecast: (loc) => `fc:${loc.district}`,
  advisory: (loc, persona, lang) => `adv:${loc.district}:${persona}:${lang}`,
  cards: (loc, persona, lang) => `cards:${loc.district}:${persona}:${lang}`,
  stats: 'stats',
  models: (loc) => `models:${loc.district}`,
  climate: (loc) => `climate:${loc.district}`,
  nowcast: (loc) => `nowcast:${loc.district}`,
  marine: (loc) => `marine:${loc.district}`,
  chat: 'chat:history',
  queue: 'chat:queue',
};
