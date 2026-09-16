import { useEffect, useState } from 'react';
import { api } from '../api';

export default function SourceStrip({ refreshKey }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.sources().then(setData).catch(() => setData({ sources: [], demo_mode: true }));
  }, [refreshKey]);
  if (!data) return <div className="mono">probing sources…</div>;
  return (
    <div>
      <div className="src-strip">
        {(data.sources || []).map((s) => (
          <span className="chip" key={s.name} title={s.detail || s.status}>
            <span className={`dot ${s.status}`} />{s.name} · {s.status}
          </span>
        ))}
      </div>
      {data.needs_keys && Object.values(data.needs_keys).some(Boolean) && (
        <div className="mono" style={{ marginTop: 6 }}>
          key-gated: {Object.entries(data.needs_keys).filter(([, v]) => v).map(([k]) => k).join(' · ')} — adapters report, never fake
        </div>
      )}
    </div>
  );
}
