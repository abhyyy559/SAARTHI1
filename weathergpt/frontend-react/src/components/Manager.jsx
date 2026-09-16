import { useState } from 'react';
import { api, HYD } from '../api';

// Disaster-manager view: regional rollup + generated situation report (from verified data only).
export default function Manager() {
  const [rep, setRep] = useState('');

  async function generate() {
    try {
      const [st, w, reps, cl] = await Promise.all([
        api.status(), api.warnings(HYD.district, HYD.lat, HYD.lon),
        api.reports(HYD.district), api.climate(HYD.lat, HYD.lon),
      ]);
      const lines = [
        `SITUATION REPORT — ${HYD.district} — ${new Date().toLocaleString('en-IN')}`,
        `Backend state: ${st.state}. Sources live: ${st.data_source_status.filter((s) => s.status === 'LIVE').map((s) => s.name).join(', ') || 'none'}.`,
        w.warning ? `Active official warning: ${w.warning.severity} ${w.warning.hazard}, valid → ${w.warning.valid_until}.`
          : 'No active official warning verified.',
        `Community reports: ${reps.reports.length} (advisory only, not official).`,
        `Climate context: temp trend ${cl.trends.temp_trend_c_per_year} C/yr, rain trend ${cl.trends.rain_trend_mm_per_year} mm/yr (${cl.provenance}).`,
        'Official warnings take precedence. This report summarizes verified data; it is decision support, not an authority directive.',
      ];
      setRep(lines.join('\n'));
    } catch {
      setRep('Report unavailable — backend unreachable. Showing last verified data only.');
    }
  }

  return (
    <section className="panel">
      <h2>Disaster-manager view</h2>
      <div className="sub">Regional rollup + one-click situation report from verified sources.</div>
      <div className="row"><button className="btn" onClick={generate}>Generate Situation Report</button></div>
      {rep && <div className="msg bot" style={{ maxWidth: '100%', whiteSpace: 'pre-wrap', marginTop: 10 }}>{rep}</div>}
    </section>
  );
}
