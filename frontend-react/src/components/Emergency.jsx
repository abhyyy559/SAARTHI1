// Emergency panel — the mayday console. One huge SOS slab with an
// ARM → SEND sequence (no accidental sends), a picture grid for every other
// message, and a delivery stepper that never calls anything "delivered" that
// was not.
//
// Three delivery facts are never blurred: "queued" (accepted here), "local"
// (still on this device) and "synced" (reached the relay). A failed send says so.
//
// HARBOUR SIGNAL: the inbox is scoped to THIS phone's session (B2) — no
// shared historical pile. Rows show relative times. The armed slab reads
// "TAP AGAIN TO SEND"; only an actual network send shows "Sending…".
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, EMERGENCY_TYPES } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

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

// Per-browser-session sender id: the inbox shows messages sent from THIS
// phone in THIS demo, never the backend's shared historical pile (B2).
function sessionSenderId() {
  try {
    let sid = sessionStorage.getItem('wgpt.sid');
    if (!sid) {
      sid = `you-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem('wgpt.sid', sid);
    }
    return sid;
  } catch {
    return 'you';
  }
}
function readHiddenIds() {
  try { return JSON.parse(sessionStorage.getItem('wgpt.hidden-msgs') || '[]'); } catch { return []; }
}

function relTime(ts, lang) {
  try {
    const ms = typeof ts === 'number' ? ts * 1000 : Date.parse(ts);
    if (!ms || Number.isNaN(ms)) return '';
    const locale = lang === 'hi' ? 'hi-IN' : lang === 'te' ? 'te-IN' : 'en-IN';
    const mins = Math.round((Date.now() - ms) / 60000);
    if (Math.abs(mins) < 1) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'minute');
    if (Math.abs(mins) < 60) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-mins, 'minute');
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-Math.round(mins / 60), 'hour');
  } catch { return ''; }
}

export default function Emergency() {
  const { loc, lang } = useApp();
  const [sid] = useState(sessionSenderId);
  const [form, setForm] = useState({
    message_type: 'NEED_HELP', people_count: 1, medical_required: false, text: '',
  });
  const [inbox, setInbox] = useState([]);
  const [note, setNote] = useState('');
  // ARM → SEND: the SOS slab arms on first tap and sends on the second, so a
  // shaking hand or a curious jury finger cannot fire a mayday by accident.
  // It auto-disarms after a few seconds.
  const [armed, setArmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [hiddenIds, setHiddenIds] = useState(readHiddenIds);
  const armTimer = useRef(null);

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
    return () => { alive = false; clearTimeout(armTimer.current); };
  }, []);

  // Session-scoped inbox: only my messages, minus anything I cleared (B2).
  const hidden = new Set(hiddenIds);
  const mine = inbox.filter((m) => m.sender_id === sid && !hidden.has(m.message_id));

  async function send(messageType) {
    if (sending) return;
    setSending(true);
    try {
      const r = await api.sos({
        sender_id: sid,
        ...form,
        message_type: messageType || form.message_type,
        people_count: Number(form.people_count) || 1,
        location: { latitude: loc.lat, longitude: loc.lon },
      });
      setNote(t(lang, 'emgQueued').replace('{id}', r.message_id).replace('{tr}', r.transport));
      refresh();
    } catch {
      setNote(t(lang, 'emgNotSent'));
    } finally {
      setSending(false);
    }
  }

  function onSos() {
    if (!armed) {
      setArmed(true);
      clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    clearTimeout(armTimer.current);
    setArmed(false);
    send('NEED_HELP');
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

  function clearSession() {
    const ids = [...hidden, ...mine.map((m) => m.message_id)];
    setHiddenIds(ids);
    try { sessionStorage.setItem('wgpt.hidden-msgs', JSON.stringify(ids)); } catch { /* ignore */ }
  }

  const step = (d) => setForm((f) => ({ ...f, people_count: Math.max(1, Number(f.people_count) + d) }));

  return (
    <section className="mayday" aria-label={t(lang, 'sendSosTitle')}>
      <div className="may-title">
        <h2 className="display">{t(lang, 'sendSosTitle')}</h2>
      </div>

      <div className="sos-wrap">
        <button
          type="button"
          className={`sos-btn${armed ? ' is-armed' : ''}`}
          aria-pressed={armed}
          disabled={sending}
          onClick={onSos}
        >
          {sending ? t(lang, 'sosSending') : armed ? t(lang, 'sosArmedFire') : t(lang, 'emgSos')}
        </button>
        <div className="sos-side">
          <p>{sending ? t(lang, 'sosSending') : armed ? t(lang, 'emgSosArmed') : t(lang, 'emgSub')}</p>
          <p className="mono">{t(lang, 'emgArmHint')}</p>
        </div>
      </div>

      <div className="kicker" style={{ marginBottom: 8 }}>{t(lang, 'emgPick')}</div>
      <div className="needs-grid" role="group" aria-label={t(lang, 'emgPick')}>
        {EMERGENCY_TYPES.filter((type) => type !== 'NEED_HELP').map((type) => (
          <button
            key={type}
            type="button"
            className={`need-tile${form.message_type === type ? ' is-picked' : ''}`}
            aria-pressed={form.message_type === type}
            onClick={() => setForm((f) => ({ ...f, message_type: type }))}
          >
            <Icon name={iconOf(type)} size={24} />
            <span>{wordOf(lang, type)}</span>
          </button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <span className="emg-step" role="group" aria-label={t(lang, 'emgPeopleWithYou')}>
          <span className="kicker">{t(lang, 'emgPeopleWithYou')}</span>
          <button type="button" className="btn-icon" onClick={() => step(-1)} aria-label={t(lang, 'emgLess')}>−</button>
          <span className="mono" style={{ minWidth: 32, textAlign: 'center', fontWeight: 800 }}>{form.people_count}</span>
          <button type="button" className="btn-icon" onClick={() => step(1)} aria-label={t(lang, 'emgMore')}>+</button>
        </span>
        <button
          type="button"
          className={`need-tile${form.medical_required ? ' is-picked' : ''}`}
          style={{ minHeight: 48, flexDirection: 'row', padding: '6px 12px' }}
          aria-pressed={form.medical_required}
          onClick={() => setForm((f) => ({ ...f, medical_required: !f.medical_required }))}
        >
          <Icon name="activity" size={20} />
          <span>{t(lang, 'emgMedicalNeed')}</span>
        </button>
      </div>

      <form className="row" style={{ marginBottom: 10 }} onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          className="input"
          type="text"
          placeholder={t(lang, 'emgNotePh')}
          aria-label={t(lang, 'emgNotePh')}
          value={form.text}
          onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
          style={{ flex: 1 }}
        />
        <button className="btn btn-signal" type="submit" disabled={sending}>
          <Icon name="send" size={16} /> {t(lang, 'emgSend')} · {wordOf(lang, form.message_type)}
        </button>
      </form>

      <div className="row" style={{ marginBottom: 6 }}>
        <button className="btn btn-secondary sm" type="button" onClick={sync}>
          <Icon name="refresh" size={14} /> {t(lang, 'emgSync')}
        </button>
      </div>
      {note ? <p className="mono" role="status">{note}</p> : null}

      <div className="emg-inbox-meta">
        <h3 className="display" style={{ fontSize: 22, margin: 0 }}>{t(lang, 'emgInboxTitle')}</h3>
        {mine.length > 0 && (
          <button type="button" className="btn btn-ghost sm" onClick={clearSession}>
            {t(lang, 'emgClearSession')}
          </button>
        )}
      </div>
      <p className="sub">{t(lang, 'emgSessionScope')}</p>
      <div className="stepper" style={{ marginTop: 8 }}>
        {mine.map((m) => (
          <div className="step is-done" key={m.message_id}>
            <div>
              <div className="step-t"><Icon name={iconOf(m.message_type)} size={16} /> {wordOf(lang, m.message_type)}</div>
              <div className="step-s">
                {relTime(m.timestamp, lang)}
                {' · '}{t(lang, 'emgPeople')} {m.people_count}
                {m.medical_required ? ` · ${t(lang, 'emgMedicalNeed')}` : ''}
                {' · '}{t(lang, 'emgHops').replace('{n}', m.hops)}
                {' · '}{m.synced ? t(lang, 'emgChipSynced') : t(lang, 'emgChipLocal')}
              </div>
            </div>
          </div>
        ))}
        {mine.length === 0 ? <p className="sub">{t(lang, 'emgInboxEmpty')}</p> : null}
      </div>
    </section>
  );
}
