import { useEffect, useState } from 'react';
import { api, HYD } from '../api';
import { saveCache, readCache } from '../offline';
import { Card, Stat, Prov, Sev, Empty, Loading } from './ui';

// Situation view — connectivity, then location, then threat, then impact, then
// action. Temperature never leads (§9). Every fetch fails gracefully into an
// honest "unavailable" state, with stale-labelled cache as last resort (§54).
export default function Situation() {
  const [cur, setCur] = useState(null);      // {status:'ok'|'unavailable', ...}
  const [warn, setWarn] = useState(null);
  const [state, setState] = useState(null);  // system status (§41)

  useEffect(() => {
    let alive = true;
    api.status().then((d) => alive && setState(d)).catch(() => alive && setState({ state: 'UNKNOWN', sources: [] }));
    api.current(HYD.lat, HYD.lon)
      .then((d) => {
        if (!alive) return;
        setCur({ status: 'ok', ...d });
        if (d.current) saveCache('current', d);
      })
      .catch(() => {
        if (!alive) return;
        const cached = readCache().current;
        setCur(cached
          ? { status: 'cached', provenance: 'CACHED', stale_note: 'Last verified data, shown stale.', ...cached.data }
          : { status: 'unavailable' });
      });
    api.warnings(HYD.district, HYD.lat, HYD.lon)
      .then((d) => alive && setWarn({ status: 'ok', ...d }))
      .catch(() => { if (alive) setWarn({ status: 'unavailable' }); });
    return () => { alive = false; };
  }, []);

  const conn = state?.state === 'LIVE' ? 'LIVE'
    : state?.state === 'LIMITED' ? 'LIMITED' : state ? state.state : 'PROBING';

  return (
    <section className="situation-grid" aria-label="Current situation">
      <Card
        title="Connectivity"
        sub="OFFLINE is measured on this device; source statuses are reported by each adapter itself."
      >
        <div className="stat-grid">
          <Stat k="SYSTEM STATE" v={conn} hint={conn === 'LIVE' ? 'at least 2 live sources' : 'limited / degraded sources'} />
          <Stat k="ADAPTERS LIVE" v={`${(state?.sources || []).filter((s) => s.status === 'LIVE').length}/${(state?.sources || []).length}`} />
        </div>
      </Card>

      <Card title="Location & current observation" sub="Nearest observation, district-resolved. Provenance always labelled.">
        {!cur ? <Loading />
          : cur.status === 'unavailable' ? (
            <Empty>No verified observation available right now, and no cached snapshot. Nothing is invented to fill the gap.</Empty>
          ) : (
            <>
              <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                <Prov value={cur.provenance} />
                {cur.stale_note && <span className="prov CACHED">STALE</span>}
              </div>
              {cur.status === 'cached'
                ? <Empty>Showing the last verified snapshot — labelled stale until fresh data is reachable.</Empty>
                : (
                  <div className="stat-grid">
                    <Stat k="DISTRICT" v={cur.location?.district || '—'} />
                    <Stat k="TEMPERATURE" v={cur.current ? `${cur.current.temperature} °C` : '—'} />
                    <Stat k="RAINFALL" v={cur.current ? `${cur.current.rainfall} mm` : '—'} />
                    <Stat k="HUMIDITY" v={cur.current ? `${cur.current.humidity} %` : '—'} />
                    <Stat k="WIND" v={cur.current ? `${cur.current.wind_speed} km/h` : '—'} />
                    <Stat k="CONDITION" v={cur.current?.condition || '—'} />
                  </div>
                )}
            </>
          )}
      </Card>

      <Card title="Threat" sub="Official warnings only. Model disagreement is context, never a warning.">
        {!warn ? <Loading />
          : warn.status === 'unavailable' || !warn.warning ? (
            <Empty>
              {warn.status === 'unavailable'
                ? 'Warning sources unreachable — WeatherGPT reports UNAVAILABLE rather than guessing.'
                : 'No active official warning for this district.'}
            </Empty>
          ) : (
            <div className="warnbox">
              <Sev level={warn.warning.severity} />
              <div>
                <div className="mono">{warn.warning.hazard} · {warn.warning.district}</div>
                <div className="sub">{warn.warning.message}</div>
                <div className="evrow"><span className="k">source</span><span>{warn.warning.source} · OFFICIAL</span></div>
              </div>
            </div>
          )}
      </Card>
    </section>
  );
}
