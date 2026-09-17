import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { t } from './i18n';

// Recording is shared by Home and Ask; never silently re-record after a failure.
export function useVoiceInput(lang, onText) {
  const [state, setState] = useState('idle');
  const [heard, setHeard] = useState('');
  const [note, setNote] = useState('');
  const session = useRef(0);
  const recorder = useRef(null);
  const tracks = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => {
    session.current++;
    clearTimeout(timer.current);
    const rec = recorder.current;
    if (rec) { rec.onstop = null; rec.onresult = null; rec.onend = null; try { rec.stop(); } catch { /* idle */ } }
    tracks.current?.getTracks().forEach((track) => track.stop());
  }, [lang]);

  function stop() {
    clearTimeout(timer.current);
    try { recorder.current?.stop(); } catch { /* already stopped */ }
  }

  async function listen() {
    if (state === 'recording') { stop(); return; }
    if (state === 'processing' || state === 'permission') return;
    const id = ++session.current;
    const active = () => id === session.current;
    setNote('');
    setState('permission');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { setState('idle'); setNote(t(lang, 'homeNoMic')); return; }
      const rec = new SR();
      recorder.current = rec;
      rec.lang = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' }[lang];
      rec.onresult = (event) => {
        if (!active()) return;
        const text = event.results[0][0].transcript;
        setHeard(text); onText(text);
      };
      rec.onerror = () => { if (active()) setNote(t(lang, 'voiceFailed')); };
      rec.onend = () => { if (active()) setState('idle'); };
      try { rec.start(); setState('recording'); setNote(t(lang, 'voiceFallback')); }
      catch { setState('idle'); setNote(t(lang, 'homeNoMic')); }
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
        if (!active()) return;
        setState('processing');
        try {
          const result = await api.transcribe(new Blob(chunks, { type: rec.mimeType || chunks[0]?.type || 'audio/webm' }), lang);
          if (!active()) return;
          if (result.text?.trim()) { setHeard(result.text); onText(result.text); }
          else setNote(t(lang, result.using_browser_speech ? 'voiceFailed' : 'homeNoHear'));
        } catch { if (active()) setNote(t(lang, 'voiceFailed')); }
        finally { if (active()) setState('idle'); }
      };
      rec.start(); setState('recording');
      timer.current = setTimeout(stop, 60000);
    } catch {
      tracks.current?.getTracks().forEach((track) => track.stop());
      if (active()) { setState('idle'); setNote(t(lang, 'homeNoMic')); }
    }
  }
  return { listen, state, heard, note, listening: state === 'recording', busy: state === 'processing' || state === 'permission' };
}
