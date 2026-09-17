import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, PERSONA_LABELS } from '../i18n';
import { useApp } from '../store';
import { Card } from './ui';

export default function ProfileAdvice() {
  const { loc, persona, lang, speak } = useApp();
  const [response, setResponse] = useState(null);
  const key = `${loc.lat}:${loc.lon}:${persona}:${lang}`;
  useEffect(() => {
    let active = true;
    api.profileAdvisory(loc, persona, lang)
      .then((data) => { if (active) setResponse({ key, data }); })
      .catch(() => { if (active) setResponse({ key, error: true }); });
    return () => { active = false; };
  }, [loc, persona, lang, key]);
  const current = response?.key === key ? response : null;
  return <Card title={`${t(lang, 'adviceFor')} · ${PERSONA_LABELS[lang]?.[persona] || persona}`} sub={t(lang, 'adviceNote')}>
    <div role="status">
      {!current ? t(lang, 'checking') : current.error ? t(lang, 'adviceFailed') : current.data.advisory}
    </div>
    {current?.data && <div className="row">
      <button className="btn ghost" type="button" onClick={() => speak(current.data.advisory)}>{t(lang, 'replay')}</button>
      <span className="sub">{current.data.provenance}</span>
    </div>}
  </Card>;
}
