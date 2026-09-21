import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Loaded the same way the other suites load browser modules: the source has no
// imports and no Vite-only syntax, so it is imported as-is through a data URL.
const source = readFileSync(new URL('../src/notify.js', import.meta.url), 'utf8');
const {
  pushSupported,
  subscribeToPush,
  hasPushSubscription,
  askNotifyPermission,
  pushReasonKey,
  PUSH_REASONS,
} = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

// --- harness: a fake browser per test ---------------------------------------
const realNavigator = globalThis.navigator;
const realWindow = globalThis.window;
const realNotification = globalThis.Notification;

function setBrowser({ serviceWorker, permission = 'default', requestPermission } = {}) {
  if (serviceWorker === undefined) {
    delete globalThis.navigator;
  } else {
    globalThis.navigator = { serviceWorker };
  }
  const Notification = requestPermission || permission !== undefined
    ? { permission, requestPermission }
    : undefined;
  globalThis.window = { PushManager: class {}, ...(Notification ? { Notification } : {}) };
  if (Notification) globalThis.Notification = Notification;
  else delete globalThis.Notification;
}

function restoreBrowser() {
  if (realNavigator === undefined) delete globalThis.navigator;
  else globalThis.navigator = realNavigator;
  if (realWindow === undefined) delete globalThis.window;
  else globalThis.window = realWindow;
  if (realNotification === undefined) delete globalThis.Notification;
  else globalThis.Notification = realNotification;
}

const vapidOk = {
  pushVapid: async () => ({ public_key: `BM${'A'.repeat(86)}`, available: true }),
  pushSubscribe: async () => ({ status: 'subscribed' }),
};

function fakeSub(endpoint = 'https://push.example/sub/1') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
  };
}

function fakeReg(over = {}) {
  return {
    pushManager: {
      getSubscription: async () => null,
      subscribe: async () => { throw new Error('subscribe not mocked'); },
      ...over.pushManager,
    },
  };
}

// A test-side hang detector: the whole point of these tests is that the enable
// flow NEVER hangs, so a hung call fails loudly instead of stalling the suite.
function noHang(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`HUNG: ${label}`)), 4000)),
  ]);
}

test('pushSupported() is false with no service worker in the browser', () => {
  setBrowser({ serviceWorker: undefined });
  try {
    assert.equal(pushSupported(), false);
  } finally {
    restoreBrowser();
  }
});

test('subscribeToPush reports unsupported when the browser has no push', async () => {
  setBrowser({ serviceWorker: undefined });
  try {
    const res = await noHang(subscribeToPush({ api: vapidOk }), 'unsupported');
    assert.deepEqual(res, { ok: false, reason: 'unsupported' });
  } finally {
    restoreBrowser();
  }
});

test('subscribeToPush never hangs when no worker can register (dev server)', async () => {
  // The reported bug: main.jsx never registers /sw.js in `vite dev`, so the
  // old `await navigator.serviceWorker.ready` hung forever and the button did
  // nothing. A failed on-demand registration must resolve, not hang.
  setBrowser({
    serviceWorker: {
      getRegistration: async () => undefined,
      register: async () => { throw new Error('failed to register /sw.js (404 in dev)'); },
    },
  });
  try {
    const res = await noHang(subscribeToPush({ api: vapidOk }), 'dev-server register');
    assert.equal(res.ok, false);
    assert.equal(res.reason, PUSH_REASONS.SW_MISSING);
  } finally {
    restoreBrowser();
  }
});

test('subscribeToPush never hangs when the worker never becomes ready', async () => {
  // Registration starts but the worker never activates: the installing
  // promise would never settle — the bounded wait must give up honestly.
  setBrowser({
    serviceWorker: {
      getRegistration: async () => undefined,
      register: () => new Promise(() => {}), // never settles
    },
  });
  try {
    const started = Date.now();
    const res = await noHang(
      subscribeToPush({ api: vapidOk }, { readyTimeoutMs: 60 }),
      'ready never settles',
    );
    assert.equal(res.reason, PUSH_REASONS.SW_MISSING);
    assert.ok(Date.now() - started < 4000, 'resolved via the bounded wait');
  } finally {
    restoreBrowser();
  }
});

test('subscribeToPush reports server-unavailable when VAPID is down', async () => {
  setBrowser({ serviceWorker: { getRegistration: async () => fakeReg() } });
  try {
    const api = { ...vapidOk, pushVapid: async () => ({ public_key: '', available: false }) };
    const res = await noHang(subscribeToPush({ api }), 'vapid down');
    assert.deepEqual(res, { ok: false, reason: 'server-unavailable' });
  } finally {
    restoreBrowser();
  }
});

