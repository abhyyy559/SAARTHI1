import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import { useOnline } from './offline';

// Recording is shared by Home and Ask; never silently re-record after a failure.
// onPartial (optional): called with interim (non-final) transcripts as the
// user speaks, so the UI can surface streaming partials live in the input.
// The server transcribe path currently returns final transcripts only —
// onPartial is wired for when the backend gains partial support.
export function useVoiceInput(lang, onText, onPartial) {
  const [state, setState] = useState('idle');
  const [heard, setHeard] = useState('');
  const [partial, setPartial] = useState('');
  const [note, setNote] = useState('');
  const session = useRef(0);
  const recorder = useRef(null);
  const tracks = useRef(null);
  const timer = useRef(null);
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
    const rec = recorder.current;
    if (rec) { rec.onstop = null; rec.onresult = null; rec.onend = null; try { rec.stop(); } catch { /* idle */ } }
    tracks.current?.getTracks().forEach((track) => track.stop());
  }, [lang]);

  function stop() {
    clearTimeout(timer.current);
    clearInterval(tick.current);
    try { recorder.current?.stop(); } catch { /* already stopped */ }
  }

  function startClock() {
    clearInterval(tick.current);
    setElapsed(0);
    const t0 = Date.now();
    tick.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
  }

  // On-device browser speech recognition: used offline, when the browser has no
  // MediaRecorder, and when the server reports no STT provider (browser
  // fallback). Kept as a shared helper so the server-fallback path gets the
  // same honest 'voiceFallback' note as the offline path.
  function browserListen(active, offline) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setState('idle'); setNote(t(lang, offline ? 'voiceOffline' : 'homeNoMic')); return; }
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
    rec.onerror = () => { clearInterval(tick.current); if (active()) setNote(t(lang, 'voiceFailed')); };
    rec.onend = () => { clearInterval(tick.current); if (active()) setState('idle'); };
    try { rec.start(); setState('recording'); startClock(); setNote(t(lang, 'voiceFallback')); }
    catch { clearInterval(tick.current); setState('idle'); setNote(t(lang, 'homeNoMic')); }
  }

  async function listen() {
    if (state === 'recording') { stop(); return; }
    if (state === 'processing' || state === 'permission') return;
    const id = ++session.current;
    const active = () => id === session.current;
    setNote('');
    setPartial('');
    setState('permission');
    if (unavailable) { setState('idle'); setNote(t(lang, 'voiceOffline')); return; }
    if (!online || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      browserListen(active, !online);
      return;
    }
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
        } catch { if (active()) setNote(t(lang, 'voiceFailed')); }
        finally { if (active()) setState('idle'); }
      };
      rec.start(); setState('recording'); startClock();
      timer.current = setTimeout(stop, 60000);
    } catch {
      tracks.current?.getTracks().forEach((track) => track.stop());
      if (active()) { setState('idle'); setNote(t(lang, 'homeNoMic')); }
    }
  }
  return { listen, state, heard, partial, note, listening: state === 'recording', busy: state === 'processing' || state === 'permission', unavailable, elapsed };
}
