import { useCallback, useEffect, useState } from 'react';
import { api, HYD } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { answerOffline } from '../offline';
import Icon from './icons';

// Persona-aware question chips: the user sees questions that make sense for them.
const PERSONA_QUESTIONS = {
  fisherman: ['q1', 'q2', 'q3'],
  farmer: ['q1', 'q4', 'q3'],
  driver: ['q1', 'q3'],
  researcher: ['q1', 'q3'],
  disaster_manager: ['q1', 'q3'],
  general: ['q1', 'q2', 'q3'],
};

export default function ChatPanel() {
  const { lang, persona, handleResult, registerAsk, pendingAskRef, speak } = useApp();
  const [log, setLog] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEv, setShowEv] = useState({});
  const SUGGESTIONS = PERSONA_QUESTIONS[persona] || PERSONA_QUESTIONS.general;

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
      // Voice-first: answers are spoken aloud via the server TTS in the
      // selected language (Sarvam when configured, browser voice otherwise).
      speak(r.answer);
    } catch {
      const off = answerOffline(q, lang);
      setLog((l) => [...l, {
        role: 'bot', text: `${off}\n(backend unreachable - nothing invented.)`,
        evidence: [], id: Date.now(),
      }]);
    }
    setBusy(false);
  }, [input, busy, lang, persona, handleResult, speak]);

  // Publish this handler for the voice panel and the safety probe. Registered from
  // an EFFECT (never during render) - which is also what kept it off the lint list.
  useEffect(() => {
    registerAsk(ask);
    return () => registerAsk(null);
  }, [ask, registerAsk]);

  // A question raised on Home (tap or voice) is consumed once here on mount.
  useEffect(() => {
    if (!pendingAskRef.current) return undefined;
    const text = pendingAskRef.current;
    pendingAskRef.current = null;
    ask(text);
    return undefined;
  }, [pendingAskRef, ask]);

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
        {SUGGESTIONS.map((k) => (
          <button key={k} type="button" className="btn ghost sm" onClick={() => ask(t(lang, k))} disabled={busy}>
            {t(lang, k)}
          </button>
        ))}
      </div>
    </section>
  );
}