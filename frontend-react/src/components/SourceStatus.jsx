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

  return (
    <Card title={t(lang, 'srcStatusTitle')} sub={t(lang, 'srcStatusSub')}>
      {!data && <div className="mono">{t(lang, 'srcProbing')}</div>}
      {data && (
        <div className="src-list">
          {WANT.map((w) => {
            const s = byId[w.id] || null;
            const status = s ? String(s.status || s.state || 'UNCONFIGURED') : 'UNCONFIGURED';
            return (
              <div className="src-row" key={w.id} title={w.id}>
                <Icon name="database" size={14} />
                <b>{w.label}</b>
                <span className={`prov ${status}`}>{status}</span>
                {s && s.detail && <span className="sub">{String(s.detail)}</span>}
              </div>
            );
          })}
          {sources
            .filter((s) => !WANT.some((w) => w.id === String(s.id || s.name || '').toLowerCase()))
            .map((s, i) => (
              <div className="src-row" key={`extra-${i}`} title={String(s.id || s.name || '')}>
                <Icon name="database" size={14} />
                <b>{String(s.label || s.id || s.name || 'source')}</b>
                <span className={`prov ${String(s.status || s.state || 'UNCONFIGURED')}`}>
                  {String(s.status || s.state || 'UNCONFIGURED')}
                </span>
              </div>
            ))}
          {failed && <p className="ask-ev-say">{t(lang, 'srcFailed')}</p>}
        </div>
      )}
    </Card>
  );
}
