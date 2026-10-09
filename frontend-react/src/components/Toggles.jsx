import { useEffect, useState } from 'react';
import { readPref, useApp, writePref } from '../lib/appState';
import { t } from '../lib/i18n';
import { pushOff, pushOn, pushState, pushTest } from '../lib/push';
import { Icon } from './Icons';

function Switch({ on, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch"
      disabled={disabled} onClick={() => onChange(!on)} />
  );
}

// Lock-screen alerts for the chosen district.
export function PushToggle() {
  const { lang, loc, persona } = useApp();
  const [state, setState] = useState('loading');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')); }, []);

  const toggle = async (want) => {
    setBusy(true); setNote('');
    try {
      setState(want ? await pushOn({ district: loc.district, language: lang, persona }) : await pushOff());
    } catch {
      setNote(t(lang, 'alertsError'));
    }
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    setNote(t(lang, (await pushTest().catch(() => false)) ? 'alertsTestSent' : 'alertsError'));
    setBusy(false);
  };

  const on = state === 'on';
  const blocked = { unsupported: 'alertsUnsupported', 'no-sw': 'alertsNeedApp', denied: 'alertsDenied' }[state];
  return (
    <section className={`toggle-card ${on ? 'is-on' : ''}`}>
      <div className="toggle-row">
        <Icon name="bell" size={30} />
        <div className="toggle-words">
          <b>{t(lang, 'alertsOnTitle')}</b>
          <span className="muted">{blocked ? t(lang, blocked) : t(lang, on ? 'alertsOnBody' : 'alertsOffBody', { d: loc.district })}</span>
        </div>
        {!blocked && state !== 'loading'
          ? <Switch on={on} onChange={toggle} disabled={busy} label={t(lang, on ? 'turnOff' : 'turnOn')} />
          : null}
      </div>
      {on ? (
        <button type="button" className="btn-ghost" onClick={test} disabled={busy}>
          <Icon name="send" size={18} /> {t(lang, 'alertsTest')}
        </button>
      ) : null}
      {note ? <p className="note">{note}</p> : null}
    </section>
  );
}

export function applyTheme(theme) {
  try { document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'; } catch { /* no DOM */ }
}

// Sunlight mode: a light screen is easier to read outdoors in bright sun.
export function ThemeToggle() {
  const { lang } = useApp();
  const [light, setLight] = useState(() => readPref('theme', 'dark') === 'light');
  return (
    <section className="toggle-card">
      <div className="toggle-row">
        <Icon name="sun" size={30} />
        <div className="toggle-words"><b>{t(lang, 'sunlight')}</b></div>
        <Switch on={light} label={t(lang, 'sunlight')} onChange={(v) => {
          setLight(v); writePref('theme', v ? 'light' : 'dark'); applyTheme(v ? 'light' : 'dark');
        }} />
      </div>
    </section>
  );
}

// Read the safety card aloud when Today opens (helps people who do not read).
export function AutoSpeakToggle() {
  const { lang } = useApp();
  const [on, setOn] = useState(() => readPref('autoSpeak', true));
  return (
    <section className="toggle-card">
      <div className="toggle-row">
        <Icon name="speaker" size={30} />
        <div className="toggle-words"><b>{t(lang, 'autoSpeak')}</b></div>
        <Switch on={on} label={t(lang, 'autoSpeak')} onChange={(v) => { setOn(v); writePref('autoSpeak', v); }} />
      </div>
    </section>
  );
}
