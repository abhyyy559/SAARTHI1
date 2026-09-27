import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// permGuide.js has no imports and no Vite-only syntax: imported directly.
import {
  SOUND_KEY,
  PROFILE_KEY,
  PROFILE_NAME_MAX,
  detectPlatform,
  readSoundPref,
  writeSoundPref,
  readProfileName,
  writeProfileName,
  locPermInfo,
  micPermInfo,
  ntfPermInfo,
  queryMicPermission,
  requestMicPermission,
  GUIDE_STEPS,
  guideKeys,
} from '../src/permGuide.js';
import chrome from '../src/strings/areas/chrome.js';

// --- harness ----------------------------------------------------------------
const realNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function setNavigator(n) {
  // Node 24 exposes navigator as a getter-only global: plain assignment throws.
  Object.defineProperty(globalThis, 'navigator', { value: n, configurable: true, writable: true });
}
function restoreNavigator() {
  if (realNavigatorDesc) Object.defineProperty(globalThis, 'navigator', realNavigatorDesc);
  else { try { delete globalThis.navigator; } catch { /* ignore */ } }
}
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
const TAMIL = /[\u0B80-\u0BFF]/;

// --- platform detection ------------------------------------------------------
test('detectPlatform: ios / android / desktop', () => {
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'ios');
  assert.equal(detectPlatform('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)'), 'ios');
  assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'android');
  assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'desktop');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'desktop');
  assert.equal(detectPlatform(''), 'desktop');
});

// --- location state machine ----------------------------------------------------
test('locPermInfo maps every store locStatus honestly', () => {
  assert.deepEqual(locPermInfo('ready'), { state: 'granted', action: 'none' });
  assert.deepEqual(locPermInfo('denied'), { state: 'denied', action: 'guide' });
  assert.deepEqual(locPermInfo('requesting'), { state: 'working', action: 'none' });
  assert.deepEqual(locPermInfo('resolving'), { state: 'working', action: 'none' });
  assert.deepEqual(locPermInfo('unsupported'), { state: 'unavailable', action: 'none' });
  assert.deepEqual(locPermInfo('error'), { state: 'prompt', action: 'retry' });
  assert.deepEqual(locPermInfo('idle'), { state: 'prompt', action: 'request' });
  assert.deepEqual(locPermInfo('something-new'), { state: 'prompt', action: 'request' });
});

// --- microphone state machine ----------------------------------------------------
test('micPermInfo: unknown is requestable, never guessed as denied', () => {
  assert.deepEqual(micPermInfo('granted'), { state: 'granted', action: 'none' });
  assert.deepEqual(micPermInfo('denied'), { state: 'denied', action: 'guide' });
  assert.deepEqual(micPermInfo('prompt'), { state: 'prompt', action: 'request' });
  assert.deepEqual(micPermInfo('unknown'), { state: 'unknown', action: 'request' });
});

// --- notifications state machine ----------------------------------------------------
test('ntfPermInfo maps Notification.permission honestly', () => {
  assert.deepEqual(ntfPermInfo('granted'), { state: 'granted', action: 'none' });
  assert.deepEqual(ntfPermInfo('denied'), { state: 'denied', action: 'guide' });
  assert.deepEqual(ntfPermInfo('unsupported'), { state: 'unavailable', action: 'none' });
  assert.deepEqual(ntfPermInfo('default'), { state: 'prompt', action: 'request' });
});

// --- mic permission query ----------------------------------------------------
test('queryMicPermission reads state, degrades honestly without the API', async () => {
  try {
    for (const s of ['granted', 'denied', 'prompt']) {
      setNavigator({ permissions: { query: async () => ({ state: s }) } });
      assert.equal(await queryMicPermission(), s);
    }
    setNavigator({ permissions: { query: async () => { throw new Error('nope'); } } });
    assert.equal(await queryMicPermission(), 'unknown');
    setNavigator({ permissions: { query: async () => ({ state: 'weird' }) } });
    assert.equal(await queryMicPermission(), 'unknown');
    setNavigator({}); // Firefox-style: no permissions API
    assert.equal(await queryMicPermission(), 'unknown');
    setNavigator(undefined); // no browser at all
    assert.equal(await queryMicPermission(), 'unknown');
  } finally {
    restoreNavigator();
  }
});

// --- mic permission request ----------------------------------------------------
test('requestMicPermission asks via getUserMedia and stops every track', async () => {
  const stopped = [];
  try {
    setNavigator({
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped.push('t1') }, { stop: () => stopped.push('t2') }] }),
      },
    });
    assert.equal(await requestMicPermission(), 'granted');
    assert.deepEqual(stopped, ['t1', 't2']);

    setNavigator({ mediaDevices: { getUserMedia: async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; } } });
    assert.equal(await requestMicPermission(), 'denied');

    setNavigator({ mediaDevices: { getUserMedia: async () => { const e = new Error('no mic'); e.name = 'NotFoundError'; throw e; } } });
    assert.equal(await requestMicPermission(), 'error');

    setNavigator({}); // no mediaDevices
    assert.equal(await requestMicPermission(), 'error');
  } finally {
    restoreNavigator();
  }
});

