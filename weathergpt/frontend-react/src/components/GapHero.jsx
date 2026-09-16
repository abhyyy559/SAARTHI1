import { useEffect, useState } from 'react';
import { api, HYD } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';

// THE SEALS BOARD - the dossier's single theatrical surface. Every data
// authority appears as a wax seal on dark lacquer; the headline is the gap
// itself, proved live by two real models disagreeing on the same district.
const SEAL_LABEL = {
  LIVE: 'live',
  CACHED: 'cached',
  DEMO: 'demo',
  READY: 'ready',
  UNCONFIGURED: 'unconfigured',
  UNAVAILABLE: 'unavailable',
  OFFLINE: 'offline',
  ERROR: 'offline',
};

export default function GapHero() {
  const { lang, sources, setView } = useApp();
  const [proof, setProof] = useState(null);

  useEffect(() => {
    let alive = true;
    api.models(HYD.lat, HYD.lon)
      .then((d) => { if (alive) setProof(d.comparison || null); })
      .catch(() => { if (alive) setProof(null); });
    return () => { alive = false; };
  }, []);

  const g = proof?.models?.GFS;
  const e = proof?.models?.['ECMWF-IFS'];

  const adapters = (sources?.adapters || []).slice(0, 7);

  return (
    <section className="seals" aria-label="Verification dossier cover">
      <div className="seals-top">
        <span>{t(lang, 'tag')}</span>
        <span className="seals-rule" aria-hidden="true" />
        <span>SIH 2026 · 26068</span>
      </div>
      <h1 className="seals-title">{t(lang, 'gapTitle')}</h1>
      <p className="seals-sub">{t(lang, 'gapSub')}</p>

      <div className="seals-grid">
        {(adapters.length ? adapters : [{ name: 'sources', status: '…' }]).map((a) => (
          <button
            key={a.name}
            type="button"
            className="seal"
            onClick={() => setView('trust')}
            title={`${a.name}: ${a.status}`}
          >
            <span className={`dot ${a.status}`} data-status={a.status} />
            <b>{a.name}</b>
            <span>{SEAL_LABEL[a.status] || String(a.status || '…').toLowerCase()}</span>
          </button>
        ))}
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="k">GFS says (tomorrow rain)</div>
          <div className="v">{g ? `${g.rain_day1} mm` : '…'}</div>
        </div>
        <div className="stat">
          <div className="k">ECMWF says (same place)</div>
          <div className="v">{e ? `${e.rain_day1} mm` : '…'}</div>
        </div>
        <div className="stat">
          <div className="k">WeatherGPT does</div>
          <div className="v" style={{ fontSize: '.95rem' }}>
            {proof ? `Agreement ${proof.agreement} - confidence, not false certainty` : '…'}
          </div>
        </div>
      </div>
    </section>
  );
}
