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

// Cache keys shared by Today, Alerts, Ask (offline answer) and Share. The
// state is part of the key: Aurangabad (Bihar) and Aurangabad (Maharashtra)
// must never show each other's saved data.
const at = (loc) => (loc.state ? `${loc.district}|${loc.state}` : loc.district);
export const keys = {
  warnings: (loc) => `warn:${at(loc)}`,
  current: (loc) => `now:${at(loc)}`,
  forecast: (loc) => `fc:${at(loc)}`,
  advisory: (loc, persona, lang) => `adv:${at(loc)}:${persona}:${lang}`,
  cards: (loc, persona, lang) => `cards:${at(loc)}:${persona}:${lang}`,
  stats: 'stats',
  models: (loc) => `models:${at(loc)}`,
  climate: (loc) => `climate:${at(loc)}`,
  nowcast: (loc) => `nowcast:${at(loc)}`,
  marine: (loc) => `marine:${at(loc)}`,
  chat: 'chat:history',
  queue: 'chat:queue',
};
