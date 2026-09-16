// Home - the fisherman-first front page. Safety leads (never a temperature
// dashboard), then the two ways to use WeatherGPT: speak, or tap a question.
// The connected-sources strip stays visible: honesty is part of the product.
import { useEffect, useRef, useState } from 'react';
import { api, HYD } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { Card, Sev, Loading, Empty } from './ui';
import SourceStrip from './SourceStrip';
import Icon from './icons';

const SR_LANG = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };
const QUICK = ['q1', 'q2', 'q3'];

export default function Home() {
  const { lang, setView, setPendingAsk } = useApp();
  const [warn, setWarn] = useState(null);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [note, setNote] = useState('');
  const recRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api.warnings(HYD.district, HYD.lat, HYD.lon)
      .then((d) => { if (alive) setWarn({ status: 'ok', ...d }); })
      .catch(() => { if (alive) setWarn({ status: 'unavailable' }); });
    return () => { alive = false; };
  }, []);

  // A question raised on Home lands in the Ask page and fires immediately -
  // one flow, no duplicated chat state.
  const askFromHome = (text) => {
    setPendingAsk(text);
    setView('ask');
  };

  async function listen() {
    if (listening) { stopRec(); return; }
    // Server STT (Sarvam) first — works in every browser, handles hi/te well.
    if (!navigator.mediaDevices || !window.MediaRecorder) { browserListen(); return; }
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
            askFromHome(j.text);
          } else {
            setNote(t(lang, 'homeNoHear'));
          }
        } catch {
          browserListen();
        }
      };
      rec.start();
    } catch {
      setNote(t(lang, 'homeNoMic'));
    }
  }

  function stopRec() {
    if (recRef.current && recRef.current.stop) recRef.current.stop();
  }

  // Browser-only fallback (Web Speech API) when media recording is unavailable.
  function browserListen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setNote(t(lang, 'homeNoMic')); return; }
    const r = new SR();
    r.lang = SR_LANG[lang] || 'en-IN';
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setHeard(text);
      recRef.current = null;
      setListening(false);
      askFromHome(text);
    };
    r.onend = () => { recRef.current = null; setListening(false); };
    recRef.current = r;
    setNote('');
    try {
      r.start();
      setListening(true);
    } catch {
      setNote(t(lang, 'homeNoMic'));
      recRef.current = null;
      setListening(false);
    }
  }

  const w = warn && warn.warning;

  return (
    <div className="home-stack">
      <Card
        title={t(lang, 'homeSafety')}
        sub="Official warnings only - severity colours come from IMD, never from us."
      >
        {!warn ? <Loading />
          : warn.status === 'unavailable' ? (
            <Empty>{t(lang, 'homeUnavailable')}</Empty>
          ) : w ? (
            <div className="warnbox">
              <Sev level={w.severity} />
              <div>
                <div className="mono">{w.hazard} · {w.district}</div>
                <div className="sub">{w.message}</div>
                <div className="evrow"><span className="k">source</span><span>{w.source} · OFFICIAL</span></div>
                {w.valid_until && (
                  <div className="evrow"><span className="k">valid until</span><span>{w.valid_until}</span></div>
                )}
              </div>
            </div>
          ) : (
            <Empty>{t(lang, 'homeNoWarning')}</Empty>
          )}
        {w && (
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => askFromHome(`${t(lang, 'homeAskAbout')}: ${w.hazard}`)}>
              {t(lang, 'homeAskAbout')}
            </button>
          </div>
        )}
      </Card>

      <Card title={t(lang, 'homeVoice')} sub={t(lang, 'homeTapMic')}>
        <div className="home-voice">
          <button
            type="button"
            className="mic-big"
            onClick={listen}
            aria-pressed={listening}
            aria-label={t(lang, 'listen')}
          >
            <Icon name="mic" size={34} />
          </button>
          <div>
            {heard ? <p className="mono">{t(lang, 'homeHeard')}: &quot;{heard}&quot;</p> : null}
            {note ? <p className="mono">{note}</p> : null}
            <button type="button" className="btn ghost" onClick={() => setView('ask')}>
              {t(lang, 'homeType')}
            </button>
          </div>
        </div>
      </Card>

      <Card title={t(lang, 'homeQuick')}>
        <div className="quick-row">
          {QUICK.map((k) => (
            <button key={k} type="button" className="btn ghost" onClick={() => askFromHome(t(lang, k))}>
              {t(lang, k)}
            </button>
          ))}
        </div>
      </Card>

      <Card title={t(lang, 'homeSources')}>
        <SourceStrip refreshKey={0} />
      </Card>
    </div>
  );
}