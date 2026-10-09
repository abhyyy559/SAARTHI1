// QR relay — SENDER. Two modes, both fully offline (no api prop, no fetch,
// no network calls anywhere in this file — the `qrcode` lib is bundled, so
// codes render with zero connectivity). The alert comes from the phone's own
// saved data (props).
//
// SIMPLE (default): the chosen alert as ONE static QR with plain human-
// readable text. Any regular phone camera reads it — no app needed. This is
// the offline data-sharing path.
//
// APP RELAY: the envelope as ROTATING QR frames for the SAARTHI scanner on
// another phone (checksum + hop limit). Hop honesty: the envelope carries
// hops/hop_limit. If this phone is already at the limit (e.g. it received
// the alert 5 hops deep), it refuses to show the QR instead of silently
// relaying past the limit.
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { t } from '../i18n';
import Icon from './icons';
import { Card } from './ui';
import {
  alertPlainText,
  buildEnvelope,
  canRelay,
  chunkEnvelope,
} from '../p2pqr';

const FRAME_MS = 900;

function alertLabel(a) {
  if (!a) return '';
  return String(a.title || a.headline || a.hazard || a.event || a.id || a.alert_id || a.identifier || 'alert');
}
// Canonical share id: official CAP alerts carry `identifier`, demo alerts
// carry `id`. Dropping identifier-only alerts here was the "QR not
// generating" bug — the list on screen never reached the picker.
function alertId(a) {
  return String((a && (a.id || a.alert_id || a.identifier)) || '');
}