test('subscribeToPush happy path registers and returns the endpoint', async () => {
  const sub = fakeSub();
  const seen = {};
  setBrowser({
    serviceWorker: { getRegistration: async () => fakeReg({ pushManager: { subscribe: async () => sub } }) },
  });
  try {
    const api = {
      ...vapidOk,
      pushSubscribe: async (payload) => {
        seen.payload = payload;
        return { status: 'subscribed' };
      },
    };
    const res = await noHang(
      subscribeToPush({ api, district: 'Nellore', language: 'te', persona: 'fisherman' }),
      'happy path',
    );
    assert.equal(res.ok, true);
    assert.equal(res.endpoint, sub.endpoint);
    assert.equal(seen.payload.district, 'Nellore');
    assert.equal(seen.payload.language, 'te');
  } finally {
    restoreBrowser();
  }
});

test('subscribeToPush maps a denied permission to denied, not failed', async () => {
  const denied = new Error('denied');
  denied.name = 'NotAllowedError';
  setBrowser({
    serviceWorker: { getRegistration: async () => fakeReg({ pushManager: { subscribe: async () => { throw denied; } } }) },
  });
  try {
    const res = await noHang(subscribeToPush({ api: vapidOk }), 'denied');
    assert.deepEqual(res, { ok: false, reason: 'denied' });
  } finally {
    restoreBrowser();
  }
});

test('subscribeToPush surfaces the server rejection reason', async () => {
  setBrowser({
    serviceWorker: { getRegistration: async () => fakeReg({ pushManager: { subscribe: async () => fakeSub() } }) },
  });
  try {
    const api = { ...vapidOk, pushSubscribe: async () => ({ status: 'error', reason: 'bad-keys' }) };
    const res = await noHang(subscribeToPush({ api }), 'rejected');
    assert.deepEqual(res, { ok: false, reason: 'bad-keys' });
  } finally {
    restoreBrowser();
  }
});

test('hasPushSubscription never hangs and returns false without a worker', async () => {
  setBrowser({
    serviceWorker: {
      getRegistration: async () => undefined,
      register: async () => { throw new Error('no worker in dev'); },
    },
  });
  try {
    const has = await noHang(hasPushSubscription(), 'hasPushSubscription');
    assert.equal(has, false);
  } finally {
    restoreBrowser();
  }
});

test('askNotifyPermission reports unsupported without the Notifications API', async () => {
  setBrowser({ serviceWorker: {} });
  delete globalThis.window.Notification;
  try {
    assert.equal(await askNotifyPermission(), 'unsupported');
  } finally {
    restoreBrowser();
  }
});

test('askNotifyPermission passes a denied permission through honestly', async () => {
  setBrowser({ serviceWorker: {}, permission: 'denied' });
  try {
    assert.equal(await askNotifyPermission(), 'denied');
  } finally {
    restoreBrowser();
  }
});

test('askNotifyPermission returns granted after the prompt is accepted', async () => {
  setBrowser({
    serviceWorker: {},
    permission: 'default',
    requestPermission: async () => 'granted',
  });
  try {
    assert.equal(await askNotifyPermission(), 'granted');
  } finally {
    restoreBrowser();
  }
});

// --- pushReasonKey: the single machine-reason -> i18n-key map ----------------
// Phase 0 (2026-09-21): the mapping was duplicated in store.jsx, SettingsPanel
// and NotificationsPanel. notify.js now owns it; this suite pins both the
// values and the single-owner invariant.
test('pushReasonKey maps every machine reason to its i18n key', () => {
  assert.equal(pushReasonKey('unsupported'), 'rsnUnsupported');
  assert.equal(pushReasonKey('server-unavailable'), 'rsnServer');
  assert.equal(pushReasonKey('denied'), 'rsnDenied');
  assert.equal(pushReasonKey('sw-unavailable'), 'rsnSw');
  assert.equal(pushReasonKey('server-rejected'), 'rsnRejected');
  assert.equal(pushReasonKey('failed'), 'rsnFailed');
  assert.equal(pushReasonKey('bogus-reason'), 'rsnFailed', 'unknown reasons must fall back, never render a raw key');
});

test('no file duplicates the push-reason map', () => {
  // The literal i18n keys may appear only in notify.js (the map itself) and
  // this test (the pins). Any other copy is a drift waiting to happen.
  const offenders = [];
  for (const f of [
    '../src/store.jsx',
    '../src/components/SettingsPanel.jsx',
    '../src/components/NotificationsPanel.jsx',
  ]) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    if (/'rsnUnsupported'/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], 'push-reason map is duplicated again');
});
