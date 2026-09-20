// Source strip — the console's honesty strip. One row per adapter, with the
// adapter's own status string rendered VERBATIM (LIVE | CACHED | DEMO | READY |
// UNCONFIGURED | OFFLINE | ERROR). Nothing is relabelled upward: READY stays a
// neutral grey because "configured but not yet exercised" is not live data, and
// a failed probe says so instead of showing an empty-but-tidy strip.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

// Adapter ids are stable machine names; this is only a readable label for them.
// The raw id stays in the row's title so the label can never hide the source.
const LABELS = {
  imd: 'IMD',
  'open-meteo': 'Open-Meteo',
  govdata: 'data.gov.in',
  cap: 'SACHET CAP',
  owm: 'OpenWeatherMap',
  stt: 'Speech-to-text',
  tts: 'Text-to-speech',
};

// "2026-09-17T22:20:18.426805+05:30" -> "22:20". Empty -> "".
function clock(iso) {
  const m = String(iso || '').match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

export default function SourceStrip({ refreshKey }) {
  const { lang } = useApp();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    api.sources()
      .then((d) => { if (!dead) { setData(d); setFailed(false); } })
      .catch(() => { if (!dead) { setData({ sources: [] }); setFailed(true); } });
    return () => { dead = true; };
  }, [refreshKey]);

  if (!data) return <div className="mono">{t(lang, 'srcProbing')}</div>;

  const sources = data.sources || [];
  const gated = Object.entries(data.needs_keys || {}).filter(([, missing]) => missing);

  return (
    <div>
      <div className="src-head">
        <span className="tile-icon" aria-hidden="true"><Icon name="database" size={20} /></span>
        <span className="kicker">{t(lang, 'sourcesTitle')}</span>
        {data.demo_mode ? <span className="prov DEMO">DEMO</span> : null}
      </div>
      {failed && <p className="sub">{t(lang, 'srcFailed')}</p>}
      {!failed && sources.length === 0 && <p className="sub">{t(lang, 'srcNone')}</p>}
      {!failed && sources.length > 0 && (
        <div className="src-list">
          {sources.map((s) => (
            <div className="src-item" key={s.name} title={s.detail || s.status}>
              <Icon name="radio" size={14} className="icon ask-fact-ico" />
              <span className="src-item-name">{LABELS[s.name] || s.name}</span>
              <span className={`prov ${s.status}`}>{s.status}</span>
              {s.updated_at && (
                <span className="src-item-stamp">
                  {t(lang, 'srcUpdated')} {clock(s.updated_at)}
                </span>
              )}
              {s.detail && (
                <span className="src-item-detail">
                  {s.detail}
                  {s.status === 'ERROR' && (
                    <span className="src-item-hint"> — {t(lang, 'srcErrorHint')}</span>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {gated.length > 0 && (
        <div className="src-keys">
          {gated.map(([key]) => (
            <span className="src-item" key={key}>
              <Icon name="lock" size={14} />
              <span className="src-item-name">{key}</span>
              <span className="sub">{t(lang, 'srcKeyGated')}</span>
              <span className="prov UNCONFIGURED">UNCONFIGURED</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
