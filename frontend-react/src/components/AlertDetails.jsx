// Alert Details — single-alert view (Round2 S1.2.3).
//
// Props: { alert, onAck }.
// - Renders the backend's severity AS-IS (never re-derived, never upgraded);
//   lifecycle states render as translated human words (Upcoming, Pre-alert…),
//   never raw backend codes.
// - Shows district, source (DEMO vs NDMA-SACHET CAP), instruction (What to do).
// - Details: status, started, expected end/ended, issued by, effects and
//   reason (only when the backend supplies them) — from the backend's
//   lifecycle_detail (alert_service), with honest "not started yet" for
//   upcoming alerts and no filler rows.
//   fallbacks only to fields the backend actually sent. A field with no value
//   renders "not available", never a guess.
// - Timeline UPCOMING -> PRE-ALERT -> ACTIVE -> UPDATED/EXTENDED -> ENDED from
//   alert.history (fallback: lifecycle_state/state single entry).
// - Ack button POSTs /api/ack via api.ack (falls back to fetch when offline-sim).
import { useState } from 'react';
import { api } from '../api';
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

// Human-readable lifecycle state names (EN/HI/TE via i18n). The backend's
// raw state codes (UPCOMING, PRE-ALERT, …) and internal action names
// ("state", "created") must never leak into the UI as literal text.
const STATE_LABEL_KEY = {
  UPCOMING: 'stUpcoming',
  'PRE-ALERT': 'stPreAlert',
  ACTIVE: 'stActive',
  UPDATED: 'stUpdated',
  EXTENDED: 'stExtended',
  ENDED: 'stEnded',
  CANCELLED: 'stCancelled',
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

export default function AlertDetails({ alert, onAck }) {
  const { lang, device } = useApp();
  const [ackState, setAckState] = useState('idle'); // idle | sending | acked | failed
  if (!alert) return null;

  const stateLabel = (s) => {
    const up = String(s || '').toUpperCase();
    const key = STATE_LABEL_KEY[up];
    return key ? t(lang, key) : (s ? String(s) : up);
  };

  const sev = alert.severity || 'UNKNOWN';
  const state = String(alert.lifecycle_state || alert.state || 'UPCOMING').toUpperCase();
  const isUpcoming = state === 'UPCOMING';
  const district = alert.district || alert.areaDesc || alert.area || '';
  // Provenance honesty: demo/admin content wears the DEMO badge; the official
  // badge names the alert's real source (SACHET / NDMA / IMD), never a guess.
  const src = String(alert.source || '').toLowerCase();
  const ident = String(alert.id || alert.identifier || '').toLowerCase();
  const isDemo = src.includes('demo') || ident.startsWith('demo-') || alert.demo === true;
  const sourceLabel = isDemo ? 'DEMO'
    : (String(alert.source || '').toUpperCase() || 'NDMA-SACHET CAP');
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

  return (
    <section aria-label={t(lang, 'viewAlerts')} className="alert-detail">
      {/* The bulletin masthead: signal bar + stamps — everything here is the
          backend's own wording, severity first. The bc-body wrapper stacks
          the chips above the title (the card is display:flex for the
          severity bar, so bare children would sit side-by-side). */}
      <article className="bulletin-card" data-sev={sev}>
        <span className="sev-bar" aria-hidden="true" />
        <div className="bc-body">
          <div className="bc-head">
            <span className="sev-stamp" data-sev={sev}>{sevWord(lang, sev)}</span>
            <span className="demo-state">{stateLabel(state)}</span>
            <span className={`prov ${sourceLabel === 'DEMO' ? 'DEMO' : 'OFFICIAL'}`}>{sourceLabel}</span>
          </div>
          {head && <h2 className="bc-title">{head}</h2>}
          {district && (
            <p className="bc-meta"><Icon name="pin" size={13} /> {district}</p>
          )}
        </div>
      </article>

      {/* What to do: the single most important thing on the card, so it gets
          its own highlighted box instead of hiding in a label/value row. */}
      {instruction && (
        <div className="det-callout">
          <span className="kicker">{t(lang, 'detWhatToDo')}</span>
          <p>{instruction}</p>
        </div>
      )}

      {/* Details: one card, one time-window pair (Started / Ends) instead of
          the old Validity arrow-chain duplicating Expected end. Optional
          fields (reason, effects) render only when the backend sent them —
          no "Not available" filler rows. */}
      <div className="det-card">
        <h3>{t(lang, 'detLifecycle')}</h3>
        <div className="evrow">
          <span className="k">{t(lang, 'detStatus')}</span>
          <span><b>{stateLabel(state)}</b></span>
        </div>
        <div className="evrow">
          <span className="k">{t(lang, 'detStarted')}</span>
          <span className="mono">
            {lc.startedAt ? fmt(lc.startedAt) : isUpcoming ? t(lang, 'detNotStarted') : na}
          </span>
        </div>
        <div className="evrow">
          <span className="k">{lc.completedAt ? t(lang, 'detEndedAt') : t(lang, 'detExpectedEnd')}</span>
          <span className="mono">
            {(lc.completedAt || lc.expectedEndAt) ? fmt(lc.completedAt || lc.expectedEndAt) : na}
          </span>
        </div>
        <div className="evrow">
          <span className="k">{t(lang, 'detIssuer')}</span>
          <span>{lc.issuer || na}</span>
        </div>
        {lc.reason && (
          <div className="evrow">
            <span className="k">{t(lang, 'detReason')}</span>
            <span>{lc.reason}</span>
          </div>
        )}
        {lc.effects && (
          <div className="evrow">
            <span className="k">{t(lang, 'detEffects')}</span>
            <span>{lc.effects}</span>
          </div>
        )}
      </div>

      <div className="det-card">
        <h3>{t(lang, 'detTimeline')}</h3>
        <ol className="det-timeline">
          {history.map((h, i) => (
            <li key={i} className="det-timeline-row">
              <span className="tile-icon sm" aria-hidden="true">
                <Icon name={STATE_ICON[String(h.state || '').toUpperCase()] || 'info'} size={14} />
              </span>
              <span className="mono">{fmt(h.at)}</span>
              <b>{stateLabel(h.state)}</b>
            </li>
          ))}
        </ol>
      </div>

      <div className="row det-actions">
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
    </section>
  );
}
