// Single application store. Views read from here instead of prop-drilling, and
// `ask()` is registered by ChatPanel from inside an EFFECT (never during render).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, HYD } from './api';
import { DISTRICTS } from './i18n';
import { cacheGuidance, useOnline } from './offline';

const AppCtx = createContext(null);

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

export function AppProvider({ children }) {
  const [view, setView] = useState('home');
  const [lang, setLang] = useState(() => readPref('wgpt.lang', 'en'));
  const [persona, setPersona] = useState(() => readPref('wgpt.persona', 'fisherman'));
  const pendingAskRef = useRef(null); // Home → Ask one-shot hand-off (ref: no effect setState)
  const [theme, setTheme] = useState(() => readPref('wgpt.theme', 'auto'));
  const [demoMode, setDemoMode] = useState(true);
  const [districts] = useState(DISTRICTS); // district picker options (coastal + inland)
  const [loc, setLoc] = useState(HYD); // { district, lat, lon } - every question/answer is "here"
  const [backendState, setBackendState] = useState('…');
  const [sources, setSources] = useState(null);
  const [pipe, setPipe] = useState({ lit: [], detail: {} });
  const [result, setResult] = useState(null);        // last chat turn → Evidence view
  const [disaster, setDisaster] = useState(false);
  const [simOffline, setSimOffline] = useState(false);
  const online = useOnline();
  const askRef = useRef(null);

  // ChatPanel publishes its submit handler here from an effect — safe, no render-time ref write.
  const registerAsk = useCallback((fn) => { askRef.current = fn; }, []);
  const ask = useCallback((text) => { if (askRef.current) askRef.current(text); }, []);

  // Speak an answer aloud: server TTS (Sarvam, in the selected language) first,
  // browser speechSynthesis as fallback. Singleton audio - a new answer stops the old one.
  const audioRef = useRef(null);
  const speechId = useRef(0);
  const [speechState, setSpeechState] = useState('idle');
  const [speechNote, setSpeechNote] = useState('');
  const cancelAudio = useCallback(() => {
    speechId.current++;
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
    return cancelAudio;
  }, [lang, persona, loc.district, cancelAudio]);
  const speak = useCallback(async (text) => {
    if (!text) return;
    stopSpeaking();
    const id = speechId.current;
    setSpeechState('loading');
    setSpeechNote('');
    // Split complete sentences/chunks instead of silently dropping safety advice
    // after character 600. Replay and automatic speech share this single player.
    const chunks = text.match(/[\s\S]{1,450}(?:\s|$)|[\s\S]{1,450}/g) || [text];
    try {
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
      if (id === speechId.current) setSpeechState('idle');
    } catch (error) {
      if (id !== speechId.current) return;
      audioRef.current?.pause();
      if (error?.name === 'NotAllowedError') {
        setSpeechNote('voiceBlocked'); setSpeechState('idle'); return;
      }
      const synth = window.speechSynthesis;
      const code = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' }[lang];
      const voice = synth?.getVoices().find((v) => v.lang.startsWith(lang));
      if (!synth || !voice) {
        setSpeechNote('voiceFailed'); setSpeechState('idle'); return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = code; utterance.voice = voice;
      utterance.onend = () => { if (id === speechId.current) setSpeechState('idle'); };
      utterance.onerror = () => { if (id === speechId.current) { setSpeechState('idle'); setSpeechNote('voiceBlocked'); } };
      setSpeechNote('voiceFallback'); setSpeechState('playing'); synth.speak(utterance);
    }
  }, [lang, stopSpeaking]);

  useEffect(() => {
    writePref('wgpt.theme', theme);
    const el = document.documentElement;
    if (theme === 'auto') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    writePref('wgpt.lang', lang);
    cacheGuidance(api, lang);
  }, [lang]);

  useEffect(() => {
    writePref('wgpt.persona', persona);
  }, [persona]);

  // One-shot question hand-off: ChatPanel consumes it once on mount, then clears.
  const setPendingAsk = useCallback((text) => {
    pendingAskRef.current = typeof text === 'string' && text.trim() ? text.trim() : null;
  }, []);

  useEffect(() => {
    let dead = false;
    api.sources().then((s) => { if (!dead) setSources(s); }).catch(() => {});
    api.health().then((h) => { if (!dead) setDemoMode(!!h.demo_mode); }).catch(() => {});
    api.status()
      .then((s) => { if (!dead) setBackendState(s.state); })
      .catch(() => { if (!dead) setBackendState('?'); });
    // Disaster mode: verified ORANGE/RED collapses the console to safety-first.
    api.warnings(loc.district, loc.lat, loc.lon)
      .then((w) => {
        const v = w && (w.verified || (w.warning && w.warning.verified));
        if (!dead && v && v.verified && (v.severity === 'ORANGE' || v.severity === 'RED')) setDisaster(true);
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [loc.district, loc.lat, loc.lon]);

  const setDistrict = useCallback((d) => {
    if (d && d.district) setLoc({ district: d.district, lat: d.lat, lon: d.lon });
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

  const offline = simOffline || !online;
  const conn = offline ? 'OFFLINE' : backendState;

  const value = useMemo(() => ({
    view, setView,
    lang, setLang,
    persona, setPersona,
    theme, setTheme,
    demoMode, backendState, sources, setSources,
    conn, offline, online, simOffline, setSimOffline,
    pipe, setPipe, result, handleResult,
    disaster, setDisaster,
    ask, registerAsk, speak, stopSpeaking, speechState, speechNote,
    pendingAskRef, setPendingAsk,
    loc, setDistrict, districts,
  }), [view, lang, persona, theme, demoMode, backendState, sources, conn, offline, online,
    simOffline, pipe, result, handleResult, disaster, ask, registerAsk, speak, stopSpeaking, speechState, speechNote, setPendingAsk,
    loc, setDistrict, districts]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}