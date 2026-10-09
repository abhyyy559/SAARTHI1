import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/appState';
import { LANGS, t } from '../lib/i18n';
import { ROLES } from '../lib/weather';
import { speak } from '../lib/voice';
import { Icon } from './Icons';

export function LangPicker() {
  const { lang, setLang } = useApp();
  return (
    <div className="pick-langs" role="radiogroup" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={lang === l.id}
          className={`pick-lang ${lang === l.id ? 'is-on' : ''}`}
          onClick={() => { setLang(l.id); speak(l.name, l.id, `lang-${l.id}`); }}>
          <span className="glyph">{l.glyph}</span>
          <span>{l.name}</span>
        </button>
      ))}
    </div>
  );
}

export function PlacePicker({ onPicked }) {
  const { lang, loc, setLoc } = useApp();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);

  const choose = (p) => {
    setLoc({ district: p.district, state: p.state, lat: p.latitude, lon: p.longitude, coastal: p.coastal });
    setStatus('');
    onPicked?.();
  };

  const findMe = () => {
    if (!navigator.geolocation) { setStatus('denied'); return; }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await api.resolve(pos.coords.latitude, pos.coords.longitude);
          choose(r.location);
        } catch { setStatus('denied'); }
      },
      () => setStatus('denied'),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
    );
  };

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return undefined; }
    const id = setTimeout(() => { api.search(q.trim()).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="pick-place">
      <button type="button" className="btn-big" onClick={findMe} disabled={status === 'locating'}>
        <Icon name="pin" size={26} /> {status === 'locating' ? t(lang, 'locating') : t(lang, 'findMe')}
      </button>
      {status === 'denied' ? <p className="warn-note">{t(lang, 'locDenied')}</p> : null}
      <label className="search">
        <Icon name="search" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'searchPlace')} aria-label={t(lang, 'searchPlace')} />
      </label>
      <ul className="results">
        {results.map((p) => (
          <li key={`${p.district}-${p.state}`}>
            <button type="button" onClick={() => choose(p)} className={loc?.district === p.district ? 'is-on' : ''}>
              <Icon name={p.coastal ? 'waves' : 'pin'} size={22} /> <b>{p.district}</b> <span className="muted">{p.state}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RoleGrid({ onPicked }) {
  const { lang, persona, personaChosen, setPersona } = useApp();
  return (
    <div className="pick-roles">
      {ROLES.map((r) => (
        <button key={r.id} type="button" className={`pick-role ${personaChosen && persona === r.id ? 'is-on' : ''}`}
          onClick={() => { setPersona(r.id); onPicked?.(); }}>
          <Icon name={r.icon} size={64} />
          <span>{t(lang, r.key)}</span>
        </button>
      ))}
    </div>
  );
}

// First run: three picture steps. Nothing is assumed: no silent default
// place, no silent default role.
export default function Setup({ onDone }) {
  const { lang, loc } = useApp();
  const [step, setStep] = useState(0);
  return (
    <div className="setup">
      <div className="setup-brand"><span className="logo"><Icon name="partly" size={52} /></span><span>WeatherGPT</span></div>
      <ol className="steps" aria-hidden="true">
        {[0, 1, 2].map((i) => <li key={i} className={i <= step ? 'is-on' : ''} />)}
      </ol>
      {step === 0 ? (
        <>
          <h1 className="setup-q"><Icon name="globe" size={28} /> भाषा · Language · భాష</h1>
          <LangPicker />
          <button type="button" className="btn-big" onClick={() => setStep(1)}><Icon name="check" size={24} /> {t(lang, 'done')}</button>
        </>
      ) : null}
      {step === 1 ? (
        <>
          <h1 className="setup-q"><Icon name="pin" size={28} /> {t(lang, 'place')}</h1>
          <PlacePicker onPicked={() => setStep(2)} />
          {loc ? <button type="button" className="btn-ghost" onClick={() => setStep(2)}>{loc.district} <Icon name="check" size={18} /></button> : null}
        </>
      ) : null}
      {step === 2 ? (
        <>
          <h1 className="setup-q"><Icon name="user" size={28} /> {t(lang, 'role')}</h1>
          <RoleGrid onPicked={onDone} />
        </>
      ) : null}
    </div>
  );
}
