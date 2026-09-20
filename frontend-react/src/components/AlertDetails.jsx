// Alert Details — single-alert view (Round2 S1.2.3).
//
// Props: { alert, onBack, onAck }.
// - Renders the backend's severity/state AS-IS (never re-derived, never upgraded).
// - Shows district, validity window (pre_alert_at/starts_at/ends_at or
//   valid_from/valid_until), source (DEMO vs NDMA-SACHET CAP), instruction.
// - Timeline UPCOMING -> PRE-ALERT -> ACTIVE -> UPDATED/EXTENDED -> ENDED from
//   alert.history (fallback: lifecycle_state/state single entry).
// - Ack button POSTs /api/ack via api.ack (falls back to fetch when offline-sim).
import { useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

const STATE_ICON = {
  UPCOMING: 'clock',
  'PRE-ALERT': 'clock',
  ACTIVE: 'alert',
  UPDATED: 'refresh',
  EXTENDED: 'clock',
  ENDED: 'check',
  CANCELLED: 'offline',
};

function fmt(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return String(ts || '');
  }
}

export default function AlertDetails({ alert, onBack, onAck }) {
  const { lang, device } = useApp();
  const [ackState, setAckState] = useState('idle'); // idle | sending | acked | failed
  if (!alert) return null;

  const sev = alert.severity || 'UNKNOWN';
  const state = String(alert.lifecycle_state || alert.state || 'UPCOMING').toUpperCase();
  const district = alert.district || alert.areaDesc || alert.area || '';
  const source = String(alert.source || alert.provenance || '').toUpperCase();
  const sourceLabel = source.includes('DEMO') || source === 'DEMO'
    ? 'DEMO'
    : (alert.id || alert.identifier || '').startsWith('demo-') ? 'DEMO' : 'NDMA-SACHET CAP';
  const instruction = alert.instruction || '';
  const head = alert.title || alert.headline || alert.message || alert.hazard || alert.event || '';
  const history = Array.isArray(alert.history) ? alert.history
    : [{ at: alert.updated_at || alert.issued_at || alert.sent, action: 'state', state }];

  const doAck = async () => {
    setAckState('sending');
    try {
      await api.ack({
        endpoint: device || 'web-client',
        alert_id: String(alert.id || alert.identifier || ''),
        event: 'acknowledged',
        district,
      });
      setAckState('acked');
      if (onAck) onAck(alert);
    } catch {
      setAckState('failed');
    }
  };

  return (
    <section className="panel alert-details" aria-label={t(lang, 'viewAlerts')}>
      <div className="row" style={{ alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {onBack && (
          <button type="button" className="btn ghost sm" onClick={onBack}>
            <Icon name="chevron" size={14} /> {t(lang, 'back') || 'Back'}
          </button>
        )}
        <span className="alert-sevword" data-sev={sev}>{sev}</span>
        <span className={`demo-state st-${state.toLowerCase().replace(/[^a-z]/g, '')}`}>{state}</span>
        <span className={`prov ${sourceLabel === 'DEMO' ? 'DEMO' : 'OFFICIAL'}`}>{sourceLabel}</span>
      </div>

      {head && <h2 style={{ marginTop: 0 }}>{head}</h2>}
      {district && (
        <p className="sub">
          <Icon name="pin" size={13} /> {district}
        </p>
      )}

      <div className="evrow">
        <span className="k">{t(lang, 'detValidity')}</span>
        <span className="mono">
          {[alert.pre_alert_at || alert.valid_from, alert.starts_at, alert.ends_at || alert.valid_until || alert.expires]
            .filter(Boolean).map(fmt).join('  →  ') || '—'}
        </span>
      </div>

      {instruction && (
        <div className="evrow">
          <span className="k">{t(lang, 'detInstruction')}</span>
          <span>{instruction}</span>
        </div>
      )}

      <h3 style={{ marginTop: 14 }}>{t(lang, 'detTimeline')}</h3>
      <ol className="alert-timeline">
        {history.map((h, i) => (
          <li key={i} className="alert-timeline-row">
            <Icon name={STATE_ICON[String(h.state || '').toUpperCase()] || 'info'} size={14} />
            <span className="mono">{fmt(h.at)}</span>
            <span>{String(h.action || '')}</span>
            <b>{String(h.state || '')}</b>
          </li>
        ))}
      </ol>

      <div className="row" style={{ marginTop: 12 }}>
        <button
          type="button" className="btn sm" onClick={doAck}
          disabled={ackState === 'sending' || ackState === 'acked'}
          title={t(lang, 'ntfAckTitle')}
        >
          <Icon name="check" size={14} />{' '}
          {ackState === 'acked' ? t(lang, 'ntfAcked') : t(lang, 'ntfAck')}
        </button>
        {ackState === 'failed' && <span className="mono">{t(lang, 'detAckFailed')}</span>}
      </div>
    </section>
  );
}
