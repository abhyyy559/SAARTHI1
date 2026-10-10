// Where the backend lives (read by apiBase() in api.js).
//
// The website is served by (or proxied to) its own backend, so it calls
// same-origin /api. The Android app is the same web build packaged inside the
// APK: its pages come from https://localhost, which has no backend, so the
// app needs a real server address. Order: the address saved in Settings, then
// the build-time VITE_API_URL (legacy alias VITE_API_BASE), then same origin.
const KEY = 'wgpt.server';

export const isNativeApp = () => {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch { return false; }
};

export function savedServer() {
  try { return (localStorage.getItem(KEY) || '').trim(); } catch { return ''; }
}

/** Normalise what a person typed: add http:// when missing, drop a trailing slash. */
export function cleanServer(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `http://${s}`;
}

export function setServer(raw) {
  const s = cleanServer(raw);
  try {
    if (s) localStorage.setItem(KEY, s); else localStorage.removeItem(KEY);
  } catch { /* private mode: lasts this session only */ }
  return s;
}
