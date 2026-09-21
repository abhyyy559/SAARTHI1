// Offline & P2P panel — Agent 2.
//
// The demo game-changer screen: everything this phone knows with no internet,
// with honest "checked X ago" stamps; queued questions that replay on
// reconnect; alert transitions evaluated from cached data while offline; and
// the simulated phone-to-phone alert relay with visible hop states.
//
// Mount: under "More" later (Agent 4 owns IA). Props contract is documented in
// /tmp/agent2-integration.md. This component never touches Shell.jsx/views.jsx.
//
// Honesty rules (binding):
// - The SIMULATED stamp renders on the P2P card ALWAYS — no prop can hide it.
// - Severity comes from the backend payload and is only translated (SevStamp).
// - Offline transitions are labelled "from saved data — could not re-check".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import Icon from './icons';
import { Card, SevStamp } from './ui';
import { readCache, readQueue, useOnline, probeOfflineShell, saveDemoAlertsSnapshot } from '../offline';
import QrRelay from './QrRelay';
import QrScan from './QrScan';
import {
  checkedAgo,
  drainQueue,
  evaluateNewTransitions,
} from '../offlineEval';

const HOP_MS = 700;
const TRANS_MS = 10000;
// Relay-log refresh: poll cadence (covers a second device) + BroadcastChannel
// name (instant cross-tab on the same device).
const RELAY_LOG_POLL_MS = 10000;
const P2P_BC = 'saarthi-p2p-relay';
const TR_WORD = { 'pre-alert': 'op2pTrPreAlert', active: 'op2pTrActive', ended: 'op2pTrEnded' };

function agoDict(lang) {
  return {
    now: t(lang, 'agoNow'), min: t(lang, 'agoMin'),
    hour: t(lang, 'agoHour'), day: t(lang, 'agoDay'),
  };
}

