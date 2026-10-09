// Voice out (read aloud) and voice in (mic -> text).
//
// Read aloud: Sarvam TTS through the backend (good Telugu/Hindi voices). Every
// clip is kept in Cache Storage, so anything heard once can be heard again
// with no network. Last resort is the browser's own voice.
// Mic: Sarvam STT through the backend; the browser's recognizer when the
// backend has no STT or the phone is offline.
import { useEffect, useRef, useState } from 'react';
import { api } from './api';

const LOCALE = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };
const TTS_CACHE = 'wgpt-tts-v1';

// Units said in the listener's language: a Telugu sentence with "degrees"
// and "millimetre" in English was hard to follow for the people it is for.
const UNITS = {
  en: { deg: ' degrees', mm: ' millimetres', kmh: ' kilometres per hour' },
  hi: { deg: ' डिग्री', mm: ' मिलीमीटर', kmh: ' किलोमीटर प्रति घंटा' },
  te: { deg: ' డిగ్రీలు', mm: ' మిల్లీమీటర్లు', kmh: ' కిలోమీటర్లు గంటకు' },
};

// Markdown and symbols read badly aloud.
export function speakable(text, lang = 'en') {
  const u = UNITS[lang] || UNITS.en;
  return String(text || '')
    .replace(/[*_#`>|]/g, ' ')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s*°\s*C\b/g, u.deg)
    .replace(/°/g, u.deg)
    .replace(/(\d)\s*(?:mm|मिमी|మిమీ)(?![\p{L}])/gu, `$1${u.mm}`)
    .replace(/(\d)\s*(?:km\/h|किमी\/घंटा|కిమీ\/గం)/g, `$1${u.kmh}`)
    .replace(/\s{2,}/g, ' ')
    .replace(/(\.\s*){2,}/g, '. ')
    .trim();
}

// Short first chunk so sound starts fast; then sentence-sized chunks.
export function chunks(text, first = 120, rest = 300, lang = 'en') {
  const sentences = speakable(text, lang).split(/(?<=[.!?।])\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const s of sentences) {
    const limit = out.length === 0 ? first : rest;
    if (cur && (cur + ' ' + s).length > limit) { out.push(cur); cur = s; } else { cur = cur ? `${cur} ${s}` : s; }
  }
  if (cur) out.push(cur);
  return out;
}

// ---- speaking state, shared across the app --------------------------------
let speakingId = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(speakingId));
export function useSpeaking() {
  const [id, setId] = useState(speakingId);
  useEffect(() => { listeners.add(setId); return () => listeners.delete(setId); }, []);
  return id;
}

let run = 0;
let audioEl = null;

export function stopSpeaking() {
  run++;
  try { audioEl?.pause(); } catch { /* idle */ }
  try { window.speechSynthesis?.cancel(); } catch { /* idle */ }
  speakingId = null;
  emit();
}

async function clipFromCache(key) {
  try {
    const c = await caches.open(TTS_CACHE);
    const hit = await c.match(key);
    return hit ? await hit.blob() : null;
  } catch { return null; }
}

async function clipToCache(key, blob) {
  try {
    const c = await caches.open(TTS_CACHE);
    await c.put(key, new Response(blob, { headers: { 'Content-Type': blob.type } }));
  } catch { /* Cache Storage unavailable (http, private mode) */ }
}

function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'audio/wav' });
}

async function getClip(text, lang) {
  const key = `/tts/${lang}/${encodeURIComponent(text).slice(0, 1500)}`;
  const cached = await clipFromCache(key);
  if (cached) return cached;
  if (!navigator.onLine) return null;
  try {
    const r = await api.synthesize(text, lang);
    if (!r.audio_base64) return null;
    const blob = b64ToBlob(r.audio_base64, r.mime);
    clipToCache(key, blob);
    return blob;
  } catch { return null; }
}

function playBlob(blob, myRun) {
  return new Promise((resolve) => {
    if (myRun !== run) return resolve();
    const url = URL.createObjectURL(blob);
    audioEl = audioEl || new Audio();
    audioEl.src = url;
    const done = () => { URL.revokeObjectURL(url); resolve(); };
    audioEl.onended = done;
    audioEl.onerror = done;
    audioEl.play().catch(done);
  });
}

