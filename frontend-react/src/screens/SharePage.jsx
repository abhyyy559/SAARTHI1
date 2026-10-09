// What someone sees after scanning a WeatherGPT QR code with a plain phone
// camera. No install, no login, no stored state. The snapshot shows at once
// (it is inside the link), stamped with the time it was fetched; if this
// phone is online, the latest official status for the same place loads below.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { decodeSnapshot, readSnapshot } from '../lib/share';
import { LANGS, condText, dayName, fmtDateTime, t } from '../lib/i18n';
import { ROLES, activeAlerts, conditionIcon, hazardIcon, levelIcon, senderLabel, severityTone, sourceLabel, toneOf } from '../lib/weather';
import { Icon } from '../components/Icons';
import { SpeakButton } from '../components/ui';
import { summaryText } from './Today';

const r0 = (n) => (n == null ? '–' : Math.round(Number(n)));

export default function SharePage({ payload }) {
  const [snap, setSnap] = useState(null);
  const [bad, setBad] = useState(false);
  const [lang, setLang] = useState('en');
  const [live, setLive] = useState(null);

  useEffect(() => {
    decodeSnapshot(payload).then(readSnapshot).then((s) => { setSnap(s); setLang(s.lang || 'en'); })
      .catch(() => setBad(true));
  }, [payload]);

  useEffect(() => {
    if (!snap || !navigator.onLine || snap.loc.lat == null) return;
    const loc = { district: snap.loc.district, lat: snap.loc.lat, lon: snap.loc.lon };
    api.warnings(loc).then((d) => setLive({ verdict: d.verdict, at: Date.now() })).catch(() => {});
  }, [snap]);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  if (bad) {
    return (
      <main className="share-page">
        <div className="empty"><Icon name="question" size={48} className="tone-grey-ink" /><p>{t(lang, 'badLink')}</p></div>
        <a className="btn-big" href="/">{t(lang, 'openApp')}</a>
      </main>
    );
  }
  if (!snap) return <main className="share-page"><div className="skeleton" style={{ height: 240 }} /></main>;

  const v = snap.verdict;
  const tone = toneOf(v);
  const role = ROLES.find((r) => r.id === snap.persona) || ROLES[0];
  const speech = summaryText(lang, v, snap.current, snap.days);

  return (
    <main className="share-page">
      <header className="share-head">
        <span className="brand"><Icon name="sun" size={28} /> WeatherGPT</span>
        <div className="lang-pills">
          {LANGS.map((l) => (
            <button key={l.id} type="button" className={l.id === lang ? 'is-on' : ''} onClick={() => setLang(l.id)} aria-label={l.name}>{l.glyph}</button>
          ))}
        </div>
      </header>

      <p className="shared-by"><Icon name="share" size={16} /> {t(lang, 'sharedBy')}</p>
      <p className="shared-at"><Icon name="clock" size={16} /> {t(lang, 'sharedAt', { t: fmtDateTime(snap.savedAt, lang) })}</p>
      <h2 className="place"><Icon name="pin" size={20} /> {snap.loc.district}{snap.loc.state ? `, ${snap.loc.state}` : ''}</h2>

      {v ? (
        <section className={`safety tone-${tone}`}>
          <div className="safety-top">
            <Icon name={levelIcon(v)} size={68} className="safety-icon" />
            <div className="safety-words">
              <h1>{t(lang, `lv${v.level}`)}</h1>
              {v.hazard && v.level !== 'LOW' ? <p className="safety-hazard"><Icon name={hazardIcon(v.hazard)} size={24} /> {v.hazard}</p> : null}
            </div>
          </div>
          <SpeakButton text={speech} lang={lang} id="share-safety" big />
          <div className="safety-foot">
            {v.checked_sources.map((s) => <span key={s} className="src-chip ok"><Icon name="check" size={14} />{t(lang, 'checked')}: {sourceLabel(s)}</span>)}
            {v.unchecked_sources.map((s) => <span key={s} className="src-chip off"><Icon name="close" size={14} />{sourceLabel(s)} {t(lang, 'notConnected')}</span>)}
          </div>
        </section>
      ) : null}

      {live?.verdict ? (
        <section className={`live-now tone-${toneOf(live.verdict)}`}>
          <Icon name={levelIcon(live.verdict)} size={36} />
          <div>
            <b>{t(lang, 'liveNow')}</b>
            <p>{t(lang, `lv${live.verdict.level}`)}</p>
          </div>
        </section>
      ) : null}

      {snap.current ? (
        <section className="card now">
          <div className="now-main">
            <Icon name={conditionIcon(snap.current.condition, snap.current.rainfall)} size={80} />
            <div>
              <div className="temp">{r0(snap.current.temperature)}°</div>
              <div className="cond">{condText(snap.current.condition, lang)}</div>
            </div>
          </div>
          <div className="stats">
            <div className="stat"><Icon name="drop" size={28} /><b>{snap.current.rainfall ?? '–'}</b><span>mm</span></div>
            <div className="stat"><Icon name="wind" size={28} /><b>{r0(snap.current.wind_speed)}</b><span>km/h</span></div>
            <div className="stat"><Icon name="humidity" size={28} /><b>{r0(snap.current.humidity)}%</b><span>{t(lang, 'humidity')}</span></div>
          </div>
          <p className="src-note">{t(lang, 'source')}: {sourceLabel(snap.current.source)}</p>
        </section>
      ) : null}

      {snap.days.length ? (
        <section className="card">
          <div className="days">
            {snap.days.map((d, i) => (
              <div className="day" key={d.date}>
                <span className="day-name">{dayName(d.date, lang, i)}</span>
                <Icon name={conditionIcon(d.condition, d.rainfall)} size={50} />
                <span className="day-rain"><Icon name="drop" size={16} />{d.rainfall ?? '–'} mm</span>
                <span className="day-temp"><b>{r0(d.max_temperature)}°</b> {r0(d.min_temperature)}°</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeAlerts(snap.alerts).map((a) => (
        <article key={a.headline} className={`alert tone-${severityTone(a.severity)}`}>
          <div className="alert-top">
            <span className="alert-badge"><Icon name={hazardIcon(a.hazard || a.headline)} size={40} /></span>
            <div className="alert-words">
              <h3>{a.hazard}</h3>
              {a.expires ? <p className="alert-meta"><Icon name="clock" size={14} /> {t(lang, 'until', { t: fmtDateTime(a.expires, lang) })}</p> : null}
            </div>
          </div>
          <p className="alert-text">{a.headline}</p>
          <div className="card-foot">
            <span className="src-note">{t(lang, 'official')} · {senderLabel(a)}</span>
            <SpeakButton text={a.headline} lang="en" id={`share-a-${a.headline}`} label={false} />
          </div>
        </article>
      ))}

      {snap.advisory ? (
        <section className="card advice main-advice">
          <Icon name={role.icon} size={44} />
          <div>
            <p>{snap.advisory}</p>
            <SpeakButton text={snap.advisory} lang={snap.lang} id="share-adv" />
            <p className="note">{t(lang, 'adviceNote')}</p>
          </div>
        </section>
      ) : null}

      <a className="btn-big" href="/">{t(lang, 'openApp')}</a>
      <p className="note center">{t(lang, 'aiNote')}</p>
    </main>
  );
}
