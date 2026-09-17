// Home - the fisherman-first front page. Safety leads (never a temperature
// dashboard), then the two ways to use WeatherGPT: speak, or tap a question.
// The connected-sources strip stays visible: honesty is part of the product.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, PERSONA_QUESTIONS, PERSONA_LABELS } from '../i18n';
import { useApp } from '../store';
import { Card, Sev, Loading, Empty } from './ui';
import SourceStrip from './SourceStrip';
import Icon from './icons';
import ProfileAdvice from './ProfileAdvice';
import { useVoiceInput } from '../useVoiceInput';



export default function Home() {
  const { lang, setView, setPendingAsk, loc, persona } = useApp();
  const [warn, setWarn] = useState(null);

  useEffect(() => {
    let alive = true;
    api.warnings(loc.district, loc.lat, loc.lon)
      .then((d) => { if (alive) setWarn({ status: 'ok', ...d }); })
      .catch(() => { if (alive) setWarn({ status: 'unavailable' }); });
    return () => { alive = false; };
  }, [loc.district, loc.lat, loc.lon]);

  // A question raised on Home lands in the Ask page and fires immediately -
  // one flow, no duplicated chat state.
  const askFromHome = (text) => {
    setPendingAsk(text);
    setView('ask');
  };

  const { listen, listening, heard, note, busy } = useVoiceInput(lang, askFromHome);

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

      <ProfileAdvice />
      <Card title={t(lang, 'homeVoice')} sub={t(lang, 'homeTapMic')}>
        <div className="home-voice">
          <button
            type="button"
            className="mic-big"
            onClick={listen}
            disabled={busy}
            aria-pressed={listening}
            aria-label={t(lang, listening ? 'stop' : 'listen')}
          >
            <Icon name="mic" size={34} />
            <span>{t(lang, listening ? 'stop' : 'listen')}</span>
          </button>
          <div>
            {heard ? <p className="mono">{t(lang, 'homeHeard')}: &quot;{heard}&quot;</p> : null}
            {busy && <p role="status">{t(lang, 'processing')}</p>}
            {note ? <p className="mono">{note}</p> : null}
            <button type="button" className="btn ghost" onClick={() => setView('ask')}>
              {t(lang, 'homeType')}
            </button>
          </div>
        </div>
      </Card>

      <Card title={`${t(lang, 'homeQuick')} ? ${PERSONA_LABELS[lang]?.[persona] || persona}`}>
        <div className="quick-row">
          {(PERSONA_QUESTIONS[persona] || PERSONA_QUESTIONS.general).map((k) => (
            <button key={k} type="button" className="btn ghost" onClick={() => askFromHome(t(lang, k))}>
              {t(lang, k)}
            </button>
          ))}
        </div>
      </Card>

      <details className="card"><summary>{t(lang, 'sourcesDetails')}</summary><SourceStrip refreshKey={0} /></details>
    </div>
  );
}