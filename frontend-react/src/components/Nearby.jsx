// Nearby SOS — the phone-to-phone screen.
//
// Every SOS this phone has heard (directly, or passed along by other phones
// over Bluetooth), nearest first, with what the person needs, how far and in
// which direction, how many phones it hopped through and who is already on
// the way. Anyone can say "I'm going" or "Rescued"; only the sender can
// cancel. "I'm safe" lets family and neighbours stop looking.
import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import {
  ago, foldIncidents, formatDistance, relayedAlerts, safeCheckins, safePayload, sortIncidents,
} from '../mesh/meshLogic';
import {
  clearOpenView, currentPosition, enableBluetooth, initMesh, myName, send, sendUpdate, setMeshDistrict,
  setMyName, start, stop, useMesh,
} from '../mesh/meshClient';
import './Nearby.css';

const NEED_ICON = { medical: 'activity', trapped: 'user', water: 'drop', fire: 'flame', flood: 'flood', other: 'sos' };

export const needIcon = (need) => NEED_ICON[need] || 'sos';
export const needWord = (lang, need) => t(lang, `meshNeed_${NEED_ICON[need] ? need : 'other'}`);

/**
 * Starts the relay once, tells it which district is on screen (for the alert
 * hand-off), and follows a tap on an Android "SOS nearby" notification.
 */
export function MeshBridge() {
  const { loc, setView } = useApp();
  const { openView } = useMesh();
  useEffect(() => { initMesh(); }, []);
  useEffect(() => { if (loc && loc.district) setMeshDistrict(loc.district); }, [loc && loc.district]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!openView) return;
    if (['nearby', 'alerts', 'home'].includes(openView)) setView(openView);
    clearOpenView();
  }, [openView, setView]);
  return null;
}

/** Open SOS calls from other phones — the badge on the SOS button and Nearby row. */
export function useOpenSosCount() {
  const mesh = useMesh();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(
    () => foldIncidents(mesh.messages, mesh.nodeId, nowMs / 1000).filter((i) => i.status === 'active' && !i.mine).length,
    [mesh.messages, mesh.nodeId, nowMs],
  );
}

