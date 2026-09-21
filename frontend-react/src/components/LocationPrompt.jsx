// Location permission gate. Full-card form on its own; compact inline
// actions when embedded in the dispatch strip. The manual fallback is a
// PREDEFINED district chip grid (the same curated list the Home hero
// offers) — typing free text forced users to guess district names and
// wait on a search round-trip; one tap from a fixed list cannot miss.
import { useState } from 'react';
import { t, DISTRICTS } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

export default function LocationPrompt({ inline = false }) {
  const { lang, locStatus, locNote, requestLocation, setDistrict } = useApp();
  const [showPicks, setShowPicks] = useState(false);

  if (locStatus === 'ready') return null;

  const busy = locStatus === 'requesting' || locStatus === 'resolving';

  const cta = (locStatus === 'idle' || locStatus === 'denied' || locStatus === 'error') && (
    <button type="button" className={`btn${inline ? ' sm btn-secondary' : ''}`} onClick={requestLocation} disabled={busy}>
      <Icon name="pin" size={16} />
      {t(lang, locStatus === 'idle' ? 'locCta' : 'locRetry')}
    </button>
  );

  const pickBlock = (
    <div className="chip-row" style={{ marginTop: 8, ...(inline ? { flexBasis: '100%' } : {}) }}>
      {showPicks
        ? DISTRICTS.map((d) => (
          <button
            key={d.district}
            type="button"
            className={`chip${loc.district === d.district ? ' is-active' : ''}`}
            aria-pressed={loc.district === d.district}
            onClick={() => setDistrict(d)}
          >
            {d.district}
          </button>
        ))
        : (
          <button type="button" className="btn btn-ghost sm" onClick={() => setShowPicks(true)} aria-expanded={showPicks}>
            {t(lang, 'locPickPh')}
          </button>
        )}
    </div>
  );

  if (inline) {
    return (
      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', maxWidth: '100%' }}>
        {busy && <span role="status" className="mono" style={{ color: 'var(--ink-soft)' }}>{t(lang, locStatus === 'requesting' ? 'locLocating' : 'locResolving')}</span>}
        {cta}
        <button
          type="button"
          className="btn btn-ghost sm"
          onClick={() => setShowPicks((s) => !s)}
          aria-expanded={showPicks}
        >
          {t(lang, 'locPickPh')}
        </button>
        {showPicks && pickBlock}
      </div>
    );
  }

  return (
    <div className="card" role="region" aria-label={t(lang, 'locTitle')}>
      <div className="card-head">
        <div className="card-head-text">
          <h2 className="card-title">{t(lang, 'locTitle')}</h2>
          <p className="sub">{t(lang, 'locSub')}</p>
        </div>
      </div>
      <div className="row">
        <Icon name="pin" size={30} />
        {cta}
        <button type="button" className="btn btn-ghost" onClick={() => setShowPicks((s) => !s)} aria-expanded={showPicks}>
          {t(lang, 'locPickPh')}
        </button>
      </div>
      {busy && <p role="status" className="mono">{t(lang, locStatus === 'requesting' ? 'locLocating' : 'locResolving')}</p>}
      {locNote && locStatus !== 'idle' && !busy && <p className="mono">{locNote}</p>}
      {showPicks && pickBlock}
    </div>
  );
}
