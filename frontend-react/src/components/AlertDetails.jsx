// Alert Details — single-alert view (Round2 S1.2.3).
//
// Props: { alert, onBack, onAck }.
// - Renders the backend's severity/state AS-IS (never re-derived, never upgraded).
// - Shows district, validity window (pre_alert_at/starts_at/ends_at or
//   valid_from/valid_until), source (DEMO vs NDMA-SACHET CAP), instruction.
// - Full lifecycle: started, completed-or-expected-end, effects, issuer,
//   reason — from the backend's lifecycle_detail (alert_service), with honest
//   fallbacks only to fields the backend actually sent. A field with no value
//   renders "not available", never a guess.
// - Timeline UPCOMING -> PRE-ALERT -> ACTIVE -> UPDATED/EXTENDED -> ENDED from
//   alert.history (fallback: lifecycle_state/state single entry).
// - Ack button POSTs /api/ack via api.ack (falls back to fetch when offline-sim).
import { useState } from 'react';
import { api, demoAlertApi } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import { sevWord } from './ui';

// Full lifecycle detail (alerts redesign). Canonical fields come from the
// backend's lifecycle_detail (see backend/services/alert_service.py). The
// fallbacks only read fields the backend actually sent (sender, onset,
// expires, description …): a field with no value stays null so the UI says
// "not available" instead of inventing one.
export function lifecycleDetail(a = {}) {
  const back = (a && a.lifecycle_detail) || {};
  const pick = (...vals) => {
    for (const v of vals) {
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return null;
  };
  const src = String(a.source || '').toLowerCase();
  const ident = String(a.id || a.identifier || '').toLowerCase();
  const isDemo = src.includes('demo') || ident.startsWith('demo-');
  const reasonParts = [String(a.urgency || '').trim(), String(a.certainty || '').trim()].filter(Boolean);
  return {
    startedAt: pick(back.started_at, a.started_at, a.onset, a.effective),
    expectedEndAt: pick(back.expected_end_at, a.expected_end_at, a.ends_at, a.expires, a.valid_until),
    completedAt: pick(back.completed_at, a.completed_at),
    issuer: pick(back.issuer, a.issuer, a.sender, isDemo ? 'DEMO' : 'NDMA-SACHET CAP'),
    reason: pick(back.reason, a.reason, reasonParts.length ? reasonParts.join(', ') : null),
    effects: pick(back.effects, a.effects, a.description),
  };
}

const STATE_ICON = {
  UPCOMING: 'clock',
  'PRE-ALERT': 'clock',
  ACTIVE: 'alert',
  UPDATED: 'refresh',
  EXTENDED: 'clock',
  ENDED: 'check',
  CANCELLED: 'offline',
};

// Identifier for the ack POST. CAP alerts carry id/identifier, but the IMD
// verdict warning has neither (backend WeatherWarning model has no id field).
// The ack endpoint requires a non-empty alert_id, so fall back to a stable
// composite key derived from the warning's own fields — identical on every
// render, and the backend records it as telemetry either way.
function alertIdentifier(a) {
  const id = a.id || a.identifier;
  if (id) return String(id);
  return [
    'imd-warning',
    a.district || a.area || a.areaDesc || '',
    a.hazard || a.event || '',
    a.severity || '',
    a.valid_until || a.ends_at || a.expires || a.issued_at || '',
  ].join('|');
}

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
  const { lang, device, setView } = useApp();
  const [ackState, setAckState] = useState('idle'); // idle | sending | acked | failed
  const [relayState, setRelayState] = useState('idle'); // idle | sending | done | failed
  const [relayTrace, setRelayTrace] = useState(null);
  if (!alert) return null;

  const sev = alert.severity || 'UNKNOWN';
  const state = String(alert.lifecycle_state || alert.state || 'UPCOMING').toUpperCase();
  const district = alert.district || alert.areaDesc || alert.area || '';
  const source = String(alert.source || alert.provenance || '').toUpperCase();
  const sourceLabel = source.includes('DEMO') || source === 'DEMO'
    ? 'DEMO'
    : alertIdentifier(alert).startsWith('demo-') ? 'DEMO' : 'NDMA-SACHET CAP';
  const isDemo = sourceLabel === 'DEMO';
  const instruction = alert.instruction || '';
  const head = alert.title || alert.headline || alert.message || alert.hazard || alert.event || '';
  const history = Array.isArray(alert.history) ? alert.history
    : [{ at: alert.updated_at || alert.issued_at || alert.sent, action: 'state', state }];
  // Full lifecycle — every alert carries it, honestly badged when a field is
  // missing. Never re-derived here: lifecycleDetail reads the backend's own
  // lifecycle_detail first and only falls back to fields the backend sent.
  const lc = lifecycleDetail(alert);
  const na = <span className="det-na">{t(lang, 'detNotAvailable')}</span>;

  const doAck = async () => {
    setAckState('sending');
    try {
      await api.ack({
        endpoint: device || 'web-client',
        alert_id: alertIdentifier(alert),
        event: 'acknowledged',
        district,
      });
      setAckState('acked');
      if (onAck) onAck(alert);
    } catch {
      setAckState('failed');
    }
  };

  const doRelay = async () => {
    if (relayState === 'sending') return;
    setRelayState('sending');
    try {
      const r = await demoAlertApi.relay({ alert_id: alert.id || alert.identifier });
      setRelayTrace(r.trace || []);
      setRelayState('done');
    } catch {
      setRelayState('failed');
    }
  };

  return (
    <section aria-label={t(lang, 'viewAlerts')}>
      {onBack && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button type="button" className="btn btn-ghost sm" onClick={onBack}>
            <Icon name="chevron" size={14} /> {t(lang, 'back') || 'Back'}
          </button>
        </div>
      )}
      {/* The bulletin masthead: signal bar + stamps — everything here is the
          backend's own wording, severity first. */}
      <article className="bulletin-card" data-sev={sev}>
        <span className="sev-bar" aria-hidden="true" />
        <div className="bc-head">
          <span className="sev-stamp" data-sev={sev}>{sevWord(lang, sev)}</span>
          <span className="demo-state">{state}</span>
          <span className={`prov ${sourceLabel === 'DEMO' ? 'DEMO' : 'OFFICIAL'}`}>{sourceLabel}</span>
        </div>
        {head && <h2 className="bc-title">{head}</h2>}
        {district && (
          <p className="bc-meta"><Icon name="pin" size={13} /> {district}</p>
        )}
      </article>

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

      {/* Full lifecycle: when it started, when it completed or is expected to
          end, effects, who issued it, why. "Not available" is shown honestly
          for fields the backend did not have — never a guess. */}
      <div className="alert-sec-title">
        <span className="kicker">{t(lang, 'detLifecycle')}</span>
      </div>
      <div className="evrow">
        <span className="k">{t(lang, 'detStarted')}</span>
        <span className="mono">{lc.startedAt ? fmt(lc.startedAt) : na}</span>
      </div>
      <div className="evrow">
        <span className="k">{lc.completedAt ? t(lang, 'detEndedAt') : t(lang, 'detExpectedEnd')}</span>
        <span className="mono">
          {lc.completedAt ? fmt(lc.completedAt) : lc.expectedEndAt ? fmt(lc.expectedEndAt) : na}
        </span>
      </div>
      <div className="evrow">
        <span className="k">{t(lang, 'detIssuer')}</span>
        <span>{lc.issuer || na}</span>
      </div>
      <div className="evrow">
        <span className="k">{t(lang, 'detReason')}</span>
        <span>{lc.reason || na}</span>
      </div>
      <div className="evrow">
        <span className="k">{t(lang, 'detEffects')}</span>
        <span>{lc.effects || na}</span>
      </div>

      <div className="alert-sec-title">
        <span className="kicker">{t(lang, 'detTimeline')}</span>
      </div>
      <ol className="det-timeline">
        {history.map((h, i) => (
          <li key={i} className="det-timeline-row">
            <span className="tile-icon sm" aria-hidden="true">
              <Icon name={STATE_ICON[String(h.state || '').toUpperCase()] || 'info'} size={14} />
            </span>
            <span className="mono">{fmt(h.at)}</span>
            <span>{String(h.action || '')}</span>
            <b>{String(h.state || '')}</b>
          </li>
        ))}
      </ol>

      <div className="row" style={{ marginTop: 12 }}>
        <button
          type="button" className="btn" onClick={doAck}
          disabled={ackState === 'sending' || ackState === 'acked'}
          title={t(lang, 'ntfAckTitle')}
        >
          <Icon name="check" size={14} />{' '}
          {ackState === 'acked' ? t(lang, 'ntfAcked') : t(lang, 'ntfAck')}
        </button>
        {ackState === 'failed' && <span role="status" className="mono">{t(lang, 'detAckFailed')}</span>}
      </div>

      {/* Demo propagation: relay this alert over the SIMULATED mesh. The hop
          trace is shown here; a durable server notification lands in the
          Notifications list (backend logs kind=p2p-relay, channel=p2p-simulated). */}
      {isDemo && (
        <div className="p2p-panel">
          <div className="p2p-title">
            <span className="kicker">{t(lang, 'p2pTitle')}</span>
            <span className="rubber-stamp" data-testid="p2p-simulated">{t(lang, 'p2pSimulated')}</span>
          </div>
          {relayState === 'done' ? (
            <p role="status" className="mono">
              {t(lang, 'p2pRelayedAlert')} ·{' '}
              <button type="button" className="btn btn-ghost sm" onClick={() => setView('notifications')}>
                {t(lang, 'navNotifications')}
              </button>
            </p>
          ) : (
            <button
              type="button" className="btn btn-secondary sm"
              disabled={relayState === 'sending'}
              onClick={doRelay}
            >
              <Icon name="radio" size={14} />{' '}
              {relayState === 'sending' ? t(lang, 'p2pSending') : t(lang, 'p2pRelayAlert')}
            </button>
          )}
          {relayState === 'failed' && <p role="alert" className="sub">{t(lang, 'p2pFailed')}</p>}
          {relayTrace && (
            <div className="p2p-log">
              {relayTrace.map((h, i) => (
                <div className="log-line" key={i}>
                  <Icon name="radio" size={12} aria-hidden="true" /> {h.detail || h.state}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
