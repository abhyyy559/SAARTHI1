// Single application store. Views read from here instead of prop-drilling, and
// `ask()` is registered by HomeChat from inside an EFFECT (never during render).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, HYD, onDemoForbidden, setOfflineSim } from './api';
import { DISTRICTS, t } from './i18n';
import { cacheGuidance, useOnline } from './offline';
import { askNotifyPermission, forgetNotified, hasPushSubscription, notify, notifySupport, pushReasonKey, subscribeToPush, unsubscribeFromPush } from './notify';
import { tagFor, transition } from './alertWatch';
import { splitSpeakChunks } from './speakChunks';

const AppCtx = createContext(null);

// /api/voice/status is fetched once and cached for 60s (in-flight requests
// are shared). Lets speak() skip the doomed server round-trip entirely when
// the backend has no TTS provider. A failed status check is treated as
// browser-fallback (offline ⇒ server TTS is unreachable) and cached the
// same way, so an offline device doesn't pay a 5s timeout on every tap.
const voiceStatusCache = { value: null, at: 0, inflight: null };
// Exported so useVoiceInput can take the STT fast-path without a doomed
// record→upload round trip when the server has no STT provider.
export function getVoiceStatus() {
  const now = Date.now();
  if (voiceStatusCache.value && now - voiceStatusCache.at < 60000) {
    return Promise.resolve(voiceStatusCache.value);
  }
  if (!voiceStatusCache.inflight) {
    voiceStatusCache.inflight = api.voiceStatus()
      .then((s) => {
        voiceStatusCache.value = s; voiceStatusCache.at = Date.now(); return s;
      })
      .catch(() => {
        const fb = { stt: 'browser-fallback', tts: 'browser-fallback' };
        voiceStatusCache.value = fb; voiceStatusCache.at = Date.now(); return fb;
      })
      .finally(() => { voiceStatusCache.inflight = null; });
  }
  return voiceStatusCache.inflight;
}

// The three source modes (docs/SOURCE-MODES.md). Labels live in i18n so the
// switch reads in the user's language; the mode ids stay machine-readable.
const MODE_LABEL_KEY = { demo: 'modeDemo', imd: 'modeImd', hybrid: 'modeHybrid' };
const MODE_NOTE_KEY = { demo: 'modeDemoNote', imd: 'modeImdNote', hybrid: 'modeHybridNote' };
export const SOURCE_MODES = ['demo', 'imd', 'hybrid'];
export const modeLabel = (lang, id) => t(lang, MODE_LABEL_KEY[id] || 'modeHybrid');
export const modeNote = (lang, id) => t(lang, MODE_NOTE_KEY[id] || 'modeHybridNote');

// useApp is the read half of the store contract with AppProvider below; the rule is
// switched off for this file in .oxlintrc.json/overrides because co-location is intended.
export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

const readPref = (key, fallback) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};
const writePref = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};
const readLoc = () => {
  try {
    const raw = localStorage.getItem('wgpt.loc');
    if (!raw) return null;
    const l = JSON.parse(raw);
    if (l && l.district && Number.isFinite(l.lat) && Number.isFinite(l.lon)) return l;
  } catch { /* ignore corrupt stored location */ }
  return null;
};

