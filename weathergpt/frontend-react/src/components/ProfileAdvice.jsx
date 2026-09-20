import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, PERSONA_LABELS } from '../i18n';
import { useApp } from '../store';
import { Card } from './ui';
import { splitAdvisory } from '../format';

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
  // Lead sentence big; context ('Note: ...') hides behind a disclosure.
  const split = current && !current.error ? splitAdvisory(current.data.advisory) : null;
  return <Card title={`${t(lang, 'adviceFor')} · ${PERSONA_LABELS[lang]?.[persona] || persona}`} sub={t(lang, 'adviceNote')}>
    <div role="status">
      {!current ? t(lang, 'checking')
        : current.error ? t(lang, 'adviceFailed')
        : <>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', lineHeight: 1.55 }}>{split.lead}</div>
            {/* Visible, not collapsed: this is the sentence that differs per
                profile. Folding it away made "Guidance for you" identical for
                every occupation. */}
            {split.detail && <p className="sub" style={{ marginTop: 6 }}>{split.detail}</p>}
          </>}
    </div>
    {current?.data?.caveat && <div className="sub" style={{ marginTop: 6 }}>{current.data.caveat}</div>}
    {current?.data && <div className="row">
      <button className="btn ghost" type="button" onClick={() => speak(current.data.advisory)}>{t(lang, 'replay')}</button>
      <button className="btn ghost" type="button" onClick={() => { setPendingAsk(`Explain this advice for a ${persona} in ${loc.district}: ${current.data.advisory}`); setView('ask'); }}>{t(lang, 'homeAskAbout')}</button>
      <span className="sub">{current.data.provenance}</span>
    </div>}
  </Card>;
}
