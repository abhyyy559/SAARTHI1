// Location permission gate: one compact icon-led row, not a full card.
// Browser geolocation → backend GIS resolve. Manual search hides behind
// a disclosure so it never competes with the TopBar district picker.
import { useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

export default function LocationPrompt() {
  const { lang, locStatus, locNote, requestLocation, setDistrict } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  if (locStatus === 'ready') return null;

  const busy = locStatus === 'requesting' || locStatus === 'resolving';

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      setResults(await api.searchLocation(q));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="card" role="region" aria-label={t(lang, 'locTitle')}>
      <div className="row" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ width: 30, height: 30, color: 'var(--accent)', flexShrink: 0 }}>
          <Icon name="pin" size={30} />
        </span>
        <span className="sub" style={{ flex: '1 1 200px' }}>{t(lang, 'locSub')}</span>
        {(locStatus === 'idle' || locStatus === 'denied' || locStatus === 'error') && (
          <button type="button" className="btn" onClick={requestLocation} disabled={busy}>
            {t(lang, locStatus === 'idle' ? 'locCta' : 'locRetry')}
          </button>
        )}
      </div>
      {busy && <p role="status" className="mono">{t(lang, locStatus === 'requesting' ? 'locLocating' : 'locResolving')}</p>}
      {locNote && locStatus !== 'idle' && !busy && <p className="mono">{locNote}</p>}
      <details style={{ marginTop: 8 }}>
        <summary className="mono">{t(lang, 'locManualPh')}</summary>
        <div className="row" style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(lang, 'locManualPh')}
            aria-label={t(lang, 'locManualPh')}
            onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
          />
          <button type="button" className="btn ghost" onClick={search} disabled={searching || busy}>
            {t(lang, 'locManualGo')}
          </button>
        </div>
        {results.length > 0 && (
          <div className="quick-row" style={{ marginTop: 8 }}>
            {results.some((r) => r.suggested) && (
              <span className="mono" style={{ flexBasis: '100%' }}>{t(lang, 'didYouMean')}:</span>
            )}
            {results.map((r) => (
              <button key={r.district} type="button" className="btn ghost" onClick={() => setDistrict(r)}>
                {r.district}
              </button>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}
