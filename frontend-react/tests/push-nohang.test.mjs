import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Locks the first-run onboarding fix: every async leg behind the Allow
// buttons (store enableNotify/toggleNotify -> askNotifyPermission +
// subscribeToPush/unsubscribeFromPush) must SETTLE even when the browser
// never settles the underlying native wait. Otherwise ntfBusy/ctaBusy stick
// true and the buttons read as dead. notify.js has no imports, so it loads
// through a data URL like the other suites.
const source = readFileSync(new URL('../src/notify.js', import.meta.url), 'utf8');
const {
  subscribeToPush,
  unsubscribeFromPush,
  askNotifyPermission,
  hasPushSubscription,
  PUSH_REASONS,
} = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const realNavigator = globalThis.navigator;
const realWindow = globalThis.window;
const realNotification = globalThis.Notification;

const never = () => new Promise(() => {}); // a browser wait that never settles

function setBrowser({ serviceWorker, permission = 'default', requestPermission } = {}) {
  // Node ships a getter-only global navigator: delete it first so the fake
  // browser below can take its place (same pattern as push-enable.test.mjs).
  try { delete globalThis.navigator; } catch { /* ignore */ }
  globalThis.navigator = { serviceWorker };
  const Notification = { permission, requestPermission };
  globalThis.window = { PushManager: class {}, Notification };
  globalThis.Notification = Notification;
}

function restoreBrowser() {
  if (realNavigator === undefined) delete globalThis.navigator;
  else globalThis.navigator = realNavigator;
  if (realWindow === undefined) delete globalThis.window;
  else globalThis.window = realWindow;
  if (realNotification === undefined) delete globalThis.Notification;
  else globalThis.Notification = realNotification;
}

// The whole point: a hung native wait must fail the test loudly, never stall
// the suite the way it stalled the onboarding button.
function noHang(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`HUNG: ${label}`)), 4000)),
  ]);
}

const vapidOk = {
  pushVapid: async () => ({ public_key: `BM${'A'.repeat(86)}`, available: true }),
  pushSubscribe: async () => ({ status: 'subscribed' }),
  pushUnsubscribe: async () => ({ status: 'unsubscribed' }),
};

test('subscribeToPush settles when getSubscription never settles', async () => {
  setBrowser({
    serviceWorker: {
      getRegistration: async () => ({ pushManager: { getSubscription: never } }),
    },
  });
  try {
    const started = Date.now();
    const res = await noHang(
      subscribeToPush({ api: vapidOk }, { opTimeoutMs: 60 }),
      'getSubscription hang',
    );
    assert.equal(res.ok, false);
    assert.equal(res.reason, PUSH_REASONS.FAILED);
    assert.ok(Date.now() - started < 4000, 'resolved via the op timeout, not the hang');
  } finally {
    restoreBrowser();
  }
});

test('subscribeToPush settles when pushManager.subscribe never settles', async () => {
  setBrowser({
    serviceWorker: {
      getRegistration: async () => ({
        pushManager: { getSubscription: async () => null, subscribe: never },
      }),
    },
  });
  try {
    const res = await noHang(
      subscribeToPush({ api: vapidOk }, { opTimeoutMs: 60 }),
      'subscribe hang',
    );
    assert.equal(res.ok, false);
    assert.equal(res.reason, PUSH_REASONS.FAILED);
  } finally {
    restoreBrowser();
  }
});

test('unsubscribeFromPush settles when getSubscription never settles', async () => {
  setBrowser({
    serviceWorker: {
      getRegistration: async () => ({ pushManager: { getSubscription: never } }),
    },
  });
  try {
    const res = await noHang(
      unsubscribeFromPush(vapidOk, { opTimeoutMs: 60 }),
      'unsubscribe getSubscription hang',
    );
    assert.equal(res.ok, false);
    assert.equal(res.reason, PUSH_REASONS.FAILED);
  } finally {
    restoreBrowser();
  }
});

test('unsubscribeFromPush settles when sub.unsubscribe never settles', async () => {
  let serverCalled = false;
  setBrowser({
    serviceWorker: {
      getRegistration: async () => ({
        pushManager: {
          getSubscription: async () => ({ endpoint: 'https://push.example/sub/9', unsubscribe: never }),
        },
      }),
    },
  });
  try {
    const api = { ...vapidOk, pushUnsubscribe: async () => { serverCalled = true; return {}; } };
    const res = await noHang(
      unsubscribeFromPush(api, { opTimeoutMs: 60 }),
      'unsubscribe hang',
    );
    assert.equal(res.ok, false);
    assert.equal(res.reason, PUSH_REASONS.FAILED);
    assert.equal(serverCalled, false, 'a hung unsubscribe must not reach the server cleanup');
  } finally {
    restoreBrowser();
  }
});

test('askNotifyPermission settles when the native prompt never settles', async () => {
  setBrowser({ serviceWorker: {}, permission: 'default', requestPermission: never });
  try {
    const started = Date.now();
    const perm = await noHang(askNotifyPermission({ timeoutMs: 60 }), 'requestPermission hang');
    assert.equal(perm, 'default', 'reports the live permission so the caller frees the button');
    assert.ok(Date.now() - started < 4000, 'resolved via the permission timeout, not the hang');
  } finally {
    restoreBrowser();
  }
});

test('askNotifyPermission still resolves a granted prompt (no regression)', async () => {
  setBrowser({ serviceWorker: {}, permission: 'default', requestPermission: async () => 'granted' });
  try {
    assert.equal(await noHang(askNotifyPermission({ timeoutMs: 500 }), 'granted'), 'granted');
  } finally {
    restoreBrowser();
  }
});

test('hasPushSubscription settles when getSubscription never settles', async () => {
  setBrowser({
    serviceWorker: {
      getRegistration: async () => ({ pushManager: { getSubscription: never } }),
    },
  });
  try {
    assert.equal(await noHang(hasPushSubscription({ opTimeoutMs: 60 }), 'hasPushSubscription hang'), false);
  } finally {
    restoreBrowser();
  }
});