export default function QrRelay({ alerts = [], lang = 'en', deviceLabel = '', initialHops = 0, relayEnvelope = null, bare = false }) {
  const [alertKey, setAlertKey] = useState('');
  const [frameIdx, setFrameIdx] = useState(0);
  const [qrUrl, setQrUrl] = useState('');
  const [qrErr, setQrErr] = useState('');
  const [mode, setMode] = useState('simple');

  const pickable = useMemo(
    () => (alerts || []).filter((a) => a && (a.id || a.alert_id || a.identifier)),
    [alerts],
  );
  useEffect(() => {
    if (!alertKey && pickable.length) setAlertKey(alertId(pickable[0]));
  }, [pickable, alertKey]);

  const selected = useMemo(
    () => pickable.find((a) => alertId(a) === alertKey) || null,
    [pickable, alertKey],
  );

  // selected?._p2p: a previously-received relay carries its hop count so a
  // re-relay continues the chain instead of resetting it to zero.
  const startHops = selected && selected._p2p && typeof selected._p2p.hops === 'number'
    ? selected._p2p.hops
    : initialHops;

  const built = useMemo(() => {
    // "Relay this further": the receiver hands back a next-hop envelope with
    // hops already incremented — render it directly, never rebuild from zero.
    if (relayEnvelope && relayEnvelope.kind === 'saarthi-p2p-alert') {
      return { ok: true, envelope: relayEnvelope };
    }
    if (!selected) return null;
    return buildEnvelope(selected, { hops: startHops, deviceLabel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayEnvelope, selected, startHops, deviceLabel]);

  const frames = useMemo(() => {
    if (!built || !built.ok) return [];
    return chunkEnvelope(built.envelope);
  }, [built]);

  const envelope = built && built.ok ? built.envelope : null;
  const relayAllowed = envelope ? canRelay(envelope) : false;

  // Plain-text payload for the simple QR: one static code any camera reads.
  const simpleText = useMemo(() => {
    if (relayEnvelope && relayEnvelope.kind === 'saarthi-p2p-alert' && relayEnvelope.alert) {
      return alertPlainText(relayEnvelope.alert);
    }
    return selected ? alertPlainText(selected) : '';
  }, [relayEnvelope, selected]);

  // Rotate frames (app-relay mode only — the simple QR never rotates).
  useEffect(() => {
    setFrameIdx(0);
    if (mode !== 'relay' || !frames.length) return undefined;
    const id = setInterval(() => setFrameIdx((i) => (i + 1) % frames.length), FRAME_MS);
    return () => clearInterval(id);
  }, [frames, mode]);

  // Render the current payload to a QR data URL. Fully offline: the `qrcode`
  // lib runs on-device, no network involved.
  const genToken = useRef(0);
  const qrText = mode === 'simple' ? simpleText : frames[frameIdx];
  useEffect(() => {
    const my = ++genToken.current;
    setQrUrl('');
    setQrErr('');
    if (!qrText) return;
    QRCode.toDataURL(qrText, { errorCorrectionLevel: 'M', width: 280, margin: 2 })
      .then((url) => { if (genToken.current === my) setQrUrl(url); })
      .catch(() => { if (genToken.current === my) setQrErr('qr-render'); });
  }, [qrText]);

  const fill = (s, o) => t(lang, s).replace('{i}', String(o.i)).replace('{n}', String(o.n))
    .replace('{r}', String(o.r)).replace('{hops}', String(o.hops)).replace('{limit}', String(o.limit));

  // `bare`: when embedded inside another titled Card (OfflineP2P), skip our
  // own Card so the title/sub don't render twice.
  const body = (
    <>
      {pickable.length === 0 && !relayEnvelope ? (
        <p className="sub">{t(lang, 'qrNoAlerts')}</p>
      ) : (
        <>
          {!relayEnvelope && (
            <>
              <label className="sub" htmlFor="qr-alert-pick">{t(lang, 'qrPickAlert')}</label>
              <select
                id="qr-alert-pick"
                className="chip"
                style={{ minHeight: 44, width: '100%', margin: '8px 0' }}
                value={alertKey}
                onChange={(e) => setAlertKey(e.target.value)}
              >
                {pickable.map((a) => (
                  <option key={alertId(a)} value={alertId(a)}>{alertLabel(a)}</option>
                ))}
              </select>
            </>
          )}

          <div className="segmented" role="tablist" aria-label={t(lang, 'qrTitle')} style={{ margin: '8px 0' }}>
            <button
              type="button" role="tab" aria-selected={mode === 'simple'}
              className={`seg-opt${mode === 'simple' ? ' is-active' : ''}`}
              onClick={() => setMode('simple')}
            >
              {t(lang, 'qrSimpleTab')}
            </button>
            <button
              type="button" role="tab" aria-selected={mode === 'relay'}
              className={`seg-opt${mode === 'relay' ? ' is-active' : ''}`}
              onClick={() => setMode('relay')}
            >
              {t(lang, 'qrRelayTab')}
            </button>
          </div>

          {mode === 'simple' && simpleText && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              {qrErr ? (
                <p className="sub" role="alert">{qrErr}</p>
              ) : qrUrl ? (
                <img
                  src={qrUrl}
                  alt={t(lang, 'qrTitle')}
                  width={280}
                  height={280}
                  style={{ border: '2px solid #1a1a1a', borderRadius: 8, background: '#fff' }}
                />
              ) : (
                <p className="sub" aria-live="polite">…</p>
              )}
              <p className="sub" style={{ marginTop: 8 }}>
                <Icon name="eye" size={12} /> {t(lang, 'qrSimpleNote')}
              </p>
              <details style={{ marginTop: 8, textAlign: 'left' }}>
                <summary className="sub">{t(lang, 'qrShowText')}</summary>
                <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{simpleText}</pre>
              </details>
            </div>
          )}

          {mode === 'relay' && built && !built.ok && (
            <p className="sub" role="alert">
              <Icon name="close" size={14} /> {t(lang, 'qrTooLarge')}
            </p>
          )}

          {mode === 'relay' && envelope && !relayAllowed && (
            <p className="sub" role="alert">
              <Icon name="close" size={14} />{' '}
              {fill('qrHopRefused', { hops: envelope.hops, limit: envelope.hop_limit })}
            </p>
          )}

          {mode === 'relay' && envelope && relayAllowed && frames.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <div className="chip-row" style={{ justifyContent: 'center', marginBottom: 8 }}>
                <span className="chip">
                  <Icon name="route" size={12} />{' '}
                  {fill('qrHopChip', { hops: envelope.hops, limit: envelope.hop_limit })}
                </span>
                {envelope.official && (
                  <span className="chip"><Icon name="shield" size={12} /> {t(lang, 'qrOfficialKept')}</span>
                )}
              </div>
              {qrErr ? (
                <p className="sub" role="alert">{qrErr}</p>
              ) : qrUrl ? (
                <img
                  src={qrUrl}
                  alt={fill('qrFrameOf', { i: frameIdx + 1, n: frames.length })}
                  width={280}
                  height={280}
                  style={{ border: '2px solid #1a1a1a', borderRadius: 8, background: '#fff' }}
                />
              ) : (
                <p className="sub" aria-live="polite">…</p>
              )}
              <p className="sub" role="status" style={{ marginTop: 8 }}>
                {fill('qrFrameOf', { i: frameIdx + 1, n: frames.length })}
              </p>
              <div className="stepper" aria-hidden="true" style={{ justifyContent: 'center' }}>
                {frames.map((_, i) => (
                  <div key={i} className={`step${i === frameIdx ? ' is-now' : i < frameIdx ? ' is-done' : ''}`}>
                    <div className="step-s mono">{i + 1}</div>
                  </div>
                ))}
              </div>
              <p className="sub" style={{ marginTop: 8 }}>
                <Icon name="eye" size={12} /> {t(lang, 'qrKeepSteady')}
              </p>
              <p className="sub" style={{ marginTop: 4 }}>
                <Icon name="info" size={12} /> {t(lang, 'qrRelayNote')}
              </p>
            </div>
          )}
        </>
      )}
    </>
  );

  if (bare) return body;
  return (
    <Card
      title={t(lang, 'qrTitle')}
      sub={t(lang, 'qrSub')}
    >
      {body}
    </Card>
  );
}
