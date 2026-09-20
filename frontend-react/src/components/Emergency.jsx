// Emergency panel rebuilt for people who cannot read: one huge SOS button, a
// grid of picture tiles for every other message, and an inbox that reads as an
// icon plus one short word. Transport stays underneath - this panel only uses
// the facade operations.
//
// Three delivery facts are never blurred: "queued" (accepted here), "local"
// (still on this device) and "synced" (reached the relay). Nothing is shown as
// delivered that was not, and a failed send says so.
import { useCallback, useEffect, useState } from 'react';
import './AlertCenter.css';
import { api, EMERGENCY_TYPES } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import P2PDemo from './P2PDemo';

// One glyph and one short word per message type - the picture is the label.
const EMG_ICON = {
  NEED_HELP: 'sos',
  IM_HERE: 'pin',
  MEDICAL_HELP: 'activity',
  NEED_WATER: 'drop',
  NEED_FOOD: 'crop',
  DANGER_HERE: 'alert',
  PEOPLE_TRAPPED: 'user',
  ROAD_BLOCKED: 'route',
  IM_SAFE: 'check',
};
const EMG_WORD = {
  NEED_HELP: 'mtHelp',
  IM_HERE: 'mtHere',
  MEDICAL_HELP: 'mtDoctor',
  NEED_WATER: 'mtWater',
  NEED_FOOD: 'mtFood',
  DANGER_HERE: 'mtDanger',
  PEOPLE_TRAPPED: 'mtTrapped',
  ROAD_BLOCKED: 'mtRoad',
  IM_SAFE: 'mtSafe',
};
const iconOf = (type) => EMG_ICON[type] || 'info';
// Unknown type: fall back to the machine value, never to a made-up word.
const wordOf = (lang, type) =>
  (EMG_WORD[type] ? t(lang, EMG_WORD[type]) : String(type).replaceAll('_', ' '));

const DANGER_TYPES = new Set(['DANGER_HERE', 'PEOPLE_TRAPPED']);
// Danger / safe tiles only take their colour while selected - see AlertCenter.css.
const tileClass = (type) =>
  `pick-tile${type === 'IM_SAFE' ? ' pick-safe' : DANGER_TYPES.has(type) ? ' pick-danger' : ''}`;

