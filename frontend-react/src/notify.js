// Real operating-system notifications, driven by the app's own verdict.
//
// Scope, stated honestly: these fire while the app is open (a background tab is
// fine). A notification that arrives when the app is fully closed needs a push
// server, VAPID keys and a subscription store — that is not demo mode, and faking
// it would be a claim we cannot back.
//
// The Notifications API is the same one a push server would end up calling, so
// nothing here is throwaway: a real push service only replaces *who* calls
// notify(), not this code.

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
 * actually be reached while the app is closed.
 */
export async function subscribeToPush({ api, district, language, persona }) {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  try {
    const { public_key: publicKey, available } = await api.pushVapid();
    if (!available || !publicKey) return { ok: false, reason: 'server-unavailable' };

    const reg = await navigator.serviceWorker.ready;
    if (!reg.pushManager) return { ok: false, reason: 'unsupported' };

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        // Required by Chrome: every push must be shown to the user.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const r = await api.pushSubscribe({
      subscription: sub.toJSON(),
      district, language, persona,
    });
    if (r && r.status === 'subscribed') return { ok: true, endpoint: sub.endpoint };
    return { ok: false, reason: (r && r.reason) || 'server-rejected' };
  } catch (err) {
    // A denied permission lands here as NotAllowedError; so does a network
    // failure. Either way the caller shows the honest reason, not a false "on".
    return { ok: false, reason: err?.name === 'NotAllowedError' ? 'denied' : 'failed' };
  }
}

/** Stop background push for this device, on both sides. */
export async function unsubscribeFromPush(api) {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true, reason: 'none' };
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => { /* server cleanup still worth trying */ });
    await api.pushUnsubscribe(endpoint).catch(() => { /* best effort */ });
    return { ok: true, reason: 'unsubscribed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Whether this device currently holds a push subscription. */
export async function hasPushSubscription() {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export function notifySupport() {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function askNotifyPermission() {
  if (notifySupport() === 'unsupported') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
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
 */
export async function notify({ title, body, tag, severity = 'UNKNOWN', silent = false }) {
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
    data: { severity, url: '/' },
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
    // eslint-disable-next-line no-new
    new Notification(title, { body, tag, icon: '/icons/icon-192.png' });
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
 * Warning tone, message: "Pre-alert issued for {district}"
 */
export async function showPreAlert({ district, title = 'Pre-alert', severity = 'YELLOW' }) {
  return notify({
    title: t('ntfPreAlert', { district }) || `Pre-alert issued for ${district}`,
    body: t('ntfPreAlertBody', { district }) || `A pre-alert has been issued for ${district}. Please stay alert.`,
    tag: `pre-alert:${district}`,
    severity,
    silent: false,
  });
}

/**
 * Show an ACTIVE warning notification.
 * Urgent tone, message: "Active warning for {district}: {hazard}"
 */
export async function showActive({ district, hazard, title = 'Active Warning', severity = 'RED' }) {
  return notify({
    title: t('ntfActive', { district, hazard }) || `Active warning for ${district}: ${hazard}`,
    body: t('ntfActiveBody', { district, hazard }) || `An active ${hazard} warning is in effect for ${district}. Take precautions.`,
    tag: `active:${district}:${hazard}`,
    severity,
    silent: false,
  });
}

/**
 * Show an ENDED (all-clear) notification.
 * Calm tone, message: "Warning ended for {district}"
 */
export async function showEnded({ district, title = 'All Clear', severity = 'GREEN' }) {
  return notify({
    title: t('ntfEnded', { district }) || `Warning ended for ${district}`,
    body: t('ntfEndedBody', { district }) || `The warning for ${district} has ended. Normal conditions restored.`,
    tag: `ended:${district}`,
    severity,
    silent: true,
  });
}
