import { useCallback, useEffect, useState } from 'react';
import { api, HYD } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { answerOffline } from '../offline';
import Icon from './icons';

const SUGGESTIONS = [
  'Will it rain in Hyderabad tomorrow?',
  'Is there any dangerous weather near me?',
  'Is there a red alert right now?',
];

export default function ChatPanel() {
  const { lang, persona, handleResult, registerAsk } = useApp();
  const [log, setLog] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEv, setShowEv] = useState({});

  const ask = useCallback(async (text) => {
    const q = (typeof text === 'string' && text ? text : input).trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    setLog((l) => [...l, { role: 'user', text: q }]);
    try {
      const r = await api.chat({
        message: q, latitude: HYD.lat, longitude: HYD.lon, language: lang, user_type: persona,
      });
      setLog((l) => [...l, {
        role: 'bot', text: r.answer, evidence: r.evidence || [],
        risk: r.risk, warning: r.warning, id: Date.now(),
      }]);
      handleResult(r);
    } catch {
      const off = answerOffline(q, lang);
      setLog((l) => [...l, {
        role: 'bot', text: `${off}\n(backend unreachable - nothing invented.)`,
        evidence: [], id: Date.now(),
      }]);
    }
    setBusy(false);
  }, [input, busy, lang, persona, handleResult]);

  // Publish this handler for the voice panel and the safety probe. Registered from
  // an EFFECT (never during render) - which is also what kept it off the lint list.
  useEffect(() => {
    registerAsk(ask);
    return () => registerAsk(null);
  }, [ask, registerAsk]);

  return (
    <section className="card" aria-label="Conversation">
      <p className="sub">Grounded in retrieved data. Every fact carries provenance.</p>
      <div className="chatlog" role="log" aria-live="polite" aria-relevant="additions">
        {log.length === 0 && (
          <p className="empty">No queries yet - ask about rain, warnings, travel or climate.</p>
        )}
        {log.map((m, i) => (
          <div className={`msg ${m.role}`} key={i}>
            {m.text}
            {m.role === 'bot' && m.evidence && m.evidence.length > 0 && (
              <div className="ev">
                {m.evidence.map((e, k) => (
                  <span key={k}>
                    {e.source}/{e.type} <span className={`prov ${e.provenance}`}>{e.provenance}</span>
                  </span>
                ))}
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setShowEv((s) => ({ ...s, [m.id]: !s[m.id] }))}
                  aria-expanded={!!showEv[m.id]}
                >
                  <Icon name="eye" size={14} />{t(lang, 'why')}
                </button>
              </div>
            )}
            {showEv[m.id] && (
              <div className="evbox">
                {m.evidence.map((e, k) => (
                  <div className="evrow" key={k}>
                    <span className="k">{e.source} - {e.type}</span>
                    <span>
                      {e.issued_at || '-'}
                      {e.valid_until ? ` to ${e.valid_until}` : ''}{' '}
                      <span className={`prov ${e.provenance}`}>{e.provenance}</span>
                    </span>
                  </div>
                ))}
                <div className="evrow">
                  <span className="k">AI role</span>
                  <span>Interpretation only - severity never modified</span>
                </div>
                {m.risk && (
                  <div className="evrow">
                    <span className="k">WeatherGPT risk</span>
                    <span>{m.risk.level} (not an IMD rating)</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <form className="chatrow" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input
          type="text"
          placeholder={t(lang, 'askPh')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label={t(lang, 'askPh')}
        />
        <button className="btn" type="submit" disabled={busy}>
          <Icon name="send" />{busy ? '...' : t(lang, 'send')}
        </button>
      </form>
      <div className="row">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="btn ghost sm" onClick={() => ask(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}