function browserSpeak(text, lang, myRun) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth || myRun !== run) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOCALE[lang] || 'en-IN';
    const voice = synth.getVoices().find((v) => v.lang === u.lang);
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onend = resolve;
    u.onerror = resolve;
    synth.speak(u);
  });
}

// Speak `text`. `id` names what is speaking so its button can show "stop".
// Tapping the same id again stops it.
export async function speak(text, lang, id = 'default') {
  if (speakingId === id) { stopSpeaking(); return; }
  stopSpeaking();
  const myRun = ++run;
  speakingId = id;
  emit();
  const parts = chunks(text, 120, 300, lang);
  // Fetch the next clip while the current one plays.
  let next = parts.length ? getClip(parts[0], lang) : null;
  for (let i = 0; i < parts.length && myRun === run; i++) {
    const blob = await next;
    next = i + 1 < parts.length ? getClip(parts[i + 1], lang) : null;
    if (myRun !== run) break;
    if (blob) await playBlob(blob, myRun);
    else await browserSpeak(parts[i], lang, myRun);
  }
  if (myRun === run) { speakingId = null; emit(); }
}

// Pre-fetch audio for text the user is likely to hear (the safety summary),
// so it plays instantly and is available offline later.
export function warmSpeech(text, lang) {
  if (!navigator.onLine || !text) return;
  chunks(text, 120, 300, lang).slice(0, 2).forEach((c) => { getClip(c, lang); });
}

// ---- mic -----------------------------------------------------------------
let sttStatus = null;
async function serverStt() {
  if (!navigator.onLine) return false;
  if (!sttStatus) {
    sttStatus = api.voiceStatus().then((s) => s.stt !== 'browser-fallback').catch(() => false);
  }
  return sttStatus;
}

const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

// state: idle | listening | working | error ; error: '' | denied | nomic | failed
export function useMic(lang, onText) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const stopRef = useRef(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; });

  useEffect(() => () => stopRef.current?.(true), []);

  async function start() {
    if (state === 'listening') { stopRef.current?.(); return; }
    if (state === 'working') return;
    setError('');
    stopSpeaking();
    const useServer = await serverStt();
    if (useServer && navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
      return recordAndUpload();
    }
    if (Recognition) return browserRecognize();
    setError('nomic');
    setState('error');
  }

  async function recordAndUpload() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setError(e && e.name === 'NotAllowedError' ? 'denied' : 'nomic');
      setState('error');
      return;
    }
    const rec = new MediaRecorder(stream);
    const parts = [];
    let cancelled = false;
    const t0 = Date.now();
    const tick = setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 250);
    const auto = setTimeout(() => stopRef.current?.(), 15000);
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.onstop = async () => {
      clearInterval(tick); clearTimeout(auto);
      stream.getTracks().forEach((t) => t.stop());
      stopRef.current = null;
      if (cancelled) { setState('idle'); return; }
      setState('working');
      try {
        const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' });
        const r = await api.transcribe(blob, lang);
        const text = (r.text || '').trim();
        if (text) { setState('idle'); onTextRef.current(text); } else { setError('failed'); setState('error'); }
      } catch {
        setError('failed'); setState('error');
      }
    };
    stopRef.current = (cancel = false) => { cancelled = cancel; try { rec.stop(); } catch { /* stopped */ } };
    setSeconds(0);
    setState('listening');
    rec.start();
  }

  function browserRecognize() {
    const r = new Recognition();
    r.lang = LOCALE[lang] || 'en-IN';
    r.interimResults = false;
    r.maxAlternatives = 1;
    let got = false;
    r.onresult = (e) => {
      got = true;
      const text = e.results?.[0]?.[0]?.transcript || '';
      setState('idle');
      if (text.trim()) onTextRef.current(text.trim());
    };
    r.onerror = (e) => {
      setError(e.error === 'not-allowed' ? 'denied' : 'failed');
      setState('error');
    };
    r.onend = () => { stopRef.current = null; if (!got) setState((s) => (s === 'listening' ? 'idle' : s)); };
    stopRef.current = () => { try { r.stop(); } catch { /* stopped */ } };
    setSeconds(0);
    setState('listening');
    r.start();
  }

  return { state, error, seconds, start, reset: () => { setError(''); setState('idle'); } };
}
