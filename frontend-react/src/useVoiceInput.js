import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import { useOnline } from './offline';
import { getVoiceStatus } from './store';
import { encodeMicFrame, shouldUseBrowserStt } from './voiceUi';

// Recording is shared by Home and Ask; never silently re-record after a failure.
// onPartial (optional): called with interim (non-final) transcripts as the
// user speaks, so the UI can surface streaming partials live in the input.
// The server streaming path (/api/voice/transcribe-stream) delivers real
// interim transcripts in < 1 s; the batch record+upload path still returns
// final transcripts only.
//
// Machine-readable errors (Crew B): `errorCode` is '' | 'denied' |
// 'unavailable' | 'failed', and `denied` is errorCode === 'denied'. Prefer
// these over string-matching the localized `note` (e.g. homeNoMic) — the
// note stays for display, the code is the contract.
export function useVoiceInput(lang, onText, onPartial) {
  const [state, setState] = useState('idle');
  const [heard, setHeard] = useState('');
  const [partial, setPartial] = useState('');
  const [note, setNote] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const session = useRef(0);
  const recorder = useRef(null);
  const tracks = useRef(null);
  const timer = useRef(null);
  const streamCtl = useRef(null);
  // Elapsed recording seconds — a mic with no timer reads as dead.
  const [elapsed, setElapsed] = useState(0);
  const tick = useRef(null);
  // Offline voice chain (§7): recorder needs the backend, browser speech
  // recognition does not. Mic is impossible only when both are gone.
  const online = useOnline();
  const srOK = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const unavailable = !online && !srOK;
  useEffect(() => () => {
    session.current++;
    clearTimeout(timer.current);
    clearInterval(tick.current);
    try { streamCtl.current?.abort(); } catch { /* idle */ }
    streamCtl.current = null;
    const rec = recorder.current;
    if (rec) { rec.onstop = null; rec.onresult = null; rec.onend = null; try { rec.stop(); } catch { /* idle */ } }
    tracks.current?.getTracks().forEach((track) => track.stop());
  }, [lang]);

  function stop() {
    clearTimeout(timer.current);
    clearInterval(tick.current);
    const sc = streamCtl.current;
    if (sc) { sc.finish(); return; } // flush -> final arrives via onmessage
    try { recorder.current?.stop(); } catch { /* already stopped */ }
  }

  function startClock() {
    clearInterval(tick.current);
    setElapsed(0);
    const t0 = Date.now();
    tick.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
  }

  function wsBase() {
    const base = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
    if (!base) return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
    return base.replace(/^http/, 'ws');
  }

  // Streaming STT: mic audio ships as 16 kHz PCM frames over a WebSocket to
  // /api/voice/transcribe-stream and interim transcripts arrive live (< 1 s to
  // first interim). Resolves { started } — started=false means streaming never
  // got going and the caller should fall back to batch record+upload, unless
  // denied/fatal which are already surfaced with a note + errorCode.
  function streamListen(active) {
    return new Promise((resolve) => {
      let settled = false;
      let ws = null, audioCtx = null, processor = null, source = null, micStream = null;
      let opened = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer.current);
        clearInterval(tick.current);
        try { processor?.disconnect(); } catch { /* idle */ }
        try { source?.disconnect(); } catch { /* idle */ }
        try { audioCtx?.close(); } catch { /* idle */ }
        try { micStream?.getTracks().forEach((tr) => tr.stop()); } catch { /* idle */ }
        try { ws?.close(); } catch { /* idle */ }
        streamCtl.current = null;
        resolve(result);
      };
      (async () => {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
          const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
          resolve({ started: false, denied: !!denied });
          return;
        }
        if (!active()) { micStream.getTracks().forEach((tr) => tr.stop()); resolve({ started: false }); return; }
        tracks.current = micStream;
        try {
          ws = new WebSocket(`${wsBase()}/api/voice/transcribe-stream?language=${encodeURIComponent(lang)}`);
        } catch {
          micStream.getTracks().forEach((tr) => tr.stop());
          resolve({ started: false });
          return;
        }
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          audioCtx = new AC();
          source = audioCtx.createMediaStreamSource(micStream);
          processor = audioCtx.createScriptProcessor(4096, 1, 1);
          const deviceRate = audioCtx.sampleRate;
          const FRAME = Math.max(1024, Math.floor(deviceRate * 0.25)); // ~250 ms frames
          let pending = new Float32Array(0);
          processor.onaudioprocess = (ev) => {
            if (!active() || !ws || ws.readyState !== 1) return;
            const ch = ev.inputBuffer.getChannelData(0);
            const next = new Float32Array(pending.length + ch.length);
            next.set(pending); next.set(ch, pending.length); pending = next;
            while (pending.length >= FRAME) {
              const frame = pending.slice(0, FRAME);
              pending = pending.slice(FRAME);
              try { ws.send(JSON.stringify({ audio: encodeMicFrame(frame, deviceRate) })); } catch { /* drop */ }
            }
          };
          source.connect(processor);
          processor.connect(audioCtx.destination);
        } catch {
          done({ started: false });
          return;
        }
        // stop()/unmount finishes the turn: flush, then the final commit
        // arrives via onmessage. Safety timer so a dead server can't wedge
        // the UI in 'recording' forever.
        const finishTimer = { id: null };
        streamCtl.current = {
          finish() {
            try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ flush: true })); } catch { /* closing */ }
            finishTimer.id = setTimeout(() => {
              if (active()) { setNote(t(lang, 'voiceFailed')); setErrorCode('failed'); setState('idle'); }
              done({ started: true, fatal: true });
            }, 10000);
          },
          abort() { clearTimeout(finishTimer.id); done({ started: false }); },
        };
        const clearFinishTimer = () => clearTimeout(finishTimer.id);
        ws.onopen = () => {
          opened = true;
          if (!active()) { done({ started: false }); return; }
          setState('recording');
          startClock();
          timer.current = setTimeout(stop, 60000);
        };
        ws.onmessage = (ev) => {
          if (!active()) return;
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }
          if (typeof msg.partial === 'string') {
            setPartial(msg.partial);
            if (onPartial) onPartial(msg.partial);
          } else if (msg.final !== undefined) {
            clearFinishTimer();
            setPartial('');
            if (String(msg.final).trim()) { setHeard(msg.final); onText(msg.final); }
            else setNote(t(lang, 'homeNoHear'));
            setState('idle');
            done({ started: true });
          } else if (msg.error) {
            clearFinishTimer();
            setNote(t(lang, msg.error === 'browser-fallback' ? 'voiceFallback' : 'voiceFailed'));
            setErrorCode('failed');
            setState('idle');
            done({ started: true, fatal: true });
          }
        };
        ws.onerror = () => {
          // Never got going -> batch fallback may still work. Died mid-stream
          // -> say so loudly instead of silently re-recording.
          if (!opened) { done({ started: false }); return; }
          clearFinishTimer();
          if (active()) { setNote(t(lang, 'voiceFailed')); setErrorCode('failed'); setState('idle'); }
          done({ started: true, fatal: true });
        };
        ws.onclose = () => {
          if (!settled && opened) {
            clearFinishTimer();
            if (active()) { setNote(t(lang, 'voiceFailed')); setErrorCode('failed'); setState('idle'); }
          }
          done({ started: opened });
        };
      })();
    });
  }

  // Batch record+upload: the pre-streaming path, kept as the fallback when the
  // relay is unavailable or fails before starting.
  function batchListen(active) {
    if (!window.MediaRecorder) { browserListen(active, !online); return; }
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active()) { stream.getTracks().forEach((track) => track.stop()); return; }
        tracks.current = stream;
        const rec = new MediaRecorder(stream);
        recorder.current = rec;
        const chunks = [];
        rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        rec.onstop = async () => {
          stream.getTracks().forEach((track) => track.stop());
          clearTimeout(timer.current);
          clearInterval(tick.current);
          if (!active()) return;
          setState('processing');
          try {
            const result = await api.transcribe(new Blob(chunks, { type: rec.mimeType || chunks[0]?.type || 'audio/webm' }), lang);
            if (!active()) return;
            // Server transcribe returns final transcripts only today; clear any
            // partial shown while recording and commit the final text.
            setPartial('');
            if (result.text?.trim()) { setHeard(result.text); onText(result.text); }
            else if (result.using_browser_speech) {
              // Server has no STT provider configured — hand the already-captured
              // intent to on-device browser recognition rather than dead-ending.
              browserListen(active, false);
            }
            else setNote(t(lang, result.using_browser_speech ? 'voiceFailed' : 'homeNoHear'));
          } catch { if (active()) { setNote(t(lang, 'voiceFailed')); setErrorCode('failed'); } }
          finally { if (active()) setState('idle'); }
        };
        rec.start(); setState('recording'); startClock();
        timer.current = setTimeout(stop, 60000);
      } catch (e) {
        tracks.current?.getTracks().forEach((track) => track.stop());
        if (active()) {
          setState('idle');
          setNote(t(lang, 'homeNoMic'));
          setErrorCode(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable');
        }
      }
    })();
  }

  // On-device browser speech recognition: used offline, when the browser has no
  // MediaRecorder, and when the server reports no STT provider (browser
  // fallback). Kept as a shared helper so the server-fallback path gets the
  // same honest 'voiceFallback' note as the offline path.
  function browserListen(active, offline) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setState('idle'); setNote(t(lang, offline ? 'voiceOffline' : 'homeNoMic')); setErrorCode('unavailable'); return; }
    const rec = new SR();
    recorder.current = rec;
    rec.lang = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' }[lang];
    // interimResults: partial transcripts surface live while the user is
    // still speaking; only final results are committed via onText.
    rec.interimResults = true;
    rec.onresult = (event) => {
      if (!active()) return;
      let finalText = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim.trim()) { setPartial(interim); if (onPartial) onPartial(interim); }
      if (finalText.trim()) { setHeard(finalText); setPartial(''); onText(finalText); }
    };
    rec.onerror = () => { clearInterval(tick.current); if (active()) { setNote(t(lang, 'voiceFailed')); setErrorCode('failed'); } };
    rec.onend = () => { clearInterval(tick.current); if (active()) setState('idle'); };
    try { rec.start(); setState('recording'); startClock(); setNote(t(lang, 'voiceFallback')); }
    catch { clearInterval(tick.current); setState('idle'); setNote(t(lang, 'homeNoMic')); setErrorCode('unavailable'); }
  }

  async function listen() {
    if (state === 'recording') { stop(); return; }
    if (state === 'processing' || state === 'permission') return;
    const id = ++session.current;
    const active = () => id === session.current;
    setNote('');
    setPartial('');
    setErrorCode('');
    setState('permission');
    if (unavailable) { setState('idle'); setNote(t(lang, 'voiceOffline')); setErrorCode('unavailable'); return; }
    // Latency fast-path: when the server reports no STT provider
    // (browser-fallback), recording with MediaRecorder and uploading the audio
    // first is pure waste — the server would just answer "use the browser
    // instead" and the user would have to speak a second time. The cached
    // voice status makes this check ~free after app launch. The server-STT
    // path below is kept for when a real provider is configured.
    const status = await getVoiceStatus();
    if (!active()) return;
    if (shouldUseBrowserStt(status)) { browserListen(active, !online); return; }
    if (!online || !navigator.mediaDevices?.getUserMedia) {
      browserListen(active, !online);
      return;
    }
    // Streaming STT: interim transcripts in < 1 s via the relay. Falls back
    // to batch record+upload when streaming can't start (no WebSocket, relay
    // down); a denied mic is surfaced immediately with errorCode 'denied'
    // rather than retried by the batch path. Streaming needs only what
    // stt == 'sarvam-live' already guarantees (a configured server key).
    if (status?.stt === 'sarvam-live' && window.WebSocket && (window.AudioContext || window.webkitAudioContext)) {
      const r = await streamListen(active);
      if (!active()) return;
      if (r.started) return; // streamed, or failed loudly with note+code set
      if (r.denied) { setState('idle'); setNote(t(lang, 'homeNoMic')); setErrorCode('denied'); return; }
    }
    batchListen(active);
  }
  return { listen, state, heard, partial, note, listening: state === 'recording', busy: state === 'processing' || state === 'permission', unavailable, elapsed, errorCode, denied: errorCode === 'denied' };
}
