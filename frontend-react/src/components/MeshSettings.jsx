// Settings rows for the phone-to-phone relay and (in the Android app) the
// server address. Rendered inside SettingsPanel's Row cards.
import { useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';
import { cleanServer, savedServer, setServer } from '../serverBase';
import { myName, setMyName, start, stop, useMesh } from '../mesh/meshClient';
import { RelayStatus } from './Nearby';

export function MeshSettings() {
  const { lang } = useApp();
  const mesh = useMesh();
  const on = !!(mesh.status && mesh.status.running);
  const [name, setName] = useState(myName);
  return (
    <div className="set-mesh">
      <p className="sub" style={{ margin: '0 0 8px' }}>{t(lang, 'meshSettingsBody')}</p>
      <button type="button" role="switch" aria-checked={on} className="switch-row" onClick={() => (on ? stop() : start())}>
        <span className="sub">{t(lang, on ? 'meshRelayOn' : 'meshRelayOff')}</span>
        <span className={`switch${on ? ' is-on' : ''}`} aria-hidden="true">
          <span className="switch-track"><span className="switch-thumb" /></span>
        </span>
      </button>
      <div style={{ marginTop: 10 }}><RelayStatus compact /></div>
      <label className="set-field">
        <span>{t(lang, 'meshYourName')}</span>
        <input
          className="input"
          type="text"
          maxLength={40}
          value={name}
          onChange={(e) => { setName(e.target.value); setMyName(e.target.value); }}
        />
        <span className="sub">{t(lang, 'meshNameHint')}</span>
      </label>
    </div>
  );
}

export function ServerSettings() {
  const { lang } = useApp();
  const [value, setValue] = useState(savedServer);
  const [saved, setSaved] = useState(false);
  const save = (e) => {
    e.preventDefault();
    setValue(setServer(value));
    setSaved(true);
    // Everything on screen came from the old address: reload from the new one.
    setTimeout(() => window.location.reload(), 600);
  };
  return (
    <form className="set-field" onSubmit={save}>
      <span className="sub">{t(lang, 'meshServerBody')}</span>
      <div className="set-inline">
        <input
          className="input"
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="http://192.168.1.20:8000"
          aria-label={t(lang, 'meshServerTitle')}
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          onBlur={() => setValue((v) => cleanServer(v))}
        />
        <button type="submit" className="btn btn-signal">{t(lang, saved ? 'meshServerSaved' : 'meshServerSave')}</button>
      </div>
    </form>
  );
}
