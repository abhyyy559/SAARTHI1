// Real operating-system notifications, driven by the app's own verdict.
//
// Two paths, both real:
// - In-app: notify() below fires while the app is open (a background tab is
//   fine). The constructor fallback covers browsers with no SW registered.
// - Closed-app: genuine Web Push. subscribeToPush() registers the service
//   worker, creates a VAPID subscription and POSTs it to /api/push/subscribe;
//   the server then pushes to the device even with the app and tab closed.
//   The SW's push handler renders it and its notificationclick handler opens
//   the deep link (payload.url).
//
// Honesty is load-bearing here: the UI reports pushMode off/background/inapp
// with the concrete reason, never a silent fallback.

const SEEN_KEY = 'wgpt-notified-v1';

// ---------------------------------------------------------------------------
// Background push
//
// The point of the whole feature: a user who never opens the app still gets
// told. That needs a real push subscription, which needs the service worker
// (already registered) and the server's VAPID public key.
// ---------------------------------------------------------------------------

/** Can this browser receive background push at all? */
export function pushSupported() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window;
}

/**
 * Machine-readable reasons subscribeToPush() can report. The UI maps each to
 * user-visible text — the reason is part of the honest enable state, never
 * swallowed into a generic toast.
 */
export const PUSH_REASONS = {
  UNSUPPORTED: 'unsupported', // browser has no push capability at all
  SERVER_DOWN: 'server-unavailable', // /api/push/vapid unreachable, or push unavailable server-side
  DENIED: 'denied', // the user denied the permission prompt
  SW_MISSING: 'sw-unavailable', // no service worker could be provided
  REJECTED: 'server-rejected', // the server refused the subscription
  FAILED: 'failed', // anything else (network, unexpected)
  NONE: 'none', // unsubscribe: there was nothing subscribed
  UNSUBSCRIBED: 'unsubscribed', // unsubscribe: done
};

// Machine reason from subscribeToPush() -> user-visible i18n key. The reason
// is part of the honest enable state: "background unavailable" without a why
// is a shrug, not an explanation. Single copy — the store, SettingsPanel and
// NotificationsPanel all render through this (it used to be triplicated).
const PUSH_REASON_KEYS = {
  'unsupported': 'rsnUnsupported',
  'server-unavailable': 'rsnServer',
  'denied': 'rsnDenied',
  'sw-unavailable': 'rsnSw',
  'server-rejected': 'rsnRejected',
  'failed': 'rsnFailed',
};
export const pushReasonKey = (r) => PUSH_REASON_KEYS[r] || 'rsnFailed';

// navigator.serviceWorker.ready NEVER settles when no worker is registered —
// main.jsx only registers /sw.js in production builds, and even there the
// registration waits for window load. Awaiting it bare is how the "Allow
// notifications" button came to do nothing at all: the tap hung forever with
// no toast and no state change. Every service-worker wait below is bounded.
const SW_READY_TIMEOUT_MS = 8000;

// Browser push-API calls below the service-worker wait (getSubscription,
// subscribe, unsubscribe) and the Notification permission prompt have no
// built-in bound: when the browser never settles them, the enable flow hangs
// forever and the onboarding buttons stay disabled (ntfBusy/ctaBusy stuck
// true). PUSH_OP_TIMEOUT_MS / NOTIFY_PERM_TIMEOUT_MS bound those waits so
// every path settles and the UI always frees the button.
const PUSH_OP_TIMEOUT_MS = 10000;
// Generous on purpose: the native permission prompt needs human time. It only
// fires when the browser never settles the prompt at all.
const NOTIFY_PERM_TIMEOUT_MS = 30000;

function timeoutError(ms) {
  const err = new Error(`service worker not ready after ${ms}ms`);
  err.name = 'SWTimeoutError';
  return err;
}

function opTimeoutError(ms) {
  const err = new Error(`push operation timed out after ${ms}ms`);
  err.name = 'PushOpTimeoutError';
  return err;
}

function withTimeout(promise, ms) {
  let id = 0;
  const gate = new Promise((_, reject) => {
    id = setTimeout(() => reject(timeoutError(ms)), ms);
  });
  return Promise.race([promise, gate]).finally(() => clearTimeout(id));
}

function withOpTimeout(promise, ms) {
  let id = 0;
  const gate = new Promise((_, reject) => {
    id = setTimeout(() => reject(opTimeoutError(ms)), ms);
  });
  return Promise.race([promise, gate]).finally(() => clearTimeout(id));
}

/**
 * The registration able to receive push, or null when the browser cannot
 * provide one. Prefers the existing registration; registers /sw.js on demand
 * when a fast tap beats main.jsx's window-load registration; gives up
 * honestly (dev server serves no worker, insecure context, registration
 * failure) instead of hanging the enable flow forever.
 */
