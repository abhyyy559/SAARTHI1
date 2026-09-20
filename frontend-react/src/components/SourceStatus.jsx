// Source Status — data source status page (Round2 S3.3.4).
//
// SACHET CAP / Open-Meteo / WIS2 / IMD via GET /api/sources. Every adapter's
// own status string renders VERBATIM (LIVE | CACHED | DEMO | READY |
// UNCONFIGURED | OFFLINE | ERROR) — honest UNCONFIGURED labels are kept, never
// relabelled upward.
//
// HARBOUR SIGNAL: two tiers of copy. The card carries one citizen sentence
// ("IMD — not connected yet"); the machine vocabulary lives behind a
// "Why?" disclosure. Each source gets a meaningful icon, not a repeated DB.
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
  { id: 'cap', label: 'SACHET CAP', icon: 'bell' },
  { id: 'open-meteo', label: 'Open-Meteo', icon: 'globe' },
  { id: 'wis2', label: 'WIS2', icon: 'radio' },
  { id: 'imd', label: 'IMD', icon: 'thermometer' },
  { id: 'gis-location', label: 'GIS — nearest district', icon: 'pin' },
  { id: 'gis-polygon', label: 'GIS — warning polygon', icon: 'map' },
  { id: 'gis-hazard', label: 'GIS — hazard distance', icon: 'route' },
];

const CITIZEN_KEY = {
  LIVE: 'srcLineLive',
  DEMO: 'srcLineDemo',
  UNCONFIGURED: 'srcLineUnconfigured',
  OFFLINE: 'srcLineOffline',
  CACHED: 'srcLineCached',
  READY: 'srcLineReady',
};

function citizenLine(lang, name, status) {
  const key = CITIZEN_KEY[status] || 'srcLineReady';
  return t(lang, key).replace('{name}', name);
}

function SourceCard({ name, status, detail, updatedAt, icon, idLine }) {
  const { lang } = useApp();
  return (
    <div className="src-card">
      <div className="src-card-top">
        <span className="tile-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
        <span>{name}</span>
      </div>
      <div className="src-card-detail">{citizenLine(lang, name, status)}</div>
      <details className="src-why">
        <summary>{t(lang, 'srcWhy')}</summary>
        <div className="src-card-state">
          <span className={`prov ${status}`}>{status}</span>
        </div>
        {detail && <span className="sub">{String(detail)}</span>}
        <div className="src-card-meta">
          {updatedAt && (
            <span className="src-card-stamp">{t(lang, 'srcUpdated')} {clock(updatedAt)}</span>
          )}
          <span className="src-card-stamp">{idLine}</span>
        </div>
      </details>
    </div>
  );
}

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
  const recheck = () => {
    setData(null);
    setFailed(false);
    api.sourceStatus()
      .then((d) => { setData(d); setFailed(false); })
      .catch(() => { setData({ sources: [] }); setFailed(true); });
  };

  return (
    <Card title={t(lang, 'srcStatusTitle')} sub={t(lang, 'viewSourcesSub')}
      actions={(
        <button type="button" className="btn btn-ghost sm" onClick={recheck} disabled={!data}>
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
              <SourceCard key={w.id} name={w.label} status={status}
                detail={s && s.detail} updatedAt={s && s.updated_at}
                icon={w.icon} idLine={w.id} />
            );
          })}
          {sources
            .filter((s) => !WANT.some((w) => w.id === String(s.id || s.name || '').toLowerCase()))
            .map((s, i) => (
              <SourceCard key={`extra-${i}`} name={String(s.label || s.id || s.name || 'source')}
                status={String(s.status || s.state || 'UNCONFIGURED')}
                detail={s.detail} updatedAt={s.updated_at}
                icon="database" idLine={String(s.id || s.name || '')} />
            ))}
          {failed && <p className="sub">{t(lang, 'srcFailed')}</p>}
        </div>
      )}
    </Card>
  );
}
