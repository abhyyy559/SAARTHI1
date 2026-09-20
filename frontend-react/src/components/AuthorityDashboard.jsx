// Authority Coverage Dashboard — "did the warning actually reach the area?"
//
// One alert, two ledgers, never mixed:
//   REAL   — per-device records written from the push service's own results,
//            plus OPENED/ACKNOWLEDGED events devices reported and P2P relays.
//   SIM    — a labelled simulated audience (seeded from the Admin panel) that
//            gives the dashboard realistic volumes on one laptop. Every payload
//            carries the SIMULATED label so the jury can always tell them apart.
//
// Terminology is strict (delivery_service.STATUSES): DELIVERED ≠ OPENED ≠
// ACKNOWLEDGED. The dashboard shows communication coverage, not a safety count
// — the copy here must never imply "80% acknowledged = 80% safe".
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { Card, Stat } from './ui';
import Icon from './icons';

function ZoneGrid({ zones }) {
  const cells = (zones || []).filter((z) => z.total > 0);
  if (cells.length === 0) return null;
  return (
    <div className="zone-grid" role="table" aria-label="Coverage by zone">
      {cells.map((z) => {
        const tone = z.pct >= 80 ? 'good' : z.pct >= 50 ? 'mid' : 'bad';
        return (
          <div key={z.zone} className={`zone-cell ${tone}`} role="cell"
            title={`${z.reached}/${z.total} reached`}>
            <b>{z.zone}</b>
            <span>{z.pct}%</span>
            <span className="mono">{z.reached}/{z.total}</span>
          </div>
        );
      })}
    </div>
  );
}

function LedgerBlock({ title, data, simulated }) {
  const { lang } = useApp();
  if (!data) return null;
  const total = data.reached + (data.PENDING || 0) + (data.OFFLINE || 0) + (data.UNREACHABLE || 0);
  const pct = (n) => (total ? `${Math.round((100 * n) / total)}%` : '0%');
  return (
    <div className={`cov-block ${simulated ? 'is-sim' : ''}`}>
      <div className="cov-head">
        <b>{title}</b>
        {simulated && <span className="prov DEMO">{t(lang, 'covSimLabel')}</span>}
      </div>
      <div className="cov-bar" role="img"
        aria-label={`${pct(data.reached)} reached`}>
        <span style={{ width: pct(data.reached), background: 'var(--sev-green)' }} />
        <span style={{ width: pct(data.PENDING || 0), background: 'var(--sev-yellow)' }} />
        <span style={{ width: pct(data.OFFLINE || 0), background: '#f59e0b' }} />
        <span style={{ width: pct(data.UNREACHABLE || 0), background: 'var(--sev-red)' }} />
      </div>
      <div className="cov-stats">
        <Stat k={t(lang, 'covReached')} v={data.reached} />
        <Stat k={t(lang, 'covDelivered')} v={data.DELIVERED || 0} />
        <Stat k={t(lang, 'covOpened')} v={data.OPENED || 0} />
        <Stat k={t(lang, 'covAck')} v={data.ACKNOWLEDGED || 0} />
        <Stat k={t(lang, 'covP2P')} v={data.P2P_RELAYED || 0} />
        <Stat k={t(lang, 'covPending')} v={data.PENDING || 0} />
        <Stat k={t(lang, 'covOffline')} v={data.OFFLINE || 0} />
        <Stat k={t(lang, 'covUnreach')} v={data.UNREACHABLE || 0} />
      </div>
      <ZoneGrid zones={data.zones} />
    </div>
  );
}

export default function AuthorityDashboard() {
  const { lang, showToast, sourceMode } = useApp();
  const [alerts, setAlerts] = useState(null);
  const [selected, setSelected] = useState('');
  const [cov, setCov] = useState(null);
  const [tick, setTick] = useState(0);

  // Same gate as the Admin panel: /api/demo/* is demo-mode-only, so polling it
  // in hybrid mode is pointless 403 spam. Show the explanation instead.
  const demoLive = sourceMode === 'demo';

  useEffect(() => {
    if (!demoLive) { setAlerts([]); return undefined; }
    api.demoAlerts().then((d) => {
      setAlerts(d.alerts || []);
      setSelected((cur) => cur || (d.alerts || []).slice(-1)[0]?.id || '');
    }).catch(() => setAlerts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, demoLive]);

  const load = useCallback(() => {
    if (!demoLive || !selected) return;
    api.coverage(selected).then(setCov).catch(() => setCov(null));
  }, [demoLive, selected]);

  useEffect(() => { load(); }, [load, tick]);

  // Light polling: the ledger moves when devices ack or the stage seeds data.
  useEffect(() => {
    if (!demoLive) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [demoLive]);

  const selectedAlert = (alerts || []).find((a) => a.id === selected);
  const note = t(lang, 'covNote');

  if (!demoLive) {
    return (
      <Card title={t(lang, 'covTitle')} sub={note} className="ops-panel">
        <p className="sub">{t(lang, 'covNeedsDemo')}</p>
      </Card>
  );
  }

  return (
    <Card title={t(lang, 'covTitle')} sub={note} className="ops-panel">
      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="mono">
          {t(lang, 'covPick')}
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {(alerts || []).length === 0 && <option value="">—</option>}
            {(alerts || []).map((a) => (
              <option key={a.id} value={a.id}>{a.title} · {a.district} · {a.state}</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn ghost sm" onClick={load}>
          <Icon name="refresh" size={14} /> {t(lang, 'alertsRetry')}
        </button>
        {selected && (
          <button type="button" className="btn ghost sm"
            onClick={() => api.coverageSeed(selected, 500)
              .then(() => { showToast(t(lang, 'demoSeeded')); load(); })
              .catch(() => showToast('Failed'))}>
            {t(lang, 'demoSeed')}
          </button>
        )}
      </div>

      {!cov ? <p className="sub">{t(lang, 'covEmpty')}</p> : (
        <>
          {selectedAlert && (
            <div className="evrow">
              <span className="k">{selectedAlert.title} · {selectedAlert.district}</span>
              <span className="sev-stamp" data-sev={selectedAlert.severity}>{selectedAlert.severity}</span>
            </div>
          )}
          <LedgerBlock title={t(lang, 'covRealTitle')} data={cov.real} />
          <LedgerBlock title={t(lang, 'covSimTitle')} data={cov.simulated} simulated />
        </>
      )}
    </Card>
  );
}
