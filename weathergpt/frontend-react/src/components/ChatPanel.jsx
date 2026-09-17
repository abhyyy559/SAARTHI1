// Chat: the main feature. Questions carry WHO the user is (persona) and WHERE
// they are (district) - the backend answers, advises and assesses risk for that
// person in that place, in the selected language. Answers are spoken aloud in
// the selected language (user can mute). Question chips match the persona.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { t, PERSONA_LABELS, PERSONA_QUESTIONS } from '../i18n';
import { useApp } from '../store';
import { answerOffline } from '../offline';
import Icon from './icons';

export default function ChatPanel() {
  const { lang, persona, handleResult, registerAsk, pendingAskRef, speak, stopSpeaking, loc } = useApp();
  const [log, setLog] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showEv, setShowEv] = useState({});
  const logRef = useRef(null);
  const SUGGESTIONS = PERSONA_QUESTIONS[persona] || PERSONA_QUESTIONS.general;

  const ask = useCallback(async (text) => {
    const q = (typeof text === 'string' && text ? text : input).trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    setLog((l) => [...l, { role: 'user', text: q }]);
    try {
      const r = await api.chat({
        message: q, latitude: loc.lat, longitude: loc.lon, language: lang, user_type: persona,
      });
      setLog((l) => [...l, {
        role: 'bot', text: r.answer, evidence: r.evidence || [],
        risk: r.risk, warning: r.warning, id: Date.now(),
      }]);
      handleResult({ ...r, _context: `${lang}:${persona}:${loc.district}` });
      // Voice-first: answers are spoken aloud via the server TTS in the
      // selected language (Sarvam when configured, browser voice otherwise).
      if (!muted) speak(r.answer);
    } catch {
      const off = answerOffline(q, lang);
      setLog((l) => [...l, {
        role: 'bot', text: `${off}\n(backend unreachable - nothing invented.)`,
        evidence: [], id: Date.now(),
      }]);
    }
    setBusy(false);
  }, [input, busy, lang, persona, handleResult, speak, muted, loc]);

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
      <p className="sub">
        {t(lang, 'askAs')} <b>{(PERSONA_LABELS[lang] && PERSONA_LABELS[lang][persona]) || persona}</b>
        {' · '}{loc.district}
      </p>
      <div className="chatlog" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
        {log.length === 0 && (
          <p className="empty">{t(lang, 'chatEmpty')}</p>
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
                    <span>{m.risk.level}{m.risk.reason ? ` - ${m.risk.reason}` : ''} (not an IMD rating)</span>
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
        <button
          type="button"
          className="btn ghost sm"
          aria-pressed={muted}
          onClick={() => { stopSpeaking(); setMuted((m) => !m); }}
          title="Spoken answers"
        >
          <Icon name="speaker" size={14} />{muted ? t(lang, 'muted') : t(lang, 'soundOn')}
        </button>
      </div>
    </section>
  );
}