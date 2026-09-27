// i18n core: t(key) reads the active language, falls back en -> key.
// Language lives in a module singleton + React context so any component can
// re-render on switch. All user-facing copy MUST go through t().
import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { STRINGS, LANGS } from './strings/index.js';

let currentLang = 'en';
const listeners = new Set();

export function getLang() { return currentLang; }
export function setLang(l) {
  if (!LANGS.includes(l)) l = 'en';
  if (l === currentLang) return;
  currentLang = l;
  try { localStorage.setItem('saarthi:lang', l); } catch { /* private mode */ }
  for (const fn of listeners) fn(l);
}
try {
  const saved = localStorage.getItem('saarthi:lang');
  if (saved && LANGS.includes(saved)) currentLang = saved;
} catch { /* private mode */ }

/** Raw lookup: dict[lang][key] -> en fallback -> undefined. */
export function lookup(key, lang = currentLang) {
  const d = STRINGS[lang] || {};
  if (Object.prototype.hasOwnProperty.call(d, key)) return d[key];
  const en = STRINGS.en || {};
  if (Object.prototype.hasOwnProperty.call(en, key)) return en[key];
  return undefined;
}

/** t('someKey') -> translated string. Missing keys are caught by the
 *  i18n-keys test; at runtime the key itself is the last resort. */
export function t(key) {
  const v = lookup(key);
  return v === undefined ? key : v;
}

/** t with {named} interpolation: tp('updatedAgo', { t: '2 min' }). */
export function tp(key, params = {}) {
  let s = t(key);
  for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

const LangCtx = createContext({ lang: currentLang, setLang });

export function LangProvider({ children }) {
  const [lang, setL] = useState(currentLang);
  const set = useCallback((l) => { setLang(l); }, []);
  useEffect(() => {
    const fn = (l) => setL(l);
    listeners.add(fn);
    setL(currentLang);
    return () => { listeners.delete(fn); };
  }, []);
  const value = useMemo(
    () => ({ lang, setLang: set, tt: (k) => lookup(k, lang) ?? k }),
    [lang, set],
  );
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang() { return useContext(LangCtx); }
