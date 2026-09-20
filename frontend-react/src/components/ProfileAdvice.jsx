// ProfileAdvice — My advice. Advisory ONLY lives here; Ask never shows it.
//
// The advisory text is split into numbered dispatch cards — one actionable
// step per card — with the decision-support disclaimer pinned at the bottom.
// Advice comes from the backend advisory service; nothing is re-derived here.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, PERSONA_LABELS } from '../i18n';
import { useApp } from '../store';
import { Card } from './ui';
import Icon from './icons';

export default function ProfileAdvice() {
  const { loc, persona, lang, speak, syncTick, setView, setPendingAsk } = useApp();
  const [response, setResponse] = useState(null);
  const key = `${loc.lat}:${loc.lon}:${persona}:${lang}`;
  useEffect(() => {
    let active = true;
    api.profileAdvisory(loc, persona, lang)
      .then((data) => { if (active) setResponse({ key, data }); })
      .catch(() => { if (active) setResponse({ key, error: true }); });
    return () => { active = false; };
  }, [loc, persona, lang, key, syncTick]);
  const current = response?.key === key ? response : null;

  // Dispatch cards: one sentence per numbered card, in server order. The
  // numbering is the card's identity — it says "do this, then this".
  const text = current && !current.error ? String(current.data.advisory || '').trim() : '';
  const steps = text ? text.split(/(?<=[.!?।])\s+/).map((s) => s.trim()).filter(Boolean) : [];
  const personaLabel = (PERSONA_LABELS[lang] && PERSONA_LABELS[lang][persona]) || persona;

  return (
    <Card title={`${t(lang, 'adviceFor')} · ${personaLabel}`} sub={t(lang, 'adviceNote')}>
      <div role="status" aria-live="polite">
        {!current ? <p className="mono">{t(lang, 'checking')}</p>
          : current.error ? <p className="sub">{t(lang, 'adviceFailed')}</p>
            : steps.length === 0 ? <p className="sub">{t(lang, 'adviceFailed')}</p>
              : <div className="dispatch-list">
                {steps.map((step, i) => (
                  <article className="dispatch-card" key={i}>
                    <span className="dispatch-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                    <p className="dispatch-text">{step}</p>
                  </article>
                ))}
              </div>}
      </div>
      {current?.data?.caveat && <div className="sub" style={{ marginTop: 8 }}>{current.data.caveat}</div>}
      {current?.data && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn btn-ghost sm" type="button" onClick={() => speak(current.data.advisory)} aria-label={t(lang, 'alertsListen')}>
            <Icon name="speaker" size={14} /> {t(lang, 'alertsListen')}
          </button>
          <button className="btn btn-ghost sm" type="button" onClick={() => { setPendingAsk(`Explain this advice for a ${persona} in ${loc.district}: ${current.data.advisory}`); setView('ask'); }}>
            {t(lang, 'homeAskAbout')}
          </button>
          <span className="mono sub">{current.data.provenance}</span>
        </div>
      )}
      {/* Decision-support disclaimer, always on screen. */}
      <p className="disclaimer" style={{ marginTop: 12 }}>
        <Icon name="alert" size={16} aria-hidden /> {t(lang, 'sbDisclaimer')}
      </p>
    </Card>
  );
}
