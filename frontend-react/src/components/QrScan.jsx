// QR relay — RECEIVER. Scans the sender's rotating QR frames with the
// device camera, reassembles the alert, validates the checksum, saves it to
// the phone's own alert cache, and queues an acknowledgement for later sync.
//
// Honesty: the received card is ALWAYS badged "via P2P relay" with the hop
// count, and "could not verify with the server". An official alert keeps its
// official source badge; a community alert is never presented as official.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { t } from '../i18n';
import Icon from './icons';
import { Card, SevStamp } from './ui';
import { saveAlertSnapshot } from '../offline';
import {
  nextHop,
  parseFrame,
  queueP2PAck,
  readP2PAcks,
  reassembleFrames,
  syncP2PAcks,
} from '../p2pqr';

function fill2(lang, key, o) {
  return t(lang, key)
    .replace('{r}', String(o.r)).replace('{n}', String(o.n))
    .replace('{hops}', String(o.hops)).replace('{limit}', String(o.limit));
}

export default function QrScan({
  api = null, lang = 'en', district = '', deviceId = '',
  online = true, deviceLabel = '', onRelayFurther = null,
}) {
  const [scanning, setScanning] = useState(false);
  const [camErr, setCamErr] = useState('');
  const [progress, setProgress] = useState(null); // {rid,total,received}
  const [ignored, setIgnored] = useState(0);
  const [failed, setFailed] = useState(''); // '' | 'checksum'
  const [received, setReceived] = useState(null); // envelope
  const [acks, setAcks] = useState(() => readP2PAcks());
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const framesRef = useRef(new Map()); // "rid:i" -> frame text
  const ridRef = useRef(null);
  const qrRef = useRef(null);
  const doneRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const stopCam = useCallback(async () => {
    try {
      if (qrRef.current) await qrRef.current.stop();
    } catch { /* already stopped */ }
    try {
      if (qrRef.current) qrRef.current.clear();
    } catch { /* ignore */ }
    qrRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => () => { stopCam(); }, [stopCam]);

  const reset = useCallback(() => {
    framesRef.current = new Map();
    ridRef.current = null;
    doneRef.current = false;
    setProgress(null);
    setIgnored(0);
    setFailed('');
    setReceived(null);
    setSyncNote('');
  }, []);

  const handleDecode = useCallback((decodedText) => {
    if (doneRef.current) return;
    const p = parseFrame(decodedText);
    if (!p.ok) {
      // A random non-relay QR in view — count it, don't crash, don't block.
      setIgnored((c) => c + 1);
      return;
    }
    const f = p.frame;
    if (!ridRef.current) ridRef.current = f.rid;
    if (f.rid !== ridRef.current) return; // another relay nearby — ignore
    const key = `${f.rid}:${f.i}`;
    if (!framesRef.current.has(key)) framesRef.current.set(key, decodedText);
    const texts = [...framesRef.current.values()];
    const r = reassembleFrames(texts);
    setProgress({ rid: r.rid, total: r.total, received: r.received });
    if (!r.complete) return;
    doneRef.current = true;
    if (!r.ok) {
      setFailed('checksum');
      stopCam();
      return;
    }
    const env = r.envelope;
    // Save to THIS phone's alert cache with P2P provenance attached. The
    // cached-alert views render it stale-labelled like any saved alert.
    saveAlertSnapshot(
      { ...env.alert, _p2p: { provenance: 'p2p-relay', hops: env.hops, hop_limit: env.hop_limit, relay_id: env.relay_id, received_at: new Date().toISOString() } },
      district,
    );
    queueP2PAck({
      alert_id: env.alert.id || env.alert.alert_id,
      relay_id: env.relay_id,
      hops: env.hops,
      device: deviceId || deviceLabel || 'phone',
    });
    setAcks(readP2PAcks());
    setReceived(env);
    stopCam();
  }, [district, deviceId, deviceLabel, stopCam]);

  const startCam = useCallback(async () => {
    setCamErr('');
    setFailed('');
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setCamErr(t(lang, 'qrCamNeedHttps'));
      return;
    }
    let qr;
    try {
      qr = new Html5Qrcode('p2pqr-reader');
    } catch {
      setCamErr(t(lang, 'qrNoCamera'));
      return;
    }
    qrRef.current = qr;
    setScanning(true);
    try {
      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        handleDecode,
        () => { /* per-frame decode misses are normal — stay silent */ },
      );
    } catch (e) {
      const name = (e && e.name) || '';
      if (!mountedRef.current) return;
      setCamErr(t(lang, name === 'NotAllowedError' ? 'qrCamDenied' : 'qrNoCamera'));
      setScanning(false);
      qrRef.current = null;
    }
  }, [handleDecode, lang]);

  const syncNow = useCallback(async () => {
    if (!api || !online || syncing) return;
    setSyncing(true);
    setSyncNote('');
    try {
      const { sent } = await syncP2PAcks(api, deviceId || deviceLabel || 'phone');
      if (!mountedRef.current) return;
      setAcks(readP2PAcks());
      if (sent > 0) setSyncNote(t(lang, 'qrAckSynced'));
    } catch { /* keep them queued */ }
    if (mountedRef.current) setSyncing(false);
  }, [api, online, syncing, deviceId, deviceLabel, lang]);

  const alert = received ? received.alert : null;
  // "Relay this further": compute the next-hop envelope ONCE — nextHop mints
  // a fresh relay_id per call, so calling it twice would forward a different
  // envelope than the one the button label was checked against.
  const forwardEnv = received ? nextHop(received, deviceLabel) : null;

  return (
    <Card title={t(lang, 'qrScanTitle')} sub={t(lang, 'qrScanSub')}>
      {!received && !failed && (
        <>
          <div
            id="p2pqr-reader"
            style={{
              width: '100%', maxWidth: 360, margin: '8px auto', borderRadius: 8,
              overflow: 'hidden', background: '#111', minHeight: scanning ? 240 : 0,
              display: scanning ? 'block' : 'none',
            }}
          />
          {camErr && (
            <p className="sub" role="alert"><Icon name="close" size={14} /> {camErr}</p>
          )}
          {progress && progress.total > 0 && (
            <p className="sub" role="status" style={{ marginTop: 8 }}>
              <Icon name="layers" size={12} />{' '}
              {fill2(lang, 'qrProgress', { r: progress.received, n: progress.total })}
            </p>
          )}
          {ignored > 0 && (
            <p className="sub">{t(lang, 'qrBadCode')} ({ignored})</p>
          )}
          <div className="card-actions" style={{ marginTop: 12 }}>
            {!scanning ? (
              <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} onClick={startCam}>
                <Icon name="eye" size={16} /> <span>{t(lang, 'qrStartCam')}</span>
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={stopCam}>
                <Icon name="stop" size={16} /> <span>{t(lang, 'qrStopCam')}</span>
              </button>
            )}
          </div>
        </>
      )}

      {failed === 'checksum' && (
        <>
          <p className="sub" role="alert">
            <Icon name="close" size={14} /> {t(lang, 'qrChecksumFail')}
          </p>
          <div className="card-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={reset}>
              <Icon name="refresh" size={16} /> <span>{t(lang, 'qrNewScan')}</span>
            </button>
          </div>
        </>
      )}

      {received && alert && (
        <>
          <p className="sub" role="status" style={{ marginTop: 4 }}>
            <Icon name="check" size={14} /> <strong>{t(lang, 'qrReceived')}</strong>
          </p>
          <div className="chip-row" style={{ margin: '8px 0' }}>
            {/* Provenance badges: official source is KEPT, P2P hop is ADDED. */}
            {received.official ? (
              <span className="chip"><Icon name="shield" size={12} /> {t(lang, 'qrOfficialKept')}{received.source ? ` · ${received.source}` : ''}</span>
            ) : (
              <span className="chip"><Icon name="user" size={12} /> {t(lang, 'qrCommunityKept')}</span>
            )}
            <span className="chip">
              <Icon name="radio" size={12} /> {t(lang, 'qrViaP2p')} ·{' '}
              {fill2(lang, 'qrHopChip', { hops: received.hops, limit: received.hop_limit })}
            </span>
          </div>
          <h3 className="card-title" style={{ fontSize: 18 }}>
            {String(alert.title || alert.headline || alert.hazard || 'Alert')}
          </h3>
          <div style={{ margin: '8px 0' }}>
            <SevStamp lang={lang} level={alert.severity || alert.level} />
          </div>
          {alert.description && <p className="sub">{String(alert.description).slice(0, 500)}</p>}
          {alert.instruction && (
            <p className="sub"><strong>{String(alert.instruction).slice(0, 300)}</strong></p>
          )}
          <p className="sub" style={{ marginTop: 8 }}>
            <Icon name="offline" size={12} /> {t(lang, 'qrReceivedSub')}
          </p>

          <div className="chip-row" style={{ marginTop: 8 }}>
            <span className="chip" role="status">
              <Icon name="check" size={12} /> <span>{t(lang, 'qrAckQueued')}</span>
            </span>
            {acks.length > 0 && (
              <span className="chip">{t(lang, 'qrAckPending').replace('{n}', String(acks.length))}</span>
            )}
          </div>
          <div className="card-actions" style={{ marginTop: 12 }}>
            {online && acks.length > 0 && (
              <button
                type="button" className="btn btn-secondary" style={{ minHeight: 44 }}
                disabled={syncing} onClick={syncNow}
              >
                <Icon name="send" size={16} />{' '}
                <span>{syncing ? '…' : t(lang, 'qrAckSync')}</span>
              </button>
            )}
            {syncNote && <span className="sub" role="status">{syncNote}</span>}
            {onRelayFurther && forwardEnv && (
              <button
                type="button" className="btn btn-signal" style={{ minHeight: 44 }}
                onClick={() => onRelayFurther(forwardEnv)}
              >
                <Icon name="radio" size={16} /> <span>{t(lang, 'qrRelayAgain')}</span>
              </button>
            )}
            <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={reset}>
              <Icon name="refresh" size={16} /> <span>{t(lang, 'qrNewScan')}</span>
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