export default function Emergency() {
  const { loc, lang } = useApp();
  const [form, setForm] = useState({
    message_type: 'NEED_HELP', people_count: 1, medical_required: false, text: '',
  });
  const [inbox, setInbox] = useState([]);
  const [note, setNote] = useState('');
  const [p2p, setP2p] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const d = await api.inbox();
      setInbox(d.messages || []);
    } catch { /* offline - keep what we already have */ }
  }, []);

  // Load from a promise callback (not a synchronous setState in the effect body).
  useEffect(() => {
    let alive = true;
    api.inbox()
      .then((d) => { if (alive) setInbox(d.messages || []); })
      .catch(() => { /* offline - inbox stays empty rather than invented */ });
    return () => { alive = false; };
  }, []);

  // Derived during render instead of held in state.
  const peers = [...new Set(inbox.map((m) => m.sender_id))];

  async function send(messageType) {
    try {
      const r = await api.sos({
        sender_id: 'you',
        ...form,
        message_type: messageType || form.message_type,
        people_count: Number(form.people_count) || 1,
        location: { latitude: loc.lat, longitude: loc.lon },
      });
      setNote(t(lang, 'emgQueued').replace('{id}', r.message_id).replace('{tr}', r.transport));
      refresh();
    } catch {
      setNote(t(lang, 'emgNotSent'));
    }
  }

  async function sync() {
    try {
      const r = await api.syncEmergency();
      setNote(t(lang, 'emgSynced').replace('{n}', r.synced.length).replace('{p}', r.pending.length));
      refresh();
    } catch {
      setNote(t(lang, 'emgSyncFailed'));
    }
  }

  // Stage demo: A->B->C store-and-forward with SIMULATED provenance throughout.
  async function simulate() {
    try {
      const r = await api.simulateRelay({
        sender_id: 'demo-A',
        ...form,
        people_count: Number(form.people_count) || 1,
      });
      setNote(t(lang, 'emgSimNote').replace('{id}', r.message_id));
      if (r.trace) setP2p({ trace: r.trace, properties: r.properties || {} });
      refresh();
    } catch {
      setNote(t(lang, 'emgSimFailed'));
    }
  }

  const step = (d) => setForm((f) => ({ ...f, people_count: Math.max(1, Number(f.people_count) + d) }));

  return (
    <section className="panel emg-cmd">
      <div className="emg-head">
        <Icon name="shield" size={22} />
        <h2>{t(lang, 'emgTitle')}</h2>
      </div>
      <p className="sub">{t(lang, 'emgSub')}</p>

      <p className="emg-eyebrow">{t(lang, 'emgCmdLabel')}</p>
      <button type="button" className="btn danger-solid emg-sos" onClick={() => send('NEED_HELP')}>
        <Icon name="sos" size={30} /> {t(lang, 'emgSos')}
      </button>

      <h3 className="emg-h3">{t(lang, 'emgPick')}</h3>
      <div className="pick-grid">
        {EMERGENCY_TYPES.filter((type) => type !== 'NEED_HELP').map((type) => (
          <button
            key={type}
            type="button"
            className={tileClass(type)}
            aria-pressed={form.message_type === type}
            onClick={() => setForm((f) => ({ ...f, message_type: type }))}
          >
            <Icon name={iconOf(type)} size={24} />
            <span>{wordOf(lang, type)}</span>
          </button>
        ))}
      </div>

      <div className="emg-row">
        <span className="emg-step-label">{t(lang, 'emgPeople')}</span>
        <span className="emg-step">
          <button type="button" onClick={() => step(-1)} aria-label={t(lang, 'emgLess')}>−</button>
          <span className="n">{form.people_count}</span>
          <button type="button" onClick={() => step(1)} aria-label={t(lang, 'emgMore')}>+</button>
        </span>
        <button
          type="button"
          className="pick-tile is-inline"
          aria-pressed={form.medical_required}
          onClick={() => setForm((f) => ({ ...f, medical_required: !f.medical_required }))}
        >
          <Icon name="activity" size={20} />
          <span>{t(lang, 'emgMedical')}</span>
        </button>
      </div>

      <form className="row" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          type="text"
          placeholder={t(lang, 'emgNotePh')}
          aria-label={t(lang, 'emgNotePh')}
          value={form.text}
          onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
          style={{ flex: 1 }}
        />
        <button className="btn" type="submit">
          <Icon name="send" size={14} /> {t(lang, 'emgSend')} · {wordOf(lang, form.message_type)}
        </button>
      </form>

      <div className="emg-row">
        <button className="btn ghost" type="button" onClick={sync}>
          <Icon name="refresh" size={14} /> {t(lang, 'emgSync')}
        </button>
        <button className="btn ghost" type="button" onClick={simulate}>
          <Icon name="radio" size={14} /> {t(lang, 'emgSimulate')}
        </button>
        <span className="tag"><Icon name="info" size={13} /> {t(lang, 'emgSimHint')}</span>
      </div>
      {note ? <p className="emg-note" role="status">{note}</p> : null}
      {p2p ? <P2PDemo trace={p2p.trace} properties={p2p.properties} lang={lang} /> : null}

      <h3 className="emg-h3">{t(lang, 'emgInboxTitle')}</h3>
      <p className="sub">{t(lang, 'emgNearby')}: {peers.join(', ') || t(lang, 'emgNoPeers')}</p>
      <div className="emg-inbox">
        {inbox.map((m) => (
          <div className="emg-msg" key={m.message_id}>
            <Icon name={iconOf(m.message_type)} size={20} />
            <span className="word">{wordOf(lang, m.message_type)}</span>
            <span className="who">
              {m.sender_id} · {t(lang, 'emgPeople')} {m.people_count}
              {m.medical_required ? ` · ${t(lang, 'emgMedical')}` : ''}
            </span>
            <span className="meta">
              {t(lang, 'emgHops').replace('{n}', m.hops)}
              <span className="chip">{m.synced ? t(lang, 'emgChipSynced') : t(lang, 'emgChipLocal')}</span>
            </span>
          </div>
        ))}
        {inbox.length === 0 ? <p className="sub">{t(lang, 'emgInboxEmpty')}</p> : null}
      </div>
    </section>
  );
}