// Opaque per-device id for read receipts and delivery telemetry. The server
// never learns who the user is — the id only separates "my phone read it" from
// "my tablet did", and lets one browser act as both citizen and relay target
// in the P2P demo.
const readDevice = () => {
  try {
    let d = localStorage.getItem('wgpt.device');
    if (!d) {
      d = `dev-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('wgpt.device', d);
    }
    return d;
  } catch { return 'anonymous'; }
};

export function AppProvider({ children }) {
  // One-way deep link. IA dedup (2026-09-20): the only public views are
  // home · alerts · advisory + the More sheet's notifications · trust ·
  // settings. No offline/aviation view (background capabilities only).
  // admin stays hidden (PIN-gated direct URL).
  // (Initial state only — in-app navigation stays via setView.)
  const [view, setView] = useState(() => {
    try {
      const v = new URLSearchParams(window.location.search).get('view');
      return ['home', 'alerts', 'advisory', 'notifications', 'trust', 'settings', 'admin'].includes(v) ? v : 'home';
    } catch { return 'home'; }
  });
  const [lang, setLang] = useState(() => readPref('wgpt.lang', 'en'));
  // The role is UNSET on first run — never silently defaulted to a safety-
  // relevant persona (M1). Migration: the old build defaulted to 'fisherman'
  // without asking, so a stored fisherman from before this build reads as
  // unset exactly once. An active re-pick is one tap away.
  const [persona, setPersona] = useState(() => {
    try {
      if (!localStorage.getItem('wgpt.persona.v2')) {
        localStorage.setItem('wgpt.persona.v2', '1');
        return null;
      }
      return localStorage.getItem('wgpt.persona') || null;
    } catch { return null; }
  });
  const pendingAskRef = useRef(null); // Home → Ask one-shot hand-off (ref: no effect setState)
  // Single light theme: no theme state, no switcher, no data-theme attribute.
  // Truthful until /api/mode answers: the backend decides the mode, not a guess.
  // Three modes, not two — see docs/SOURCE-MODES.md. `sourceMode` is the truth
  // ('demo' | 'imd' | 'hybrid'); `demoMode` stays a derived boolean because a
  // lot of call sites already read it and renaming them all buys nothing.
  const [sourceMode, setSourceMode] = useState('hybrid');
  const [modeInfo, setModeInfo] = useState(null);
  const demoMode = sourceMode === 'demo';
  const [districts] = useState(DISTRICTS); // fallback search options (coastal + inland)
  // Auto-location lifecycle: idle → requesting → resolving → ready | denied | unsupported | error.
  // Never silently default: HYD is only a placeholder until the user grants permission
  // or picks a fallback; data views gate on locStatus === 'ready'.
  const [storedLoc] = useState(readLoc);
  const [loc, setLoc] = useState(storedLoc || { ...HYD });
  const [locStatus, setLocStatus] = useState(storedLoc ? 'ready' : 'idle');
  const [locNote, setLocNote] = useState('');
  const [device] = useState(readDevice);
  const [backendState, setBackendState] = useState('…');
  const [sources, setSources] = useState(null);
  const [pipe, setPipe] = useState({ lit: [], detail: {} });
  const [result, setResult] = useState(null);        // last chat turn → Evidence view
  // The alert the citizen tapped to open in the Details view. Set by alert
  // cards (home bulletins, alert center); Details reads it, so the empty
  // state is honest when nothing was ever selected.
  // Push-notification tap deep link: SW opens `/?view=alerts&alert=<id>`.
  // The id seeds selectedAlert so AlertsView expands that alert's detail on
  // first paint. Unknown ids simply match nothing (AlertsList opens none).
  const [selectedAlert, setSelectedAlert] = useState(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('alert');
      return id ? { id } : null;
    } catch { return null; }
  });
  const [disaster, setDisaster] = useState(false);
  const [simOffline, setSimOffline] = useState(false);
  const online = useOnline();
  // Connection state machine: live | reconnecting | offline.
  // Heartbeat every 30s + window online/offline events (PWA brief §8).
  const [netState, setNetState] = useState('live');
  const [lastSync, setLastSync] = useState(null);
  const [syncTick, setSyncTick] = useState(0);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
    // Shell renders toasts from the wgpt:toast DOM event (its own toast
    // state); the store's toast state has no renderer, so without this event
    // the message is silent — the exact "button does nothing" failure mode.
    try {
      window.dispatchEvent(new CustomEvent('wgpt:toast', { detail: msg }));
    } catch { /* non-DOM environment */ }
  }, []);
  // One place that reads a /api/mode payload. The backend owns the mode; the UI
  // never infers it from a boolean it happens to have lying around.
  const applyMode = useCallback((d) => {
    if (!d) return;
    setModeInfo(d);
    setSourceMode(d.source_mode || (d.demo_mode ? 'demo' : 'hybrid'));
  }, []);

  // DEMO / IMD / HYBRID switch: flips the backend at runtime, then refetches.
  // The mode names which sources are carrying the answer, so the toast says that
  // rather than just repeating the mode word back at the user.
  const setBackendMode = useCallback(async (mode) => {
    try {
      const r = await api.setMode(mode);
      if (r && r.ok) {
        applyMode(r);
        setSyncTick((n) => n + 1);
        const shown = r.source_mode || r.mode || mode;
        showToast(`${t(lang, 'modeSwitched')} ${t(lang, MODE_LABEL_KEY[shown] || 'modeHybrid')}`);
        return true;
      }
    } catch { /* backend unreachable */ }
    showToast(t(lang, 'modeSwitchFailed'));
    return false;
  }, [showToast, lang, applyMode]);

  useEffect(() => {
    api.mode().then(applyMode).catch(() => {});
  }, [applyMode]);

  // Warm the voice-status cache on launch: the first tap on any mic/speaker
  // then skips even the tiny /api/voice/status round trip, so TTS starts
  // instantly and STT can take its browser fast-path immediately.
  useEffect(() => {
    getVoiceStatus();
  }, []);

  // Self-heal: a 403 on any /api/demo/* route means the backend's demo flag
  // flipped under us (restart, another tab, .env default). Re-sync once per
  // burst — the throttled hook in api.js keeps this from becoming a storm.
  useEffect(() => {
    onDemoForbidden(() => api.mode().then(applyMode).catch(() => {}));
  }, [applyMode]);

  useEffect(() => {
    let dead = false;
    let wasDown = false;
    const beat = async () => {
      if (simOffline || !navigator.onLine) {
        wasDown = true;
        if (!dead) setNetState('offline');
        return;
      }
      try {
        await api.health();
        if (dead) return;
        setNetState('live');
        setLastSync(new Date().toISOString());
        // Re-sync the backend mode on every beat: if the backend restarts it
        // boots back to its .env default (usually hybrid). Without this the UI
        // keeps believing demo is on and spams demo endpoints with 403s.
        api.mode().then(applyMode).catch(() => {});
        if (wasDown) {
          wasDown = false;
          // Queued offline questions are replayed (and the queue cleared) by
          // HomeChat, which owns the chat log. This effect used to clear the
          // queue here first, so every question asked while offline was dropped
          // without ever being replayed. One owner, and it is the one that can
          // actually show the answers.
          setSyncTick((n) => n + 1); // data views refetch once on reconnect
        }
      } catch {
        wasDown = true;
        if (!dead) setNetState('reconnecting');
      }
    };
    beat();
    const id = setInterval(beat, 30000);
    const on = () => beat();
    const off = () => { wasDown = true; if (!dead) setNetState('offline'); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { dead = true; clearInterval(id); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [simOffline, applyMode]);
  const askRef = useRef(null);

  // HomeChat publishes its submit handler here from an effect — safe, no render-time ref write.
  const registerAsk = useCallback((fn) => { askRef.current = fn; }, []);
  const ask = useCallback((text) => { if (askRef.current) askRef.current(text); }, []);

  // Speak an answer aloud. Latency-first, honesty-first:
  //  1. The speaking indicator flips to 'loading' synchronously — the UI shows
  //     "speaking…" on the next frame, never blocked on network.
  //  2. /api/voice/status is checked once and cached: when the backend reports
  //     browser-fallback, native speechSynthesis starts INSTANTLY — no doomed
  //     server round-trip is awaited first.
  //  3. When server TTS is live, /api/voice/synthesize-stream is consumed
  //     progressively: the first audio chunk plays as soon as it arrives
  //     while later chunks are still generating (play while generating).
  //  4. If the stream endpoint is missing (older backend), degrade to legacy
  //     sequential per-chunk non-streaming calls; if that fails too, honest
  //     browser speechSynthesis with the voiceFallback note.
  // Singleton audio - a new answer stops the old one.
  const audioRef = useRef(null);
  const ttsAbort = useRef(null);
  const speechId = useRef(0);
  const [speechState, setSpeechState] = useState('idle');
  const [speechNote, setSpeechNote] = useState('');
  // Global STT phase mirror: HomeChat reports its useVoiceInput
  // state here so Shell can render one unmissable Listening popup.
  const [listenState, setListenState] = useState('idle');
  const cancelAudio = useCallback(() => {
    speechId.current++;
    ttsAbort.current?.abort();
    ttsAbort.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
  }, []);
  const stopSpeaking = useCallback(() => {
    cancelAudio();
    setSpeechState('idle');
  }, [cancelAudio]);
  useEffect(() => {
    document.documentElement.lang = lang;
    // A language/profile/place switch must never strand the Speaking popup:
    // stop audio AND reset the indicator state together.
    return () => { cancelAudio(); setSpeechState('idle'); };
  }, [lang, persona, loc.district, cancelAudio]);
  // Browser-native speech, started instantly when the server has no TTS
  // provider (or when server TTS fails). The voiceFallback note stays honest.
  // getVoices() can return [] on first call (voices load asynchronously) —
  // never hard-fail for a missing language match; set the utterance language
  // and let the engine fall back to its default voice instead of flashing
  // "voice unavailable" on a first tap.
  const speakWithBrowser = useCallback((text, id, noteKey = 'voiceFallback') => {
    const synth = window.speechSynthesis;
    if (!synth) { setSpeechNote('voiceFailed'); setSpeechState('idle'); return; }
    const code = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' }[lang];
    const voice = (synth.getVoices() || []).find((v) => v.lang && v.lang.startsWith(lang)) || null;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = code;
    if (voice) utterance.voice = voice;
    utterance.onend = () => { if (id === speechId.current) setSpeechState('idle'); };
    utterance.onerror = () => { if (id === speechId.current) { setSpeechState('idle'); setSpeechNote('voiceBlocked'); } };
    setSpeechNote(noteKey); setSpeechState('playing'); synth.speak(utterance);
  }, [lang]);
  // Legacy degradation for backends without /synthesize-stream: sequential
  // per-chunk non-streaming calls (the pre-streaming behaviour), using the
  // sentence-aware chunker so no advice is silently dropped past char 600.
  const speakLegacyChunks = useCallback(async (text, id) => {
    const chunks = splitSpeakChunks(text);
    for (const chunk of chunks) {
      if (id !== speechId.current) return;
      const r = await api.speak(chunk, lang);
      if (id !== speechId.current) return;
      if (!r?.audio_base64) throw new Error('provider unavailable');
      const audio = new Audio(`data:${r.mime || 'audio/wav'};base64,${r.audio_base64}`);
      audioRef.current = audio;
      setSpeechState('playing');
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onpause = resolve;
        audio.onerror = reject;
        audio.play().catch(reject);
      });
    }
  }, [lang]);
  // Progressive playback: chunk audios queue up as the stream yields them and
  // play in order; the first chunk starts the moment it arrives.
  const playStreamedTts = useCallback(async (text, id, signal) => {
    const pending = [];
    let finished = false, failed = null, wake = null;
    const notify = () => { const w = wake; wake = null; if (w) w(); };
    (async () => {
      try {
        for await (const line of api.speakStream(text, lang, { signal })) {
          if (id !== speechId.current) return;
          if (line?.done) {
            if (line.client_speech || line.provider === 'browser-fallback') {
              failed = new Error('provider unavailable');
            }
            break;
          }
          if (line?.audio_base64) {
            const audio = new Audio(`data:${line.mime || 'audio/wav'};base64,${line.audio_base64}`);
            pending.push(audio);
            notify();
          }
        }
      } catch (e) { failed = e; }
      finally { finished = true; notify(); }
    })();
    for (;;) {
      if (id !== speechId.current) return; // superseded — resolve quietly
      const audio = pending.shift();
      if (audio) {
        audioRef.current = audio;
        setSpeechState('playing');
        await new Promise((resolve) => {
          audio.onended = resolve;
          audio.onpause = resolve;
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
        continue;
      }
      if (failed) throw failed;
      if (finished) return;
      await new Promise((resolve) => { wake = resolve; });
    }
  }, [lang]);
  const speak = useCallback(async (text) => {
    if (!text) return;
    // Crew G sound toggle: user-muted sound suppresses all TTS.
    try { if (localStorage.getItem('wgpt.sound') === '0') return; } catch { /* ignore */ }
    stopSpeaking();
    const id = speechId.current;
    // Optimistic: the indicator renders on the next frame, within 100ms of the tap.
    setSpeechState('loading');
    setSpeechNote('');
    const status = await getVoiceStatus();
    if (id !== speechId.current) return;
    if (status?.tts === 'browser-fallback') {
      speakWithBrowser(text, id, 'voiceFallback');
      return;
    }
    const ctrl = new AbortController();
    ttsAbort.current = ctrl;
    try {
      await playStreamedTts(text, id, ctrl.signal);
      if (id === speechId.current) setSpeechState('idle');
    } catch (error) {
      if (id !== speechId.current) return;
      if (error?.name === 'NotAllowedError') {
        setSpeechNote('voiceBlocked'); setSpeechState('idle'); return;
      }
      try {
        // Older backend without the stream endpoint: legacy path, then browser.
        await speakLegacyChunks(text, id);
        if (id === speechId.current) setSpeechState('idle');
      } catch {
        if (id !== speechId.current) return;
        audioRef.current?.pause();
        speakWithBrowser(text, id, 'voiceFallback');
      }
    } finally {
      if (ttsAbort.current === ctrl) ttsAbort.current = null;
    }
  }, [stopSpeaking, speakWithBrowser, speakLegacyChunks, playStreamedTts]);

  useEffect(() => {
    writePref('wgpt.lang', lang);
    cacheGuidance(api, lang);
  }, [lang]);

  useEffect(() => {
    // null = unset: remove the key so "not set" survives a reload honestly.
    try {
      if (persona) localStorage.setItem('wgpt.persona', persona);
      else localStorage.removeItem('wgpt.persona');
    } catch { /* storage unavailable */ }
  }, [persona]);

  // One-shot question hand-off: HomeChat consumes it once on mount, then clears.
  const setPendingAsk = useCallback((text) => {
    pendingAskRef.current = typeof text === 'string' && text.trim() ? text.trim() : null;
  }, []);

  useEffect(() => {
    let dead = false;
    api.sources().then((s) => { if (!dead) setSources(s); }).catch(() => {});
    api.health().then((h) => { if (!dead) applyMode(h); }).catch(() => {});
    api.status()
      .then((s) => { if (!dead) setBackendState(s.state); })
      .catch(() => { if (!dead) setBackendState('?'); });
    // Disaster mode: a CONFIRMED ORANGE/RED collapses the console to
    // safety-first. The verdict is the authority here, not the IMD-only warning
    // block — a CAP-confirmed red alert must trigger it even when IMD is down.
    // And it clears again: a warning that expires or is withdrawn must not leave
    // the console stuck in disaster styling for the rest of the session.
    api.warnings(loc.district, loc.lat, loc.lon)
      .then((w) => {
        if (dead) return;
        const v = (w && w.verdict) || {};
        const severity = v.severity || (w && w.warning && w.warning.severity);
        const confirmed = v.confirmed !== undefined
          ? !!v.confirmed
          : !!(w && w.verified && w.verified.verified);
        setDisaster(confirmed && (severity === 'ORANGE' || severity === 'RED'));
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [loc.district, loc.lat, loc.lon, applyMode]);

  // /api/location/search returns latitude/longitude while the geolocation path
  // resolves to lat/lon. Accept both: a manual district pick must carry real
  // coordinates, otherwise every lat/lon fetch 422s and the verdict degrades.
  const setDistrict = useCallback((d) => {
    if (d && d.district) {
      const next = { district: d.district, lat: d.lat ?? d.latitude, lon: d.lon ?? d.longitude, source: 'manual' };
      setLoc(next);
      setLocStatus('ready');
      setLocNote('');
      writePref('wgpt.loc', JSON.stringify(next));
    }
  }, []);

  // Ask the browser for permission, then resolve district via backend GIS.
  // Actual GPS coords are kept for weather; only the district name is resolved.
  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocStatus('unsupported');
      setLocNote('Geolocation is not available in this browser.');
      return;
    }
    setLocStatus('requesting');
    setLocNote('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setLocStatus('resolving');
        try {
          const resolved = await api.resolveLocation(lat, lon);
          const next = {
            district: resolved.district || 'Hyderabad',
            lat, lon, source: 'gps',
            accuracyM: pos.coords.accuracy,
          };
          setLoc(next);
          setLocStatus('ready');
          writePref('wgpt.loc', JSON.stringify(next));
        } catch {
          setLocStatus('error');
          setLocNote('Could not resolve your district. Try again or enter it manually.');
        }
      },
      (err) => {
        if (err && err.code === 1) {
          setLocStatus('denied');
          setLocNote('Location permission was blocked. Enable it to get local warnings.');
        } else {
          setLocStatus('error');
          setLocNote('Could not get your position. Try again or enter it manually.');
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 },
    );
  }, []);

  // A grounded answer arrives: record it and light the real path it travelled.
  const handleResult = useCallback((r) => {
    setResult(r);
    const ev = r.evidence || [];
    setPipe({
      lit: ['SOURCES', 'VALIDATE', 'RISK', 'ANSWER'],
      detail: {
        SOURCES: ev.map((e) => `${e.source}/${e.provenance}`).join(' | ') || '-',
        VALIDATE: r.warning && r.warning.valid_until ? `valid to ${r.warning.valid_until}` : 'no active warning',
        RISK: `${(r.risk && r.risk.level) || '?'} (${(r.risk && r.risk.source) || 'WEATHERGPT'})`,
        ANSWER: `${(r.answer || '').length} chars, grounded`,
      },
    });
  }, []);

  // ---------------------------------------------------------------------
  // Push notifications: tell the user when a warning STARTS for their
  // district, when it is UPGRADED, and when it CLEARS.
  //
  // The verdict is published by whichever view fetched it (Home hero, Alerts),
  // so this costs no extra request and works on every screen. Notifications are
  // for CHANGES only — a user opening the app must not be buzzed about a warning
  // that is already on screen, so the first verdict is recorded and stays quiet.
  // ---------------------------------------------------------------------

  const [notifyOn, setNotifyOn] = useState(() => readPref('wgpt.notify', '0') === '1');
  const [notifyPerm, setNotifyPerm] = useState(() => notifySupport());
  // Honest push state, three ways — never a bare on/off that cannot say WHY:
  //   'off'        — alerts are not enabled.
  //   'background' — this device holds a push subscription: the server can
  //                  reach it with the app closed. The only true "alerts on".
  //   'inapp'      — alerts fire while the app is open, but background push
  //                  failed; pushReason names the reason (shown, not swallowed).
  // pushReady is derived inline in the context value (pushMode === 'background');
  // other views keep reading it as before.
  const [pushMode, setPushMode] = useState('off');
  const [pushReason, setPushReason] = useState(null);
  const prevVerdict = useRef(null);

  const fireNotification = useCallback((change, district) => {
    const fill = (key, extra = {}) => t(lang, key)
      .replace('{district}', district || '')
      .replace('{severity}', extra.severity || '')
      .replace('{hazard}', extra.hazard || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (change.kind === 'clear') {
      notify({
        title: fill('notifyClearTitle'),
        // Name the hazard only when we know it; a bare "the warning has ended"
        // is better than "the undefined warning has ended".
        body: change.hazard
          ? fill('notifyClearBody', { hazard: change.hazard })
          : fill('notifyClearBodyPlain'),
        tag: tagFor(change),
        severity: 'GREEN',
        // Tapping the OS notification opens the app on the alert.
        url: '/?view=alerts',
      });
      return;
    }

    const upgraded = change.kind === 'escalate';
    notify({
      title: fill(upgraded ? 'notifyEscalateTitle' : 'notifyStartTitle'),
      body: fill(upgraded ? 'notifyEscalateBody' : 'notifyStartBody', {
        severity: change.severity || change.level,
        hazard: change.hazard || '',
      }),
      tag: tagFor(change),
      severity: change.severity || change.level,
      silent: !upgraded && change.level === 'MODERATE',
      url: '/?view=alerts',
    });
  }, [lang]);

  const publishVerdict = useCallback((verdict, district) => {
    if (!verdict) return;
    const change = transition(prevVerdict.current, verdict, district);
    prevVerdict.current = verdict;
    if (change && notifyOn && notifySupport() === 'granted') fireNotification(change, district);
  }, [notifyOn, fireNotification]);

  // The enable half of the flow, retry-safe: enabling when alerts are already
  // on retries the background-push registration instead of toggling off. The
  // onboarding tour's notifications step calls this directly.
  const enableNotify = useCallback(async () => {
    const perm = await askNotifyPermission();
    setNotifyPerm(perm);
    if (perm !== 'granted') {
      showToast(t(lang, perm === 'unsupported' ? 'notifyUnsupported' : 'notifyBlocked'));
      return false;
    }

    // Permission alone only buys in-app notifications. Registering with the push
    // service is what reaches the device when the app is CLOSED — which is the
    // entire point — so it is part of turning this on, not a separate step.
    // A failure here no longer hangs (notify.js bounds every wait) and no
    // longer lies: the mode records background vs in-app-only, with the reason.
    const res = await subscribeToPush({ api, district: loc.district, language: lang, persona: persona || 'general' });
    setNotifyOn(true);
    writePref('wgpt.notify', '1');
    if (res.ok) {
      setPushMode('background');
      setPushReason(null);
      showToast(t(lang, 'notifyOnBackground'));
    } else {
      // Honest: in-app notifications still work, background ones do not, and
      // the toast names the reason instead of swallowing it.
      setPushMode('inapp');
      setPushReason(res.reason);
      showToast(t(lang, 'notifyInAppOnly').replace('{reason}', t(lang, pushReasonKey(res.reason))));
    }
    return true;
  }, [lang, loc.district, persona, showToast]);

  const toggleNotify = useCallback(async () => {
    if (notifyOn) {
      setNotifyOn(false);
      writePref('wgpt.notify', '0');
      setPushMode('off');
      setPushReason(null);
      await unsubscribeFromPush(api);
      showToast(t(lang, 'notifyOff'));
      return false;
    }
    return enableNotify();
  }, [notifyOn, lang, showToast, enableNotify]);

  // On load, believe the device rather than the stored preference: a
  // subscription can be revoked from browser settings, and claiming "alerts on"
  // when the device cannot be reached is the one lie this feature must not tell.
  // A stored "on" with no subscription reads as in-app-only, honestly.
  useEffect(() => {
    let alive = true;
    hasPushSubscription().then((has) => {
      if (!alive) return;
      if (has) setPushMode('background');
      else if (readPref('wgpt.notify', '0') === '1') setPushMode('inapp');
      else setPushMode('off');
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Demo triggers. They feed the SAME path a real verdict takes, so what you see
  // in the demo is the shipping behaviour, not a special case.
  const simulateAlert = useCallback(async () => {
    const perm = notifySupport() === 'granted' ? 'granted' : await askNotifyPermission();
    setNotifyPerm(perm);
    const v = { level: 'HIGH', basis: 'cap_alert', confirmed: true, severity: 'ORANGE', hazard: 'Heavy rain' };
    const change = transition(prevVerdict.current, v, loc.district) || { kind: 'start', ...v, district: loc.district };
    prevVerdict.current = v;
    if (perm === 'granted') {
      forgetNotified(); // demo: allow replaying the same event
      fireNotification(change, loc.district);
    } else {
      showToast(t(lang, perm === 'unsupported' ? 'notifyUnsupported' : 'notifyBlocked'));
    }
  }, [lang, loc.district, fireNotification, showToast]);

  const simulateClear = useCallback(async () => {
    const v = { level: 'LOW', basis: 'none', confirmed: true, severity: 'GREEN', hazard: null };
    const change = transition(prevVerdict.current, v, loc.district) || { kind: 'clear', district: loc.district };
    prevVerdict.current = v;
    forgetNotified();
    fireNotification(change, loc.district);
  }, [loc.district, fireNotification]);

  // The offline toggle must actually CUT the network path, not just relabel the
  // screen. api.js exposes setOfflineSim for exactly this, and without this call
  // the app kept talking to the backend: the "offline" banner sat above live
  // data, which is a worse lie than having no offline demo at all.
  useEffect(() => {
    setOfflineSim(simOffline);
  }, [simOffline]);

  // Proves the closed-app path: the SERVER sends this one, not the page.
  // When an alert is selected the test push deep-links to it, so the demo
  // proves the tap → alert-detail path, not just delivery.
  const sendTestPush = useCallback(async () => {
    try {
      const body = { district: loc.district };
      if (selectedAlert && selectedAlert.id) body.alert_id = selectedAlert.id;
      const r = await api.pushTest(body);
      if (r && r.status === 'sent') {
        showToast(r.delivered ? `${t(lang, 'notifyTestSent')} (${r.delivered})` : t(lang, 'notifyTestNone'));
      } else {
        showToast(t(lang, 'notifyPushFailed'));
      }
    } catch {
      showToast(t(lang, 'notifyPushFailed'));
    }
  }, [loc.district, lang, showToast, selectedAlert]);

  const offline = simOffline || !online;
  const conn = offline ? 'OFFLINE' : backendState;
  // Round2 S3.1.3: connection pill — the one-word story the jury reads:
  // Online (live) / Cached (reconnecting, stale-labelled data) / Offline.
  const connectionPill = offline || netState === 'offline' ? 'Offline'
    : netState === 'reconnecting' ? 'Cached' : 'Online';
  const value = useMemo(() => ({
    view, setView,
    lang, setLang,
    persona, setPersona,
    demoMode, sourceMode, modeInfo, setBackendMode, backendState, sources, setSources,
    conn, connectionPill, offline, online, simOffline, setSimOffline,
    pipe, setPipe, result, handleResult,
    selectedAlert, setSelectedAlert,
    disaster, setDisaster,
    ask, registerAsk, speak, stopSpeaking, speechState, speechNote,
    listenState, setListenState,
    pendingAskRef, setPendingAsk,
    loc, setDistrict, districts, locStatus, locNote, requestLocation,
    locReady: locStatus === 'ready',
    device,
    netState, lastSync, syncTick, toast, showToast,
    publishVerdict,
    notifyOn, notifyPerm, pushReady: pushMode === 'background', pushMode, pushReason, toggleNotify, enableNotify, simulateAlert, simulateClear, sendTestPush,
  }), [view, lang, persona, demoMode, sourceMode, modeInfo, setBackendMode, backendState, sources, conn, connectionPill, offline, online,
    simOffline, pipe, result, handleResult, selectedAlert,
    disaster, ask, registerAsk, speak, stopSpeaking, speechState, speechNote, listenState, setListenState, setPendingAsk,
    loc, setDistrict, districts, locStatus, locNote, requestLocation,
    netState, lastSync, syncTick, toast, showToast,
    publishVerdict, notifyOn, notifyPerm, pushMode, pushReason, toggleNotify, enableNotify, simulateAlert, simulateClear, sendTestPush, device]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}