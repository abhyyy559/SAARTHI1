import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

const SR_LANG = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };

export default function VoicePanel() {
  const { lang, ask, result } = useApp();
  const [providers, setProviders] = useState({ stt: '?', tts: '?' });
  const [heard, setHeard] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState('');
  const recRef = useRef(null);
  const lastAnswer = (result && result.answer) || '';

  useEffect(() => {
    let alive = true;
    api.voiceStatus()
      .then((p) => { if (alive) setProviders(p); })
      .catch(() => { if (alive) setProviders({ stt: 'unknown', tts: 'unknown' }); });
    return () => { alive = false; };
  }, []);

  async function listen() {
    if (listening) { stopRec(); return; }
    // Prefer the server Sarvam STT (works in every browser, tested live);
    // fall back to Web Speech only if media recording is unsupported.
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      browserListen();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      setListening(true);
      setNote('');
      rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = async () => {
          stream.getTracks().forEach((tr) => tr.stop());
          setListening(false);
          recRef.current = null;
          try {
            const j = await api.transcribe(new Blob(chunks, { type: 'audio/webm' }), lang);
            if (j.text) {
              setHeard(j.text);
              if (j.provider) setProviders((p) => ({ ...p, stt: j.provider }));
              ask(j.text);
            } else {
              setNote('Could not hear anything - try again or type the question.');
            }
          } catch {
            setNote('Voice upload failed - using browser recognition instead.');
            browserListen();
          }
        };
      rec.start();
    } catch {
      setNote('Microphone permission denied - type your question instead.');
    }
  }

  function stopRec() {
    if (recRef.current) { recRef.current.stop(); }
  }

  // Browser-only fallback (Web Speech API), used when MediaRecorder is unavailable.
  function browserListen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setNote('Voice input is unavailable in this browser - type your question instead.');
      return;
    }
    const r = new SR();
    r.lang = SR_LANG[lang] || 'en-IN';
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setHeard(text);
      recRef.current = null;
      ask(text);
    };
    r.onend = () => { recRef.current = null; };
    recRef.current = r;
    try {
      r.start();
    } catch {
      setNote('Could not start the microphone.');
      recRef.current = null;
    }
  }

  async function replay() {
    if (!lastAnswer || speaking) return;
    setSpeaking(true);
    try {
      const r = await api.synthesize(lastAnswer.slice(0, 600), lang);
      if (r.audio_base64) {
        const audio = new Audio(`data:${r.mime || 'audio/wav'};base64,${r.audio_base64}`);
        audio.onended = () => setSpeaking(false);
        audio.play();
        setProviders((p) => ({ ...p, tts: r.provider || p.tts }));
        return;
      }
    } catch { /* fall through to browser speech */ }
    const u = new SpeechSynthesisUtterance(lastAnswer.replace(/[^\w\s.,!?]/g, ''));
    u.lang = SR_LANG[lang] || 'en-IN';
    u.onend = () => setSpeaking(false);
    speechSynthesis.speak(u);
  }

  return (
    <section className="card" aria-label={t(lang, 'voice')}>
      <h2>{t(lang, 'voice')}</h2>
      <p className="sub">
        STT provider: <span className="mono">{providers.stt}</span> | TTS provider:{' '}
        <span className="mono">{providers.tts}</span>
        {providers.stt === 'browser-fallback' ? ' (add SARVAM_API_KEY for server-side voice)' : ''}
      </p>
      <div className="row">
        <button className="btn ghost" type="button" onClick={listen}>
          <Icon name="mic" />{t(lang, 'listen')}
        </button>
        <button className="btn ghost" type="button" onClick={replay} disabled={!lastAnswer || speaking}>
          <Icon name="speaker" />{t(lang, 'replay')}
        </button>
      </div>
      {heard ? <p className="mono" style={{ marginTop: 8 }}>heard: &quot;{heard}&quot;</p> : null}
      {note ? <p className="mono" style={{ marginTop: 8 }}>{note}</p> : null}
      {!lastAnswer ? (
        <p className="mono" style={{ marginTop: 8 }}>
          Ask a question first, then replay the grounded answer here.
        </p>
      ) : null}
    </section>
  );
}
