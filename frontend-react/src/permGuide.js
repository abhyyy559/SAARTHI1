// Permission helpers for the settings control center (SettingsPanel.jsx).
//
// Import-free on purpose: the node test suite imports this file as-is and
// exercises the state machine without a browser.
//
// Nothing here touches the network. queryMicPermission / requestMicPermission
// only call navigator APIs when they exist; without a browser they resolve
// 'unknown' / 'error' instead of throwing, so tests can drive every branch
// with fakes. localStorage access is funneled through prefStorage() so tests
// can inject a fake store.

export const SOUND_KEY = 'wgpt.sound';
export const PROFILE_KEY = 'wgpt.profile';
export const PROFILE_NAME_MAX = 40;

// --- platform ------------------------------------------------------------
export function detectPlatform(ua) {
  let s = ua;
  if (s === undefined || s === null) {
    try { s = (typeof navigator !== 'undefined' && navigator.userAgent) || ''; } catch { s = ''; }
  }
  s = String(s);
  if (/iPad|iPhone|iPod/.test(s)) return 'ios';
  if (/Android/.test(s)) return 'android';
  return 'desktop';
}

// --- storage --------------------------------------------------------------
function prefStorage(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

// --- in-app sound preference ------------------------------------------------
// '1'/missing = on, '0' = off. This is SAARTHI's own switch — the device volume
// and the browser tab mute stay separate (see the sound guidance strings).
export function readSoundPref(storage) {
  try {
    const s = prefStorage(storage);
    if (!s) return true;
    return s.getItem(SOUND_KEY) !== '0';
  } catch { return true; }
}

export function writeSoundPref(on, storage) {
  try {
    const s = prefStorage(storage);
    if (s) s.setItem(SOUND_KEY, on ? '1' : '0');
  } catch { /* storage unavailable — the toggle still works for this session */ }
  return !!on;
}

// --- profile name ------------------------------------------------------------
// Stored as JSON { name } so a future profile object can grow without a
// migration. Returns the cleaned name that was actually stored.
export function readProfileName(storage) {
  try {
    const s = prefStorage(storage);
    if (!s) return '';
    const raw = s.getItem(PROFILE_KEY);
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      return String((parsed && parsed.name) || '');
    } catch {
      return String(raw || ''); // tolerate a bare string from an older write
    }
  } catch { return ''; }
}

export function writeProfileName(name, storage) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, PROFILE_NAME_MAX);
  try {
    const s = prefStorage(storage);
    if (s) {
      if (clean) s.setItem(PROFILE_KEY, JSON.stringify({ name: clean }));
      else s.removeItem(PROFILE_KEY); // empty = unset, must survive a reload honestly
    }
  } catch { /* ignore */ }
  return clean;
}

// --- location state -----------------------------------------------------------
// Maps the store's locStatus onto the control-center vocabulary:
// granted / denied / prompt (not asked yet) / working / unavailable.
export function locPermInfo(locStatus) {
  switch (locStatus) {
    case 'ready': return { state: 'granted', action: 'none' };
    case 'denied': return { state: 'denied', action: 'guide' };
    case 'requesting':
    case 'resolving': return { state: 'working', action: 'none' };
    case 'unsupported': return { state: 'unavailable', action: 'none' };
    case 'error': return { state: 'prompt', action: 'retry' };
    case 'idle':
    default: return { state: 'prompt', action: 'request' };
  }
}

// --- microphone -----------------------------------------------------------------
// queryMicPermission only READS the current state (Permissions API). Where the
// API is missing (Firefox, older Safari) it answers 'unknown' honestly instead
// of guessing — the panel then offers the request button anyway.
export async function queryMicPermission() {
  try {
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!perms || typeof perms.query !== 'function') return 'unknown';
    const st = await perms.query({ name: 'microphone' });
    if (st && (st.state === 'granted' || st.state === 'denied' || st.state === 'prompt')) return st.state;
    return 'unknown';
  } catch { return 'unknown'; }
}

// requestMicPermission actually ASKS via getUserMedia, then immediately stops
// every track — we only want the permission verdict, never a recording.
export async function requestMicPermission() {
  try {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md || typeof md.getUserMedia !== 'function') return 'error';
    const stream = await md.getUserMedia({ audio: true });
    try {
      const tracks = stream && typeof stream.getTracks === 'function' ? stream.getTracks() : [];
      tracks.forEach((tr) => { try { tr.stop(); } catch { /* ignore */ } });
    } catch { /* ignore */ }
    return 'granted';
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return 'denied';
    return 'error';
  }
}

export function micPermInfo(micState) {
  switch (micState) {
    case 'granted': return { state: 'granted', action: 'none' };
    case 'denied': return { state: 'denied', action: 'guide' };
    case 'prompt': return { state: 'prompt', action: 'request' };
    default: return { state: 'unknown', action: 'request' };
  }
}

// --- notifications -----------------------------------------------------------------
export function ntfPermInfo(notifyPerm) {
  switch (notifyPerm) {
    case 'granted': return { state: 'granted', action: 'none' };
    case 'denied': return { state: 'denied', action: 'guide' };
    case 'unsupported': return { state: 'unavailable', action: 'none' };
    case 'default':
    default: return { state: 'prompt', action: 'request' };
  }
}

// --- guidance: permission -> platform -> ordered string keys --------------------------
// The actual words live in strings/areas/chrome.js (EN/HI/TE). Denied states
// cannot be re-prompted in-app — the browser/OS owns that decision — so every
// denied permission gets step-by-step guidance instead of a dead button.
export const GUIDE_STEPS = {
  location: {
    ios: ['locGuideIos1', 'locGuideIos2'],
    android: ['locGuideAndroid1', 'locGuideAndroid2'],
    desktop: ['locGuideDesktop1', 'locGuideDesktop2'],
  },
  microphone: {
    ios: ['micGuideIos1', 'micGuideIos2'],
    android: ['micGuideAndroid1', 'micGuideAndroid2'],
    desktop: ['micGuideDesktop1', 'micGuideDesktop2'],
  },
  notifications: {
    ios: ['ntfGuideIos1', 'ntfGuideIos2'],
    android: ['ntfGuideAndroid1', 'ntfGuideAndroid2'],
    desktop: ['ntfGuideDesktop1', 'ntfGuideDesktop2'],
  },
  sound: {
    ios: ['sndGuide1', 'sndGuide2', 'sndGuide3'],
    android: ['sndGuide1', 'sndGuide2', 'sndGuide3'],
    desktop: ['sndGuide1', 'sndGuide2', 'sndGuide3'],
  },
};

export function guideKeys(perm, platform) {
  const p = GUIDE_STEPS[perm];
  if (!p) return [];
  return p[platform] || p.desktop || [];
}