// --- sound preference ----------------------------------------------------
test('sound pref defaults on, persists off, survives missing storage', () => {
  const s = fakeStorage();
  assert.equal(readSoundPref(s), true);
  writeSoundPref(false, s);
  assert.equal(s.getItem(SOUND_KEY), '0');
  assert.equal(readSoundPref(s), false);
  writeSoundPref(true, s);
  assert.equal(readSoundPref(s), true);
  assert.equal(readSoundPref(undefined), true); // node: no localStorage
});

// --- profile name ----------------------------------------------------
test('profile name trims, collapses spaces, caps length, unsets honestly', () => {
  const s = fakeStorage();
  assert.equal(readProfileName(s), '');
  assert.equal(writeProfileName('  Abhi   ram  ', s), 'Abhi ram');
  assert.equal(readProfileName(s), 'Abhi ram');
  assert.equal(JSON.parse(s.getItem(PROFILE_KEY)).name, 'Abhi ram');
  const long = 'x'.repeat(PROFILE_NAME_MAX + 20);
  assert.equal(writeProfileName(long, s).length, PROFILE_NAME_MAX);
  writeProfileName('   ', s);
  assert.equal(s.getItem(PROFILE_KEY), null); // empty = key removed, not blank
  assert.equal(readProfileName(s), '');
});

// --- guidance coverage ----------------------------------------------------
test('every permission x platform has guidance keys, and all keys exist in chrome.js', () => {
  for (const perm of Object.keys(GUIDE_STEPS)) {
    for (const plat of ['ios', 'android', 'desktop']) {
      const keys = guideKeys(perm, plat);
      assert.ok(keys.length > 0, `${perm}/${plat} has no guidance`);
      for (const k of keys) {
        for (const lang of ['en', 'hi', 'te']) {
          assert.ok(chrome[lang][k], `missing ${lang} string for ${k}`);
        }
      }
    }
  }
  assert.deepEqual(guideKeys('nope', 'ios'), []);
  assert.ok(guideKeys('location', 'weird-platform').length > 0, 'unknown platform falls back to desktop');
});

// --- chrome.js parity + no Tamil ----------------------------------------------------
test('chrome.js EN/HI/TE key parity, no Tamil script', () => {
  const sets = ['en', 'hi', 'te'].map((l) => Object.keys(chrome[l]).sort().join(','));
  assert.equal(sets[0], sets[1], 'en/hi key mismatch');
  assert.equal(sets[1], sets[2], 'hi/te key mismatch');
  for (const lang of ['en', 'hi', 'te']) {
    for (const [k, v] of Object.entries(chrome[lang])) {
      assert.ok(!TAMIL.test(v), `Tamil script in ${lang}:${k}`);
      assert.ok(v.length > 0, `empty string ${lang}:${k}`);
    }
  }
});

// --- SettingsPanel key coverage ----------------------------------------------------
test('every string key SettingsPanel renders exists in chrome.js or the base allowlist', () => {
  const src = readFileSync(new URL('../src/components/SettingsPanel.jsx', import.meta.url), 'utf8');
  // Keys reach t() three ways here: t(lang, 'literal'), titleKey="permXxx"
  // props, and the STATE_META table / ternaries — targeted sweeps for each.
  const lit = [...src.matchAll(/t\(lang,\s*'([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]);
  const props = [...src.matchAll(/(?:titleKey|descKey|actionKey)="([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
  const perms = [...src.matchAll(/'(perm[A-Za-z]+)'/g)].map((m) => m[1]);
  const keys = [...lit, ...props, ...perms];
  assert.ok(keys.length > 20, 'expected many string references');
  // Pre-existing base-dictionary keys this panel already used before Crew G.
  const base = new Set(['setRole', 'setPlace', 'useMyLocation', 'setLanguage', 'setAlerts', 'setAlertsSub', 'setPushBg', 'setPushInAppWhy']);
  const missing = [...new Set(keys)].filter((k) => !base.has(k) && !chrome.en[k]);
  assert.deepEqual(missing, [], `SettingsPanel references missing strings: ${missing.join(', ')}`);
});

test('SettingsPanel wires the Crew B deep-focus contract', () => {
  const src = readFileSync(new URL('../src/components/SettingsPanel.jsx', import.meta.url), 'utf8');
  assert.ok(src.includes("window.addEventListener('wgpt:perm'"), 'listens for wgpt:perm');
  assert.ok(src.includes('`perm-${guidePerm}`'), 'mic row has a deep-focus anchor id');
  assert.ok(src.includes("window.dispatchEvent(new CustomEvent('wgpt:profile'"), 'broadcasts profile changes');
});