export default function OfflineP2P({
  api, lang = 'en', district = '', online: onlineProp,
  alerts = [], demoMode = false, deviceId = '',
  // Worker 5: the app's built-in offline simulator (store simOffline). The
  // panel only renders the toggle; the store owns the actual network cut.
  simOffline = false, onToggleSimOffline = null,
}) {
  const hookOnline = useOnline();
  const online = onlineProp !== undefined ? onlineProp : hookOnline;
  const [cache, setCache] = useState(() => readCache());
  const [queue, setQueue] = useState(() => readQueue());
  const [replaying, setReplaying] = useState(false);
  const [replayNote, setReplayNote] = useState('');
  const [transitions, setTransitions] = useState([]);
  const [alertId, setAlertId] = useState('');
  const [failHop, setFailHop] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | sending | relayed | failed
  const [hopStates, setHopStates] = useState([]); // [{hop, state}]
  const [relayErr, setRelayErr] = useState('');
  const [relayLog, setRelayLog] = useState([]);
  const timers = useRef([]);
  // Worker 5 additions:
  // - shell: app-shell readiness probe result (honest cached/not-saved chip)
  // - demoAlerts: live demo alert list (backend) for the relay picker
  // - relayNote: transient "relay arrived from another tab" note
  // - bcRef: BroadcastChannel for instant cross-tab relay delivery
  const [shell, setShell] = useState(null);
  const [demoAlerts, setDemoAlerts] = useState([]);
  const [relayNote, setRelayNote] = useState('');
  const bcRef = useRef(null);
  // QR relay (real device-to-device): 'show' | 'scan'. `qrForward` holds a
  // next-hop envelope when the receiver chooses "relay this further".
  const [qrTab, setQrTab] = useState('show');
  const [qrForward, setQrForward] = useState(null);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const refreshCache = useCallback(() => {
    setCache(readCache());
    setQueue(readQueue());
  }, []);

  // Re-read snapshots whenever connectivity flips or the district changes.
  useEffect(() => { refreshCache(); }, [online, district, refreshCache]);

  // Worker 5: app-shell readiness probe, once per mount. A worker that is
  // merely registered but not controlling the page cannot serve the shell
  // offline — the chip below reports that honestly.
  useEffect(() => {
    let dead = false;
    probeOfflineShell().then((r) => { if (!dead) setShell(r); });
    return () => { dead = true; };
  }, []);

  // Worker 5: demo alerts live on the backend, not in the verdict cache, and
  // the relay picker needs their ids. Fetch + snapshot whenever online in
  // demo mode; offline, the snapshot (read by OfflineView) carries on.
  useEffect(() => {
    let dead = false;
    if (!online || !demoMode || !api || typeof api.demoAlerts !== 'function') return;
    api.demoAlerts(district).then((d) => {
      if (dead) return;
      const list = (d && d.alerts) || [];
      setDemoAlerts(list);
      saveDemoAlertsSnapshot(list, district);
    }).catch(() => { /* offline mid-flight — the snapshot stays as it was */ });
    return () => { dead = true; };
  }, [online, demoMode, district, api]);

  // Alerts for the picker and the offline evaluation: cached warning/alert
  // (via props) plus demo alerts (live fetch above), deduped by id.
  const allAlerts = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const a of [...(alerts || []), ...demoAlerts]) {
      const id = a && (a.id || a.alert_id);
      if (!id || seen.has(String(id))) continue;
      seen.add(String(id));
      out.push(a);
    }
    return out;
  }, [alerts, demoAlerts]);

  // Offline alert evaluation: every 10s while offline, check the cached alert
  // schedules for crossed boundaries. evaluateNewTransitions dedupes via a
  // fired-set in localStorage — a re-render never double-notifies.
  useEffect(() => {
    if (online || !allAlerts.length) return;
    const tick = () => {
      const fresh = evaluateNewTransitions(allAlerts);
      if (fresh.length) setTransitions((prev) => [...prev, ...fresh]);
    };
    tick();
    const id = setInterval(tick, TRANS_MS);
    return () => clearInterval(id);
  }, [online, allAlerts]);

  const stamps = useMemo(() => {
    const at = (name) => (cache[name] || {}).at || ((cache[name] || {}).data || {}).at || null;
    return [
      { icon: 'thermometer', label: t(lang, 'op2pCheckedWeather'), at: at('observation') || at('warning') },
      { icon: 'bell', label: t(lang, 'op2pCheckedAlerts'), at: at('alert') || at('warning') },
      { icon: 'file', label: t(lang, 'op2pCheckedAdvice'), at: at('advisory') || at('guidance') },
      { icon: 'chat', label: t(lang, 'op2pCheckedNotifications'), at: at('notifications') },
    ];
  }, [cache, lang]);

  const replayQueueNow = useCallback(async () => {
    if (!online || replaying || !api) return;
    setReplaying(true);
    setReplayNote('');
    const entries = readQueue();
    const { sent, kept } = await drainQueue(entries, (e) =>
      api.chat({ text: e.text, lang: e.lang || lang, persona: e.persona || 'general', district: e.district || district }));
    // Rewrite the queue with only the failures, preserving order.
    try {
      localStorage.setItem('wgpt-queue-v1', JSON.stringify(kept));
    } catch { /* ignore */ }
    setQueue(kept);
    if (sent.length) setReplayNote(t(lang, 'op2pQueueDone').replace('{n}', String(sent.length)));
    setReplaying(false);
  }, [online, replaying, api, lang, district]);

  const pickable = useMemo(
    () => (allAlerts || []).filter((a) => a && (a.id || a.alert_id)),
    [allAlerts],
  );
  useEffect(() => {
    if (!alertId && pickable.length) setAlertId(String(pickable[0].id || pickable[0].alert_id));
  }, [pickable, alertId]);

  const loadRelayLog = useCallback(async () => {
    if (!api) return;
    try {
      const d = await api.notifications(district, deviceId);
      const items = (d && d.notifications) || [];
      setRelayLog(items.filter((n) => n.kind === 'p2p-relay').slice(0, 5));
    } catch { /* offline — the log stays as it was */ }
  }, [api, district, deviceId]);

  useEffect(() => { loadRelayLog(); }, [loadRelayLog, phase]);

  // Worker 5: two-tab / two-device relay visibility. Poll the durable relay
  // log while online (covers a relay fired from a second DEVICE), and listen
  // on a BroadcastChannel for instant cross-tab delivery on the same device.
  // Polling is the fallback where BroadcastChannel is unavailable.
  useEffect(() => {
    if (!online) return;
    const id = setInterval(loadRelayLog, RELAY_LOG_POLL_MS);
    return () => clearInterval(id);
  }, [online, loadRelayLog]);

  useEffect(() => {
    let ch = null;
    try {
      ch = new BroadcastChannel(P2P_BC);
      ch.onmessage = (e) => {
        if (e && e.data && e.data.type === 'relay-done') {
          loadRelayLog();
          setRelayNote(t(lang, 'op2pRelayArrived'));
        }
      };
    } catch { /* unsupported — the poll above still covers it */ }
    bcRef.current = ch;
    return () => {
      if (ch) { try { ch.close(); } catch { /* ignore */ } }
      bcRef.current = null;
    };
  }, [loadRelayLog, lang]);

  // Announce a finished relay so sibling tabs refresh their relay log at once.
  const announceRelayDone = useCallback((id) => {
    try {
      if (bcRef.current) bcRef.current.postMessage({ type: 'relay-done', alert_id: id, at: Date.now() });
    } catch { /* ignore */ }
  }, []);

  const runRelay = useCallback(async () => {
    if (!demoMode || !alertId || phase === 'sending' || !api) return;
    setRelayErr('');
    setRelayNote('');
    setPhase('sending');
    setHopStates([]);
    let resp;
    try {
      resp = await api.demoRelay({
        alert_id: alertId,
        from_device: t(lang, 'op2pThisPhone'),
        to_device: t(lang, 'op2pNearbyPhone'),
        hops: 3,
        ...(failHop ? { fail_at_hop: 2 } : {}),
      });
    } catch (e) {
      setPhase('failed');
      setRelayErr(e && e.message ? String(e.message) : t(lang, 'op2pRelayFailed'));
      return;
    }
    // Animate the reported outcome hop by hop; the server already decided it.
    const states = resp.hop_states || [];
    states.forEach((h, i) => {
      timers.current.push(setTimeout(() => {
        setHopStates((prev) => [...prev, { hop: h.hop, state: 'sending' }]);
        timers.current.push(setTimeout(() => {
          setHopStates((prev) => prev.map((p) => (p.hop === h.hop ? { hop: h.hop, state: h.state } : p)));
          if (i === states.length - 1) {
            setPhase(resp.status === 'failed' ? 'failed' : 'relayed');
            loadRelayLog();
            announceRelayDone(alertId);
          }
        }, HOP_MS / 2));
      }, i * HOP_MS));
    });
    if (!states.length) {
      setPhase(resp.status === 'failed' ? 'failed' : 'relayed');
      announceRelayDone(alertId);
    }
  }, [demoMode, alertId, phase, api, failHop, lang, loadRelayLog, announceRelayDone]);

  const phaseWord = phase === 'idle' ? '' : t(lang,
    phase === 'sending' ? 'op2pRelaySending' : phase === 'relayed' ? 'op2pRelayed' : 'op2pRelayFailed');

  return (
    <div className="op2p">
      {/* 1 — connectivity + cache stamps -------------------------------- */}
      <Card
        title={t(lang, 'op2pTitle')}
        sub={t(lang, 'op2pSub')}
        actions={(
          <span className="chip" role="status" aria-live="polite">
            <Icon name={online ? 'globe' : 'offline'} size={14} />
            <span>{t(lang, online ? 'op2pConnOnline' : 'op2pConnOffline')}</span>
          </span>
        )}
      >
        <div className="chip-row" aria-label={t(lang, 'op2pTitle')}>
          {stamps.map((s) => (
            <span className="chip" key={s.label} title={s.at || t(lang, 'op2pNoCache')}>
              <Icon name={s.icon} size={14} />
              <span>{s.label}: {s.at ? checkedAgo(s.at, Date.now(), agoDict(lang)) : t(lang, 'op2pNoCache')}</span>
            </span>
          ))}
          {/* Worker 5: app-shell honesty — can this page actually paint offline? */}
          <span className="chip" role="status">
            <Icon name={shell && shell.ready ? 'check' : 'offline'} size={14} />
            <span>{shell == null ? t(lang, 'op2pShellChecking') : t(lang, shell.ready ? 'op2pShellSaved' : 'op2pShellNotSaved')}</span>
          </span>
          {/* Worker 5: built-in offline simulator — cuts the network path in-app. */}
          {onToggleSimOffline && (
            <label className="chip" style={{ cursor: 'pointer', minHeight: 44 }} title={t(lang, 'op2pSimulateOfflineNote')}>
              <input
                type="checkbox"
                checked={!!simOffline}
                onChange={onToggleSimOffline}
                style={{ width: 20, height: 20 }}
                aria-label={t(lang, 'op2pSimulateOffline')}
              />
              <span>{t(lang, 'op2pSimulateOffline')}</span>
            </label>
          )}
        </div>
      </Card>

      {/* 2 — queued questions --------------------------------------------- */}
      <Card title={t(lang, 'op2pQueueTitle')}>
        {queue.length === 0 ? (
          <p className="sub">{t(lang, 'op2pQueueEmpty')}</p>
        ) : (
          <>
            <div className="chip-row">
              {queue.slice(0, 5).map((q) => (
                <span className="chip" key={q.id || q.at}>
                  <Icon name="chat" size={12} />
                  <span>{String(q.text || '').slice(0, 42)}{String(q.text || '').length > 42 ? '…' : ''}</span>
                  <span>· {t(lang, 'op2pQueuedChip')}</span>
                </span>
              ))}
              {queue.length > 5 && <span className="chip">+{queue.length - 5}</span>}
            </div>
            <div className="card-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ minHeight: 44 }}
                disabled={!online || replaying}
                onClick={replayQueueNow}
              >
                <Icon name="send" size={16} />
                <span>{replaying ? t(lang, 'op2pQueueReplaying') : t(lang, 'op2pQueueReplay')} ({queue.length})</span>
              </button>
            </div>
            {!online && <p className="sub">{t(lang, 'op2pQueueOfflineNote')}</p>}
            {replayNote && <p className="sub" role="status">{replayNote}</p>}
          </>
        )}
      </Card>

      {/* 3 — offline alert transitions ------------------------------------- */}
      <Card title={t(lang, 'op2pTransTitle')} sub={t(lang, 'op2pTransCachedNote')}>
        {transitions.length === 0 ? (
          <p className="sub">{t(lang, 'op2pTransEmpty')}</p>
        ) : (
          <div className="p2p-log" role="log" aria-live="polite">
            {transitions.map((trn) => (
              <div className="log-line" key={trn.key}>
                <SevStamp lang={lang} level={trn.severity} />
                <span style={{ marginLeft: 8 }}>
                  {t(lang, TR_WORD[trn.transition] || 'op2pTrActive')}{trn.title ? ` — ${trn.title}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 4 — P2P relay ------------------------------------------------------ */}
      <Card
        title={t(lang, 'op2pP2pTitle')}
        sub={t(lang, 'op2pMeshNote')}
        actions={<span className="rubber-stamp" data-testid="p2p-simulated">{t(lang, 'p2pSimulated')}</span>}
      >
        {!demoMode && <p className="sub">{t(lang, 'op2pNotDemo')}</p>}
        {pickable.length === 0 ? (
          <p className="sub">{t(lang, 'op2pNoAlerts')}</p>
        ) : (
          <>
            <label className="sub" htmlFor="op2p-alert-pick">{t(lang, 'op2pTwoPhoneHint')}</label>
            <select
              id="op2p-alert-pick"
              className="chip"
              style={{ minHeight: 44, width: '100%', margin: '8px 0' }}
              value={alertId}
              onChange={(e) => setAlertId(e.target.value)}
              disabled={phase === 'sending'}
            >
              {pickable.map((a) => (
                <option key={a.id || a.alert_id} value={String(a.id || a.alert_id)}>
                  {a.title || a.hazard || a.id}
                </option>
              ))}
            </select>

            <label className="chip" style={{ cursor: 'pointer', minHeight: 44 }}>
              <input
                type="checkbox"
                checked={failHop}
                onChange={(e) => setFailHop(e.target.checked)}
                disabled={phase === 'sending'}
                style={{ width: 20, height: 20 }}
              />
              <span>{t(lang, 'op2pFailHop')}</span>
            </label>

            <div className="p2p-demo" style={{ marginTop: 12 }}>
              <p className="p2p-story mono" aria-hidden="true">
                <Icon name="radio" size={14} /> {t(lang, 'op2pThisPhone')}
                {[1, 2, 3].map((h) => {
                  const st = (hopStates.find((x) => x.hop === h) || {}).state;
                  return (
                    <span key={h}>
                      {' → '}
                      <Icon
                        name={st === 'failed' ? 'close' : st === 'relayed' ? 'check' : 'radio'}
                        size={14}
                      />
                    </span>
                  );
                })}
                {' → '}
                <Icon name="check" size={14} /> {t(lang, 'op2pNearbyPhone')}
              </p>
              {phaseWord && (
                <p className="sub" role="status">
                  <Icon name={phase === 'failed' ? 'close' : phase === 'relayed' ? 'check' : 'radio'} size={14} />{' '}
                  {phaseWord}
                </p>
              )}
              {relayErr && <p className="sub" role="alert">{relayErr}</p>}
            </div>

            <div className="card-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-signal"
                style={{ minHeight: 44 }}
                disabled={!demoMode || phase === 'sending' || !alertId}
                onClick={runRelay}
              >
                <Icon name="send" size={16} />
                <span>{phase === 'sending' ? t(lang, 'op2pRelaySending') : t(lang, 'op2pRelayBtn')}</span>
              </button>
              {phase === 'failed' && (
                <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={() => { setPhase('idle'); setHopStates([]); }}>
                  <Icon name="refresh" size={16} />
                  <span>{t(lang, 'op2pRetry')}</span>
                </button>
              )}
            </div>
          </>
        )}

        {relayNote && (
          <p className="sub" role="status" style={{ marginTop: 12 }}>
            <Icon name="radio" size={12} /> {relayNote}
          </p>
        )}

        {relayLog.length > 0 && (
          <>
            <h3 className="card-title" style={{ marginTop: 16, fontSize: 16 }}>{t(lang, 'op2pLogTitle')}</h3>
            <div className="p2p-log" role="log" aria-label={t(lang, 'op2pLogTitle')}>
              {relayLog.map((n) => (
                <div className="log-line" key={n.id}>
                  <Icon name="radio" size={12} />{' '}
                  <span>{n.title}</span>{' '}
                  <span className="ntf-sim">{t(lang, 'ntfSimulatedTag')}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* 5 — QR relay (REAL device-to-device) ---------------------------------
          Unlike the simulated relay above, this needs no internet at all: one
          phone shows the alert as rotating QR frames, the other scans them
          with its camera. No SIMULATED stamp here — this path is real. */}
      <Card
        title={t(lang, 'qrTitle')}
        sub={t(lang, 'qrSub')}
        actions={(
          <span className="chip" role="status">
            <Icon name="offline" size={14} />
            <span>{t(lang, online ? 'op2pConnOnline' : 'op2pConnOffline')}</span>
          </span>
        )}
      >
        <div className="chip-row" role="tablist" aria-label={t(lang, 'qrTitle')} style={{ marginBottom: 12 }}>
          {['show', 'scan'].map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={qrTab === tab}
              className="chip"
              style={{
                cursor: 'pointer', minHeight: 44,
                fontWeight: qrTab === tab ? 700 : 400,
                borderWidth: qrTab === tab ? 2 : 1,
              }}
              onClick={() => { setQrTab(tab); setQrForward(null); }}
            >
              <Icon name={tab === 'show' ? 'eye' : 'search'} size={14} />
              <span>{t(lang, tab === 'show' ? 'qrShowTab' : 'qrScanTab')}</span>
            </button>
          ))}
        </div>
        {qrTab === 'show' ? (
          <QrRelay
            alerts={allAlerts}
            lang={lang}
            deviceLabel={t(lang, 'op2pThisPhone')}
            relayEnvelope={qrForward}
            bare
          />
        ) : (
          <QrScan
            api={api}
            lang={lang}
            district={district}
            deviceId={deviceId}
            online={online}
            deviceLabel={t(lang, 'op2pThisPhone')}
            onRelayFurther={(env) => { setQrForward(env); setQrTab('show'); }}
          />
        )}
      </Card>
    </div>
  );
}
