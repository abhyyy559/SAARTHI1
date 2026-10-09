import { api } from '../lib/api';
import { keys, useApp } from '../lib/appState';
import { useData } from '../lib/useData';
import { fmtDateTime, t } from '../lib/i18n';
import { activeAlerts, hazardIcon, senderLabel, severityTone, sourceLabel } from '../lib/weather';
import { Icon } from '../components/Icons';
import { Empty, Fresh, Skeleton, SpeakButton } from '../components/ui';
import { PushToggle } from '../components/Toggles';

function AlertRow({ a }) {
  const { lang, askAbout } = useApp();
  const tone = severityTone(a.severity);
  const headline = a.headline || a.message || a.hazard;
  return (
    <article className={`alert tone-${tone}`}>
      <div className="alert-top">
        <span className="alert-badge"><Icon name={hazardIcon(a.hazard || headline)} size={44} /></span>
        <div className="alert-words">
          <h3>{a.hazard || headline}</h3>
          <p className="alert-meta">
            <span className={`sev sev-${tone}`}>{a.severity || '?'}</span>
            {a.expires ? <span><Icon name="clock" size={14} /> {t(lang, 'until', { t: fmtDateTime(a.expires, lang) })}</span> : null}
          </p>
        </div>
      </div>
      <p className="alert-text">{headline}</p>
      {a.areaDesc ? <p className="alert-area"><Icon name="pin" size={14} /> {a.areaDesc}</p> : null}
      <div className="card-foot">
        <span className="src-note">
          {a.official ? `${t(lang, 'official')} · ` : ''}{senderLabel(a) || sourceLabel(a.source)}
        </span>
        <div className="row-gap">
          <button type="button" className="btn-ghost" onClick={() => askAbout(t(lang, 'explainQ', { h: headline }))}>
            <Icon name="chat" size={18} /> {t(lang, 'explain')}
          </button>
          <SpeakButton text={headline} lang="en" id={`alert-${a.identifier || headline}`} label={false} />
        </div>
      </div>
    </article>
  );
}

export default function Alerts() {
  const { lang, loc } = useApp();
  const warn = useData(keys.warnings(loc), () => api.warnings(loc));
  const d = warn.data;
  if (!d) return <div className="screen">{warn.loading ? <Skeleton h={220} /> : <Empty lang={lang} offline={!navigator.onLine} onRetry={warn.reload} />}</div>;
  const mine = activeAlerts(d.cap_alerts);
  const state = activeAlerts(d.nearby_alerts);
  return (
    <div className="screen">
      <div className="screen-head">
        <h1><Icon name="bell" size={26} /> {t(lang, 'tabAlerts')}</h1>
        <Fresh {...warn} lang={lang} />
      </div>
      <PushToggle />
      <h2 className="group"><Icon name="pin" size={18} /> {t(lang, 'yourDistrict')} · {loc.district}</h2>
      {mine.length ? mine.map((a) => <AlertRow key={a.identifier || a.headline} a={a} />) : (
        <div className={`alert-none tone-${d.verdict?.level === 'UNKNOWN' ? 'grey' : 'green'}`}>
          <Icon name={d.verdict?.level === 'UNKNOWN' ? 'question' : 'shield-ok'} size={40} />
          <p>{t(lang, `lv${d.verdict?.level === 'UNKNOWN' ? 'UNKNOWN' : 'LOW'}`)}</p>
        </div>
      )}
      <h2 className="group"><Icon name="globe" size={18} /> {t(lang, 'elsewhere')}{loc.state ? ` · ${loc.state}` : ''}</h2>
      {state.length ? state.map((a) => <AlertRow key={a.identifier || a.headline} a={a} />) : (
        <p className="muted pad">{t(lang, 'alertsNone')}</p>
      )}
    </div>
  );
}