async function pushRegistration() {
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
  } catch { /* fall through to on-demand registration */ }
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Register this device for background push.
 *
 * Returns { ok, reason, endpoint }. Every failure is reported rather than
 * swallowed: "notifications are on" must never be shown when the device cannot
 * actually be reached while the app is closed. Never hangs: every
 * service-worker wait is bounded (see SW_READY_TIMEOUT_MS), and the
 * pushManager calls below are bounded too (see PUSH_OP_TIMEOUT_MS) —
 * otherwise a browser that never settles them sticks the onboarding Allow
 * button disabled forever (ntfBusy/ctaBusy never reset).
 *
 * opts.readyTimeoutMs overrides the bound (tests, very slow devices).
 * opts.opTimeoutMs overrides the bound on the pushManager calls below.
 */
export async function subscribeToPush({ api, district, language, persona }, opts = {}) {
  if (!pushSupported()) return { ok: false, reason: PUSH_REASONS.UNSUPPORTED };
  const readyMs = Number(opts.readyTimeoutMs) > 0 ? Number(opts.readyTimeoutMs) : SW_READY_TIMEOUT_MS;
  const opMs = Number(opts.opTimeoutMs) > 0 ? Number(opts.opTimeoutMs) : PUSH_OP_TIMEOUT_MS;

  try {
    const { public_key: publicKey, available } = await api.pushVapid();
    if (!available || !publicKey) return { ok: false, reason: PUSH_REASONS.SERVER_DOWN };

    const reg = await withTimeout(pushRegistration(), readyMs);
    if (!reg || !reg.pushManager) return { ok: false, reason: PUSH_REASONS.SW_MISSING };

    // Both pushManager calls are browser-API waits with no built-in timeout;
    // unbounded they hang the enable flow (and the onboarding Allow button)
    // forever when the browser never settles them.
    let sub = await withOpTimeout(reg.pushManager.getSubscription(), opMs);
    if (!sub) {
      sub = await withOpTimeout(reg.pushManager.subscribe({
        // Required by Chrome: every push must be shown to the user.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }), opMs);
    }

    const r = await api.pushSubscribe({
      subscription: sub.toJSON(),
      district, language, persona,
    });
    if (r && r.status === 'subscribed') return { ok: true, endpoint: sub.endpoint };
    return { ok: false, reason: (r && r.reason) || PUSH_REASONS.REJECTED };
  } catch (err) {
    // A denied permission lands here as NotAllowedError; so does a network
    // failure. Either way the caller shows the honest reason, not a false "on".
    if (err?.name === 'NotAllowedError') return { ok: false, reason: PUSH_REASONS.DENIED };
    if (err?.name === 'SWTimeoutError') return { ok: false, reason: PUSH_REASONS.SW_MISSING };
    if (err?.name === 'PushOpTimeoutError') return { ok: false, reason: PUSH_REASONS.FAILED };
    return { ok: false, reason: PUSH_REASONS.FAILED };
  }
}

/** Stop background push for this device, on both sides. Never hangs: the
 *  pushManager waits are bounded like the subscribe path, so the toggle-off
 *  half of the onboarding Allow button cannot stick busy either. */
export async function unsubscribeFromPush(api, opts = {}) {
  if (!pushSupported()) return { ok: false, reason: PUSH_REASONS.UNSUPPORTED };
  const opMs = Number(opts?.opTimeoutMs) > 0 ? Number(opts.opTimeoutMs) : PUSH_OP_TIMEOUT_MS;
  try {
    const reg = await withTimeout(pushRegistration(), SW_READY_TIMEOUT_MS);
    const sub = reg && reg.pushManager ? await withOpTimeout(reg.pushManager.getSubscription(), opMs) : null;
    if (!sub) return { ok: true, reason: PUSH_REASONS.NONE };
    const endpoint = sub.endpoint;
    await withOpTimeout(sub.unsubscribe().catch(() => { /* server cleanup still worth trying */ }), opMs);
    await api.pushUnsubscribe(endpoint).catch(() => { /* best effort */ });
    return { ok: true, reason: PUSH_REASONS.UNSUBSCRIBED };
  } catch {
    return { ok: false, reason: PUSH_REASONS.FAILED };
  }
}

/** Whether this device currently holds a push subscription. Never hangs: the
 *  registration wait is bounded, so the app-load check cannot dangle forever
 *  on a page whose worker never registers (e.g. the dev server). */
export async function hasPushSubscription(opts = {}) {
  if (!pushSupported()) return false;
  const opMs = Number(opts?.opTimeoutMs) > 0 ? Number(opts.opTimeoutMs) : PUSH_OP_TIMEOUT_MS;
  try {
    const reg = await withTimeout(pushRegistration(), SW_READY_TIMEOUT_MS);
    if (!reg || !reg.pushManager) return false;
    return !!(await withOpTimeout(reg.pushManager.getSubscription(), opMs));
  } catch {
    return false;
  }
}

export function notifySupport() {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function askNotifyPermission(opts = {}) {
  if (notifySupport() === 'unsupported') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  // The native prompt has no built-in bound: while it pends, the onboarding
  // Allow button sits disabled, and a browser that never settles the prompt
  // sticks it that way forever. Race a generous timeout; on timeout report
  // the live permission so the caller frees the button and the user can retry.
  const ms = Number(opts?.timeoutMs) > 0 ? Number(opts.timeoutMs) : NOTIFY_PERM_TIMEOUT_MS;
  try {
    return await withOpTimeout(Notification.requestPermission(), ms);
  } catch {
    try { return Notification.permission || 'denied'; } catch { return 'denied'; }
  }
}

// Tags already delivered, so a 30s poll cannot repeat itself. Persisted because
// the whole point is to be told ONCE that a warning started — re-notifying on
// every reload would train the user to dismiss without reading.
function seenTags() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function markSeen(tag) {
  try {
    const s = seenTags();
    s.add(tag);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-50)));
  } catch { /* storage unavailable — worst case we notify twice */ }
}

export function hasNotified(tag) {
  return seenTags().has(tag);
}

export function forgetNotified() {
  try { localStorage.removeItem(SEEN_KEY); } catch { /* ignore */ }
}

/**
 * Show one notification. Returns true when it was actually raised.
 *
 * Prefers the service-worker path: it is the only one that works on Android
 * Chrome, and it keeps the notification visible when the tab is backgrounded.
 * The constructor fallback covers desktop browsers with no SW registered.
 *
 * `url` is where a tap lands (the SW notificationclick handler navigates to
 * it): alert notifications deep-link to the alerts view.
 */
export async function notify({ title, body, tag, severity = 'UNKNOWN', silent = false, url = '/' }) {
  if (notifySupport() !== 'granted') return false;
  if (tag && hasNotified(tag)) return false;

  const options = {
    body,
    tag, // same tag replaces rather than stacks
    renotify: false,
    silent,
    // Colour and icon carry the meaning, so the text can stay short.
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { severity, url },
    vibrate: severity === 'RED' ? [200, 100, 200] : undefined,
  };

  try {
    if (navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, options);
        if (tag) markSeen(tag);
        return true;
      }
    }
  } catch { /* fall through to the constructor */ }

  try {
    // Constructor fallback (no service worker): keep the deep link — a tap
    // that opens a blank tab is a broken promise. data.url is honoured here
    // because there is no SW notificationclick handler on this path.
    const n = new Notification(title, { body, tag, icon: '/icons/icon-192.png' }); // eslint-disable-line no-new
    n.onclick = () => { try { window.open(url, '_blank', 'noopener'); } catch {} n.close(); };
    if (tag) markSeen(tag);
    return true;
  } catch {
    return false;
  }
}

