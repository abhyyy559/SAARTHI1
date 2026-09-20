// Location permission gate. Full-card form on its own; compact inline
// actions when embedded in the dispatch strip (right-aligned "ALLOW
// LOCATION" + "Or type your district" toggling the input).
import { useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

export default function LocationPrompt({ inline = false }) {
  const { lang, locStatus, locNote, requestLocation, setDistrict } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [manual, setManual] = useState(false);

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

  const cta = (locStatus === 'idle' || locStatus === 'denied' || locStatus === 'error') && (
    <button type="button" className={`btn${inline ? ' sm btn-secondary' : ''}`} onClick={requestLocation} disabled={busy}>
      <Icon name="pin" size={16} />
      {t(lang, locStatus === 'idle' ? 'locCta' : 'locRetry')}
    </button>
  );

  const manualBlock = manual && (
    <div className="row" style={{ marginTop: 8, ...(inline ? { flexBasis: '100%' } : {}) }}>
      <input
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t(lang, 'locManualPh')}
        aria-label={t(lang, 'locManualPh')}
        onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
        style={{ flex: '1 1 auto', minWidth: 0 }}
      />
      <button type="button" className="btn sm" onClick={search} disabled={searching || busy}>
        {t(lang, 'locManualGo')}
      </button>
    </div>
  );

  const resultBlock = results.length > 0 && (
    <div className="chip-row" style={{ marginTop: 8, ...(inline ? { flexBasis: '100%' } : {}) }}>
      {results.some((r) => r.suggested) && (
        <span className="mono" style={{ flexBasis: '100%' }}>{t(lang, 'didYouMean')}:</span>
      )}
      {results.map((r) => (
        <button key={r.district} type="button" className="chip" onClick={() => setDistrict(r)}>
          {r.district}
        </button>
      ))}
    </div>
  );

  if (inline) {
    return (
      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', maxWidth: '100%' }}>
        {busy && <span role="status" className="mono" style={{ color: 'var(--signal)' }}>{t(lang, locStatus === 'requesting' ? 'locLocating' : 'locResolving')}</span>}
        {cta}
        <button
          type="button"
          className="btn btn-ghost sm"
          style={{ color: 'var(--ink)', borderColor: 'var(--line-soft)' }}
          onClick={() => setManual((m) => !m)}
          aria-expanded={manual}
        >
          {t(lang, 'locManualPh')}
        </button>
        {manualBlock}
        {resultBlock}
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
        <button type="button" className="btn btn-ghost" onClick={() => setManual((m) => !m)} aria-expanded={manual}>
          {t(lang, 'locManualPh')}
        </button>
      </div>
      {busy && <p role="status" className="mono">{t(lang, locStatus === 'requesting' ? 'locLocating' : 'locResolving')}</p>}
      {locNote && locStatus !== 'idle' && !busy && <p className="mono">{locNote}</p>}
      {manualBlock}
      {resultBlock}
    </div>
  );
}
