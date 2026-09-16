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

  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setNote('Browser speech recognition is unavailable - type your question instead.');
      return;
    }
    if (recRef.current) { recRef.current.stop(); recRef.current = null; return; }
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
    setNote('');
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