function mapLink(lat, lon, native) {
  // geo: opens whichever map app the phone has (works with offline maps);
  // a browser gets the web map.
  return native ? `geo:${lat},${lon}?q=${lat},${lon}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

export function RelayStatus({ compact = false }) {
  const { lang } = useApp();
  const mesh = useMesh();
  const s = mesh.status || {};
  const sim = mesh.mode !== 'native';
  const perms = s.permissions || {};
  const peers = Number(s.peers) || 0;
  let line;
  let action = null;
  if (!s.running && !sim && perms.bluetooth === false) {
    line = t(lang, 'meshNeedPerm');
    action = <button type="button" className="btn btn-signal sm" onClick={() => start()}>{t(lang, 'meshAllow')}</button>;
  } else if (!sim && s.bluetoothOn === false) {
    line = t(lang, 'meshBtOff');
    action = <button type="button" className="btn btn-signal sm" onClick={enableBluetooth}>{t(lang, 'meshBtTurnOn')}</button>;
  } else if (!s.running) {
    line = t(lang, 'meshRelayOff');
    action = <button type="button" className="btn btn-signal sm" onClick={() => start()}>{t(lang, 'meshTurnOn')}</button>;
  } else {
    line = peers === 0 ? t(lang, 'meshPeersNone')
      : peers === 1 ? t(lang, 'meshPeersOne') : t(lang, 'meshPeersMany').replace('{n}', String(peers));
  }
  const on = s.running && (sim || s.bluetoothOn !== false);
  return (
    <div className={`relay${compact ? ' is-compact' : ''}`} data-on={on ? 'yes' : 'no'} role="status">
      <span className="relay-icon" aria-hidden="true"><Icon name="bluetooth" size={20} /></span>
      <span className="relay-text">
        <b>
          {on ? t(lang, 'meshRelayOn') : t(lang, 'meshRelayOff')}
          {sim && <span className="relay-tag">{t(lang, 'meshSimTag')}</span>}
        </b>
        <span>{line}</span>
        {!compact && sim && <span className="relay-note">{t(lang, 'meshSim')}</span>}
      </span>
      {action && <span className="relay-action">{action}</span>}
    </div>
  );
}

function SosCard({ inc, lang, native, onUpdate, busy }) {
  const closed = inc.status !== 'active';
  const place = inc.km != null ? `${formatDistance(inc.km)}${inc.dir ? ` ${inc.dir}` : ''}` : null;
  const hops = inc.mine ? null : inc.hops <= 1 ? t(lang, 'meshDirect') : t(lang, 'meshVia').replace('{n}', String(inc.hops));
  return (
    <article className={`sos-card${closed ? ' is-closed' : ''}${inc.mine ? ' is-mine' : ''}`} aria-label={needWord(lang, inc.need)}>
      <div className="sos-card-head">
        <span className="sos-card-icon" aria-hidden="true"><Icon name={needIcon(inc.need)} size={22} /></span>
        <span className="sos-card-title">
          <b>{inc.mine ? t(lang, 'meshMine') : needWord(lang, inc.need)}</b>
          <span>
            {[inc.mine ? needWord(lang, inc.need) : inc.name, inc.people > 1 ? t(lang, 'meshPeople').replace('{n}', String(inc.people)) : null]
              .filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="sos-card-place">
          {closed ? (
            <span className="sos-state">{t(lang, inc.status === 'rescued' ? 'meshStRescued' : 'meshStCancelled')}</span>
          ) : place ? (
            <><Icon name="navigate" size={14} /> {place}</>
          ) : inc.lat == null ? (
            <span className="sos-noplace">{t(lang, 'meshNoPlace')}</span>
          ) : null}
        </span>
      </div>
      {inc.note && <p className="sos-card-note">{inc.note}</p>}
      <p className="sos-card-meta">
        {[ago(inc.ts, lang), hops, inc.responders.length ? t(lang, 'meshResponders').replace('{n}', String(inc.responders.length)) : null]
          .filter(Boolean).join(' · ')}
      </p>
      {!closed && (
        <div className="sos-card-actions">
          {inc.mine ? (
            <button type="button" className="btn btn-secondary sm" disabled={busy} onClick={() => onUpdate(inc.id, 'cancel')}>
              <Icon name="close" size={14} /> {t(lang, 'meshCancel')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className={`btn sm ${inc.iAmGoing ? 'btn-secondary' : 'btn-signal'}`}
                disabled={busy || inc.iAmGoing}
                onClick={() => onUpdate(inc.id, 'going')}
              >
                <Icon name="route" size={14} /> {inc.iAmGoing ? t(lang, 'meshGoingDone') : t(lang, 'meshGoing')}
              </button>
              <button type="button" className="btn btn-secondary sm" disabled={busy} onClick={() => onUpdate(inc.id, 'rescued')}>
                <Icon name="check" size={14} /> {t(lang, 'meshRescued')}
              </button>
            </>
          )}
          {inc.lat != null && inc.lon != null && (
            <a className="btn btn-ghost sm" href={mapLink(inc.lat, inc.lon, native)} target="_blank" rel="noreferrer">
              <Icon name="map" size={14} /> {t(lang, 'meshDirections')}
            </a>
          )}
        </div>
      )}
    </article>
  );
}

export default function Nearby() {
  const { lang } = useApp();
  const mesh = useMesh();
  const [here, setHere] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [name, setName] = useState(myName);
  const [showClosed, setShowClosed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const native = mesh.mode === 'native';

  useEffect(() => {
    let alive = true;
    currentPosition().then((p) => { if (alive && p) setHere(p); });
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const incidents = useMemo(
    () => sortIncidents(foldIncidents(mesh.messages, mesh.nodeId, nowMs / 1000), here),
    [mesh.messages, mesh.nodeId, here, nowMs],
  );
  const open = incidents.filter((i) => i.status === 'active');
  const closed = incidents.filter((i) => i.status !== 'active');
  const safe = useMemo(() => safeCheckins(mesh.messages, nowMs / 1000), [mesh.messages, nowMs]);
  const alerts = useMemo(() => relayedAlerts(mesh.messages, nowMs / 1000), [mesh.messages, nowMs]);

  async function update(ref, st) {
    setBusy(true);
    try { await sendUpdate(ref, st); } catch { /* the relay reports its own state */ } finally { setBusy(false); }
  }

  async function imSafe() {
    setBusy(true);
    try {
      setMyName(name);
      const p = here || await currentPosition(5000);
      await send('safe', safePayload({ name, lat: p && p.lat, lon: p && p.lon }));
      setNote(t(lang, 'meshSafeSent'));
    } catch { /* shown by the relay status */ } finally { setBusy(false); }
  }

  return (
    <div className="nearby">
      <RelayStatus />
      {mesh.status && mesh.status.running && (
        <div className="relay-row">
          <span className="sub">{t(lang, 'meshCarried').replace('{n}', String(mesh.messages.length))}</span>
          <button type="button" className="btn btn-ghost sm" onClick={stop}>{t(lang, 'meshTurnOff')}</button>
        </div>
      )}

      <section className="nearby-sec" aria-labelledby="nb-active">
        <h2 id="nb-active" className="nearby-h2">
          {t(lang, 'meshActiveTitle')}
          {open.length > 0 && <span className="nearby-count">{open.length}</span>}
        </h2>
        {open.length === 0 && <p className="nearby-empty">{t(lang, 'meshNoSos')}</p>}
        <div className="sos-list">
          {open.map((inc) => (
            <SosCard key={inc.id} inc={inc} lang={lang} native={native} onUpdate={update} busy={busy} />
          ))}
        </div>
      </section>

      <section className="nearby-sec" aria-labelledby="nb-safe">
        <h2 id="nb-safe" className="nearby-h2">{t(lang, 'meshSafeTitle')}</h2>
        <form className="safe-form" onSubmit={(e) => { e.preventDefault(); imSafe(); }}>
          <input
            className="input"
            type="text"
            maxLength={40}
            value={name}
            placeholder={t(lang, 'meshYourName')}
            aria-label={t(lang, 'meshYourName')}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn btn-signal" disabled={busy}>
            <Icon name="check" size={16} /> {t(lang, 'meshImSafe')}
          </button>
        </form>
        {note && <p className="sub" role="status">{note}</p>}
        {safe.length > 0 && (
          <ul className="safe-list">
            {safe.map((s) => (
              <li key={s.origin}>
                <Icon name="check" size={16} />
                <span className="safe-name">{s.origin === mesh.nodeId ? t(lang, 'meshYou') : (s.name || s.origin.slice(0, 6))}</span>
                <span className="safe-when">{ago(s.ts, lang, nowMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {alerts.length > 0 && (
        <section className="nearby-sec" aria-labelledby="nb-alerts">
          <h2 id="nb-alerts" className="nearby-h2">{t(lang, 'meshAlertsTitle')}</h2>
          <ul className="relayed-alerts">
            {alerts.map((a) => (
              <li key={a.id} data-sev={String(a.severity || 'UNKNOWN').toUpperCase()}>
                <b>{a.headline}</b>
                <span>{[a.area, a.source, ago(a.ts, lang, nowMs)].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {closed.length > 0 && (
        <section className="nearby-sec">
          <button type="button" className="nearby-toggle" aria-expanded={showClosed} onClick={() => setShowClosed((v) => !v)}>
            {t(lang, 'meshClosedTitle')} <span className="nearby-count is-muted">{closed.length}</span>
            <Icon name="chevron" size={16} />
          </button>
          {showClosed && (
            <div className="sos-list">
              {closed.map((inc) => <SosCard key={inc.id} inc={inc} lang={lang} native={native} onUpdate={update} busy={busy} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
