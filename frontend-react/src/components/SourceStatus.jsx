// Source Status — data source status page (Round2 S3.3.4).
//
// SACHET CAP / Open-Meteo / WIS2 / IMD via GET /api/sources. Every adapter's
// own status string renders VERBATIM (LIVE | CACHED | DEMO | READY |
// UNCONFIGURED | OFFLINE | ERROR) — honest UNCONFIGURED labels are kept, never
// relabelled upward.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { Card } from './ui';
import Icon from './icons';

// "2026-09-17T22:20:18.426805+05:30" -> "22:20". Empty -> "".
function clock(iso) {
  const m = String(iso || '').match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

const WANT = [
  { id: 'cap', label: 'SACHET CAP' },
  { id: 'open-meteo', label: 'Open-Meteo' },
  { id: 'wis2', label: 'WIS2' },
  { id: 'imd', label: 'IMD' },
];

export default function SourceStatus() {
  const { lang, syncTick } = useApp();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    api.sourceStatus()
      .then((d) => { if (!dead) { setData(d); setFailed(false); } })
      .catch(() => { if (!dead) { setData({ sources: [] }); setFailed(true); } });
    return () => { dead = true; };
  }, [syncTick]);

  const sources = (data && data.sources) || [];
  const byId = Object.fromEntries(sources.map((s) => [String(s.id || s.name || '').toLowerCase(), s]));
  const [tick, setTick] = useState(0);
  const recheck = () => {
    setData(null);
    setFailed(false);
    api.sourceStatus()
      .then((d) => { setData(d); setFailed(false); })
      .catch(() => { setData({ sources: [] }); setFailed(true); });
    setTick((n) => n + 1);
  };

  return (
    <Card title={t(lang, 'srcStatusTitle')} sub={t(lang, 'srcStatusSub')}
      actions={(
        <button type="button" className="btn ghost sm" onClick={recheck} disabled={!data}>
          <Icon name="refresh" size={14} /> {t(lang, 'trustRecheck')}
        </button>
      )}>
      {!data && <div className="mono">{t(lang, 'srcProbing')}</div>}
      {data && (
        <div className="grid-3 src-cards">
          {WANT.map((w) => {
            const s = byId[w.id] || null;
            const status = s ? String(s.status || s.state || 'UNCONFIGURED') : 'UNCONFIGURED';
            return (
              <div className="src-card" key={w.id} title={w.id}>
                <div className="src-card-top">
                  <Icon name="database" size={14} />
                  <span className="eyebrow">{w.label}</span>
                </div>
                <div className="src-card-state">
                  <span className={`dot ${status}`} aria-hidden="true" />
                  <span className={`prov ${status}`}>{status}</span>
                </div>
                {s && s.detail && <span className="sub src-card-detail">{String(s.detail)}</span>}
                <div className="src-card-meta">
                  {s && s.updated_at && (
                    <span className="src-card-stamp">{t(lang, 'srcUpdated')} {clock(s.updated_at)}</span>
                  )}
                  <span className="src-card-stamp">{w.id}</span>
                </div>
              </div>
            );
          })}
          {sources
            .filter((s) => !WANT.some((w) => w.id === String(s.id || s.name || '').toLowerCase()))
            .map((s, i) => (
              <div className="src-card" key={`extra-${i}`} title={String(s.id || s.name || '')}>
                <div className="src-card-top">
                  <Icon name="database" size={14} />
                  <span className="eyebrow">{String(s.label || s.id || s.name || 'source')}</span>
                </div>
                <div className="src-card-state">
                  <span className={`dot ${String(s.status || s.state || 'UNCONFIGURED')}`} aria-hidden="true" />
                  <span className={`prov ${String(s.status || s.state || 'UNCONFIGURED')}`}>
                    {String(s.status || s.state || 'UNCONFIGURED')}
                  </span>
                </div>
                <div className="src-card-meta">
                  {s.updated_at && (
                    <span className="src-card-stamp">{t(lang, 'srcUpdated')} {clock(s.updated_at)}</span>
                  )}
                  <span className="src-card-stamp">{String(s.id || s.name || '')}</span>
                </div>
              </div>
            ))}
          {failed && <p className="ask-ev-say">{t(lang, 'srcFailed')}</p>}
        </div>
      )}
    </Card>
  );
}
