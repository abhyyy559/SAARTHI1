import { useCallback, useEffect, useState } from 'react';
import { api, HYD, EMERGENCY_TYPES } from '../api';
import Icon from './icons';

// Resilient network UI: structured SOS -> encrypted packet -> relay -> inbox -> sync.
// Transport stays underneath; this panel only uses the facade operations.
export default function Emergency() {
  const [form, setForm] = useState({
    message_type: 'NEED_HELP', people_count: 1, medical_required: false, text: '',
  });
  const [inbox, setInbox] = useState([]);
  const [note, setNote] = useState('');

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

  async function send(e) {
    e.preventDefault();
    try {
      const r = await api.sos({
        sender_id: 'you',
        ...form,
        people_count: Number(form.people_count),
        location: { latitude: HYD.lat, longitude: HYD.lon },
      });
      setNote(`Encrypted packet ${r.message_id} queued via ${r.transport}. Location shared explicitly.`);
      refresh();
    } catch {
      setNote('Backend unreachable - packet NOT sent. Nothing is stored as delivered.');
    }
  }

  async function sync() {
    try {
      const r = await api.syncEmergency();
      setNote(`Synced ${r.synced.length}, pending ${r.pending.length}.`);
      refresh();
    } catch {
      setNote('Sync failed - still offline.');
    }
  }

  return (
    <section className="card">
      <h2>Resilient network - encrypted local emergency messaging</h2>
      <p className="sub">
        E2E-encrypted packets | store-and-forward | sync on reconnect.
        Nearby: {peers.join(', ') || 'no peers yet'}
      </p>
      <form onSubmit={send} className="row">
        <select
          value={form.message_type}
          onChange={(e) => setForm({ ...form, message_type: e.target.value })}
          aria-label="Message type"
        >
          {EMERGENCY_TYPES.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}
        </select>
        <input
          type="text"
          placeholder="people / note (e.g. 3 people)"
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          style={{ flex: 1 }}
          aria-label="Note"
        />
        <label className="mono">
          <input
            type="checkbox"
            checked={form.medical_required}
            onChange={(e) => setForm({ ...form, medical_required: e.target.checked })}
          />
          medical
        </label>
        <button className="btn danger-solid" type="submit"><Icon name="shield" />Send encrypted</button>
        <button className="btn ghost" type="button" onClick={sync}><Icon name="refresh" />Sync</button>
      </form>
      {note ? <p className="mono" style={{ marginTop: 8 }}>{note}</p> : null}
      <div className="evbox">
        {inbox.map((m) => (
          <div className="evrow" key={m.message_id}>
            <span className="k">{m.message_type} | {m.sender_id} | hops {m.hops}</span>
            <span>
              people {m.people_count}{m.medical_required ? ' / MEDICAL' : ''} {m.synced ? '/ synced' : '/ local'}
            </span>
          </div>
        ))}
        {inbox.length === 0 ? <p className="mono">No emergency packets yet.</p> : null}
      </div>
    </section>
  );
}