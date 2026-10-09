// Web Push: alerts that reach the phone while the app is closed. The backend
// watcher checks every subscribed district every few minutes and pushes when
// the official verdict changes; the service worker shows it on the lock screen.
import { api } from './api';

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// The worker registers only in production builds (never under `vite dev`).
async function registration() {
  try { return (await navigator.serviceWorker.getRegistration()) || null; } catch { return null; }
}

// 'unsupported' | 'no-sw' | 'denied' | 'off' | 'on'
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return 'no-sw';
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function pushOn({ district, language, persona }) {
  if (!pushSupported()) return 'unsupported';
  const reg = await registration();
  if (!reg) return 'no-sw';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { public_key: key } = await api.pushVapid();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  }
  const r = await api.pushSubscribe({ subscription: sub.toJSON(), district, language, persona });
  if (r.status === 'error') throw new Error(r.reason || 'subscribe failed');
  return 'on';
}

export async function pushOff() {
  const reg = await registration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}

// Keep the server's copy in step when the place, language or role changes.
export async function pushSync(prefs) {
  if ((await pushState()) === 'on') {
    try { await pushOn(prefs); } catch { /* next change retries */ }
  }
}

export async function pushTest() {
  const reg = await registration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return false;
  const r = await api.pushTest({ endpoint: sub.endpoint });
  return r.status !== 'error';
}
