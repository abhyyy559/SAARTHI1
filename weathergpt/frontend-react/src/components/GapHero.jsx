import { useEffect, useState } from 'react';
import { api, HYD } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import SourceStrip from './SourceStrip';

// The gap, with live proof: two real NWP models disagreeing on the same district.
export default function GapHero() {
  const { lang } = useApp();
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

  return (
    <section className="card hero">
      <span className="tag">{t(lang, 'tag')}</span>
      <h2 className="hero-title">{t(lang, 'gapTitle')}</h2>
      <p className="lede">{t(lang, 'gapSub')}</p>
      <SourceStrip refreshKey={0} />
      <div className="stat-grid">
        <div className="stat">
          <div className="k">GFS SAYS (TOMORROW RAIN)</div>
          <div className="v">{g ? `${g.rain_day1} mm` : '...'}</div>
        </div>
        <div className="stat">
          <div className="k">ECMWF SAYS (SAME PLACE)</div>
          <div className="v">{e ? `${e.rain_day1} mm` : '...'}</div>
        </div>
        <div className="stat">
          <div className="k">WEATHERGPT DOES</div>
          <div className="v" style={{ fontSize: '.95rem' }}>
            {proof ? `Agreement ${proof.agreement} - confidence, not false certainty` : '...'}
          </div>
        </div>
      </div>
    </section>
  );
}
