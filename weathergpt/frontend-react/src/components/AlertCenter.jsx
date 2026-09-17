import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';

// Full CAP field display (§13) + community reports (labelled, never official).
const CAP_FIELDS = ['event', 'urgency', 'severity', 'certainty', 'area', 'effective', 'onset',
  'expires', 'headline', 'description', 'instruction', 'sender', 'sent', 'identifier'];

export default function AlertCenter() {
  const { loc } = useApp();
  const [warn, setWarn] = useState(null);
  const [sel, setSel] = useState(0);
  const [reports, setReports] = useState([]);
  const [form, setForm] = useState({ report_type: 'flooding', text: '' });

  useEffect(() => {
    api.warnings(loc.district, loc.lat, loc.lon).then(setWarn).catch(() => setWarn({ status: 'unavailable' }));
    api.reports(loc.district).then((d) => setReports(d.reports || [])).catch(() => {});
  }, [loc.district, loc.lat, loc.lon]);

  const alerts = [...(warn?.cap_alerts || [])];
  if (warn?.warning) alerts.unshift({ ...warn.warning, headline: warn.warning.message, area: warn.warning.district });
  const cur = alerts[sel];

  async function submitReport(e) {
    e.preventDefault();
    const r = await api.report({ ...form, latitude: loc.lat, longitude: loc.lon, district: loc.district });
    if (r.report) setReports((x) => [...x, r.report]);
    setForm({ report_type: 'flooding', text: '' });
  }

  return (
    <section className="panel">
      <h2>Alert Center — verified warnings + community reports</h2>
      {!warn ? <div className="mono">loading…</div>
        : warn.status === 'unavailable' ? <div className="mono">Warning information temporarily unavailable.</div>
        : (
          <>
            <div className="row">
              {alerts.map((a, i) => (
                <button key={i} className={`btn ${i === sel ? '' : 'ghost'}`} onClick={() => setSel(i)}>
                  {a.severity} · {(a.hazard || a.event || '').slice(0, 18)}
                </button>
              ))}
              {alerts.length === 0 && <span className="mono">No active alerts.</span>}
            </div>
            {cur && (
              <div className="warnbox">
                <span className={`sev ${cur.severity}`}>{cur.severity}</span>
                <div className="evbox">
                  {CAP_FIELDS.map((f) => cur[f] ? (
                    <div className="evrow" key={f}><span className="k">{f}</span><span>{String(cur[f]).slice(0, 160)}</span></div>
                  ) : null)}
                  <div className="evrow"><span className="k">source</span><span>{cur.source} · OFFICIAL</span></div>
                </div>
              </div>
            )}
          </>
        )}
      <h2 style={{ marginTop: 14 }}>Community reports</h2>
      <div className="sub">User observations — <b>COMMUNITY, never official</b>. Never auto-promoted to warnings.</div>
      {reports.map((r) => (
        <div className="evrow" key={r.report_id}>
          <span className="k">{r.report_type} · {r.district}</span>
          <span>{r.text} <span className="prov DEMO">COMMUNITY</span></span>
        </div>
      ))}
      <form onSubmit={submitReport} className="row">
        <select value={form.report_type} onChange={(e) => setForm({ ...form, report_type: e.target.value })}>
          {['flooding', 'road_blocked', 'fallen_tree', 'damage', 'waterlogging'].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input type="text" placeholder="What do you see?" value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })} style={{ flex: 1 }} />
        <button className="btn" type="submit">Report</button>
      </form>
    </section>
  );
}
