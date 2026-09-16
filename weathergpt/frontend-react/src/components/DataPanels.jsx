import { useEffect, useState } from 'react';
import { api, HYD } from '../api';
import { saveCache, readCache } from '../offline';
import { Card, Prov, Empty, Loading } from './ui';

// Model comparison + climate trends. Both fail honestly to UNAVAILABLE with
// provenance labels intact; stale cache is the last resort, always labelled.
function Spark({ points, unit }) {
  if (!points || points.length < 2) return null;
  const vals = points.map((p) => p.v).filter((v) => v !== null && v !== undefined);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  const W = 280, H = 48;
  const step = W / (points.length - 1);
  const y = (v) => H - 4 - ((v - min) / (max - min || 1)) * (H - 8);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label="trend over the series">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" />
      <title>{`${vals.length} points · ${unit}`}</title>
    </svg>
  );
}

export function ModelsPanel() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    api.models(HYD.lat, HYD.lon)
      .then((d) => { if (alive) { setData({ status: 'ok', ...d }); saveCache('models', d); } })
      .catch(() => {
        if (!alive) return;
        const c = readCache().models;
        setData(c ? { status: 'cached', provenance: 'CACHED', comparison: c.data.comparison } : { status: 'unavailable' });
      });
    return () => { alive = false; };
  }, []);
  const cmp = data?.comparison;
  return (
    <Card title="NWP model comparison" sub="GFS / ECMWF / GEM / ICON day-1 figures. Spread is confidence context, never a warning (§32).">
      {!data ? <Loading />
        : data.status === 'unavailable' || !cmp ? (
          <Empty>Model comparison temporarily unavailable. Models report their own status — nothing is estimated.</Empty>
        ) : (
          <>
            <div className="row" style={{ gap: 6, marginBottom: 8 }}>
              <Prov value={data.provenance} />
              {data.status === 'cached' && <span className="prov CACHED">STALE</span>}
            </div>
            <div className="evbox">
              {Object.entries(cmp.models || {}).map(([name, m]) => (
                <div className="evrow" key={name}>
                  <span className="k">{name}</span>
                  <span>
                    {m.tmax_day1 != null ? `${m.tmax_day1} °C` : '—'}
                    {m.rain_day1 != null ? ` · ${m.rain_day1} mm` : ''}
                    {m.status === 'UNCONFIGURED' && <span className="prov UNCONFIGURED"> UNCONFIGURED</span>}
                  </span>
                </div>
              ))}
              <div className="evrow"><span className="k">agreement</span><span>{cmp.agreement}{cmp.spread_c != null ? ` (spread ${cmp.spread_c} °C)` : ''}</span></div>
              <div className="evrow"><span className="k">note</span><span>{cmp.note}</span></div>
            </div>
          </>
        )}
    </Card>
  );
}

export function ClimatePanel() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    api.climate(HYD.lat, HYD.lon)
      .then((d) => { if (alive) { setData({ status: 'ok', ...d }); saveCache('climate', d); } })
      .catch(() => {
        if (!alive) return;
        const c = readCache().climate;
        setData(c ? { status: 'cached', provenance: 'CACHED', trends: c.data.trends } : { status: 'unavailable' });
      });
    return () => { alive = false; };
  }, []);
  const tr = data?.trends;
  return (
    <Card title="Climate trends (ERA5, 20 years)" sub="Every statistic derives from the fetched daily series. Nothing is invented.">
      {!data ? <Loading />
        : data.status === 'unavailable' || !tr ? (
          <Empty>Historical climate information is temporarily unavailable. Will recover when the archive API is reachable.</Empty>
        ) : (
          <>
            <div className="row" style={{ gap: 6, marginBottom: 8 }}>
              <Prov value={data.provenance} />
              {data.status === 'cached' && <span className="prov CACHED">STALE</span>}
            </div>
            <Spark points={(tr.yearly || []).map((p) => ({ v: p.tmean_c }))} unit="mean temp °C/yr" />
            <Spark points={(tr.yearly || []).map((p) => ({ v: p.rain_mm }))} unit="annual rain mm" />
            <div className="evbox">
              <div className="evrow"><span className="k">temp trend</span><span>{tr.temp_trend_c_per_year} °C / year</span></div>
              <div className="evrow"><span className="k">rain trend</span><span>{tr.rain_trend_mm_per_year} mm / year</span></div>
              <div className="evrow"><span className="k">latest anomaly</span><span>
                {tr.temp_anomaly_c != null ? `${tr.temp_anomaly_c} °C` : '—'}
                {tr.rain_anomaly_mm != null ? ` · ${tr.rain_anomaly_mm} mm` : ''}
              </span></div>
              <div className="evrow"><span className="k">source</span><span>{tr.source}</span></div>
            </div>
          </>
        )}
    </Card>
  );
}
