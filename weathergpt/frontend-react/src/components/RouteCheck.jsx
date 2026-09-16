import { useState } from 'react';
import { api, HYD } from '../api';

// A → B travel risk (§49 Phase 3): timing + geography + warnings, worst-point-wins.
export default function RouteCheck() {
  const [a, setA] = useState({ lat: HYD.lat, lon: HYD.lon });
  const [b, setB] = useState({ lat: 17.23, lon: 78.35 });
  const [res, setRes] = useState(null);

  async function check() {
    try {
      setRes(await api.impact(a, b, 'driver'));
    } catch {
      setRes({ status: 'unavailable' });
    }
  }

  return (
    <section className="panel">
      <h2>Route check — can I travel from A to B?</h2>
      <div className="sub">Samples origin, midpoint, destination. Never declares a route safe.</div>
      <div className="row">
        <label className="mono">A <input type="text" value={`${a.lat},${a.lon}`} size={16}
          onChange={(e) => { const [x, y] = e.target.value.split(',').map(Number); setA({ lat: x, lon: y }); }} /></label>
        <label className="mono">B <input type="text" value={`${b.lat},${b.lon}`} size={16}
          onChange={(e) => { const [x, y] = e.target.value.split(',').map(Number); setB({ lat: x, lon: y }); }} /></label>
        <button className="btn" onClick={check}>Check route</button>
      </div>
      {res && res.assessment && (
        <div className="warnbox" style={{ borderColor: 'var(--line)' }}>
          <b>Risk: {res.assessment.risk_level}</b> — {res.assessment.reason} ({res.distance_km} km)
          <div className="mono">{res.disclaimer}</div>
          <table className="grid"><thead><tr><th>POINT</th><th>RAIN MM</th><th>PROV</th></tr></thead>
            <tbody>{res.points.map((p) => (
              <tr key={p.point}><td>{p.point}</td><td>{p.rain_day1_mm ?? '—'}</td>
                <td><span className={`prov ${p.provenance}`}>{p.provenance}</span></td></tr>
            ))}</tbody></table>
        </div>
      )}
      {res?.status === 'unavailable' && <div className="mono">Route check unavailable — backend unreachable.</div>}
    </section>
  );
}