/**
 * Request notification permission if not already granted.
 * Returns the current permission state.
 */
export async function requestPermission() {
  return askNotifyPermission();
}

/**
 * Show a PRE-ALERT notification.
 * English defaults; pass translated title/body for other languages.
 * Tapping it opens the app on the alerts view.
 */
export async function showPreAlert({ district, title, body, severity = 'YELLOW' }) {
  return notify({
    title: title || `Pre-alert issued for ${district}`,
    body: body || `A pre-alert has been issued for ${district}. Stay ready.`,
    tag: `pre-alert:${district}`,
    severity,
    silent: false,
    url: '/?view=alerts',
  });
}

/**
 * Show an ACTIVE warning notification.
 * English defaults; pass translated title/body for other languages.
 */
export async function showActive({ district, hazard, title, body, severity = 'RED' }) {
  return notify({
    title: title || `Active warning for ${district}: ${hazard}`,
    body: body || `An active ${hazard} warning is in effect for ${district}. Take precautions.`,
    tag: `active:${district}:${hazard}`,
    severity,
    silent: false,
    url: '/?view=alerts',
  });
}

/**
 * Show an ENDED (all-clear) notification.
 * English defaults; pass translated title/body for other languages.
 */
export async function showEnded({ district, title, body, severity = 'GREEN' }) {
  return notify({
    title: title || `Warning ended for ${district}`,
    body: body || `The warning for ${district} has ended.`,
    tag: `ended:${district}`,
    severity,
    silent: true,
    url: '/?view=alerts',
  });
}
