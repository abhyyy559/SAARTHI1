// Coverage Dashboard — district ack telemetry (Round2 S3.3.3).
//
// GET /api/coverage?district= aggregate from push_service.telemetry:
// { district, counts: {delivered, opened, acknowledged, pending, offline,
//   unreachable, p2p_relayed}, total, reached, zones: [{zone, total, reached, pct}] }.
//
// Communication visibility only — counts describe delivery, never safety.
import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { Card, Stat } from './ui';
import Icon from './icons';
import { DISTRICTS } from '../i18n';

const COUNT_KEYS = ['delivered', 'opened', 'acknowledged', 'pending', 'offline', 'unreachable', 'p2p_relayed'];

export default function CoverageDashboard({ district: initialDistrict }) {
  const { lang, loc, syncTick } = useApp();
  const [district, setDistrict] = useState(initialDistrict || loc.district || '');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  const fetchCoverage = useCallback((d) => {
    api.coverageByDistrict(d)
      .then((c) => { setData(c); setErr(false); })
      .catch(() => { setErr(true); });
  }, []);

  // Initial fetch and refresh on district change / syncTick
  useEffect(() => {
    fetchCoverage(district);
  }, [district, fetchCoverage]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const id = setInterval(() => {
      fetchCoverage(district);
    }, 30000);
    return () => clearInterval(id);
  }, [district, fetchCoverage]);

  const counts = (data && data.counts) || {};
  const zones = (data && data.zones) || [];
  const total = data?.total || 0;
  const reached = data?.reached || 0;
  const deliveryRate = total > 0 ? Math.round((reached / total) * 100) : 0;
  const ackRate = counts.delivered > 0 ? Math.round((counts.acknowledged / counts.delivered) * 100) : 0;

  return (
    <Card title={t(lang, 'covDistrictTitle')} sub={t(lang, 'covNote')} className="ops-panel">
      <div className="cov-filter">
        <label className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {t(lang, 'district')}
          <select
            className="input"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            aria-label={t(lang, 'district')}
          >
            <option value="">{t(lang, 'covAllDistricts')}</option>
            {DISTRICTS.map((d) => (
              <option key={d.district} value={d.district}>{d.district}</option>
            ))}
          </select>
        </label>
      </div>

      {!data && !err && <p className="mono">{t(lang, 'checking')}</p>}
      {err && <p className="sub">{t(lang, 'covEmpty')}</p>}
      {data && (
        <>
          <div className="cov-stats">
            <Stat k={t(lang, 'covTotalSent')} v={total} />
            <Stat k={t(lang, 'covReached')} v={`${reached}/${total}`} />
            <Stat k={t(lang, 'covDeliveryRate')} v={`${deliveryRate}%`} />
            <Stat k={t(lang, 'covAckRate')} v={`${ackRate}%`} />
            {COUNT_KEYS.map((k) => (
              <Stat key={k} k={t(lang, `cov${k.charAt(0).toUpperCase() + k.slice(1)}`)} v={counts[k] || 0} />
            ))}
            {counts.p2p_relayed > 0 && (
              <span className="prov DEMO">
                <Icon name="radio" size={12} /> {t(lang, 'covSimLabel')}
              </span>
            )}
          </div>
          {zones.length > 0 && (
            <div className="zone-grid" role="table" aria-label={t(lang, 'covZoneBreakdown')}>
              {zones.map((z) => {
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
          )}
        </>
      )}
    </Card>
  );
}
