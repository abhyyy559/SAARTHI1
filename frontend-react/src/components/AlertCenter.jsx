// Alert Center rebuilt for people who cannot read: every alert is a CARD with a
// HAZARD icon, an official severity colour and ONE short translated word
// (Danger / Be alert / Be careful / All clear / Not sure) before any sentence is
// read. Details are secondary; Listen and Ask are the actions.
//
// The verdict is the backend's, decided once in verdict_service.py. This file
// renders `warn.verdict` and never re-derives, upgrades or recolours a LEVEL.
// What it does map is the OFFICIAL severity CODE the source sent
// (RED/ORANGE/YELLOW/GREEN) to a colour and a word - that is rendering the
// source's own value, not grading it. A warning the backend could not validate
// renders as UNKNOWN with an unconfirmed marker, never at full severity.
//
// The three empty states are deliberately different, and none may imply safety
// it cannot confirm:
//   1. service reached us, nothing active  -> GREEN all-clear
//   2. service unreachable                 -> GREY "cannot check", never a tick
//   3. alerts exist for another district   -> BLUE "nearby", not covering you
import { useCallback, useEffect, useState } from 'react';
import './AlertCenter.css';
import { api, demoAlertApi } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { isExpired, formatValidUntil, formatCountdown, minutesSince } from '../format';
import Icon from './icons';

// Official severity code -> the one word a non-reader sees. Codes are never
// translated, and no code is ever invented here.
const SEV_WORD = { RED: 'sevRed', ORANGE: 'sevOrange', YELLOW: 'sevYellow', GREEN: 'sevGreen' };
const sevKey = (s) => SEV_WORD[s] || 'sevUnknown';

// Hazard text -> glyph, so the threat is readable before the word. Matched only
// against the hazard/event/headline the source actually sent; nothing inferred.
// Word boundaries matter: "wheat" must not match "heat".
const HAZARD_ICON = [
  [/\b(lightning|thunder|squall)\b/, 'bolt'],
  [/\b(hail|storm)\b/, 'storm'],
  [/\b(cyclone|wind|winds|gust|gusty|gale)\b/, 'wind'],
  [/\b(flood|flooding|inundat\w*|waterlog\w*|surge)\b/, 'flood'],
  [/\b(rain|rains|rainfall|shower|showers|drizzle)\b/, 'rain'],
  [/\b(heat|heatwave|hot|temperature)\b/, 'heat'],
  [/\b(snow|cold|frost|chill)\b/, 'snow'],
  [/\b(fog|smog|visibility|dust)\b/, 'fog'],
  [/\b(fire|flame|flames)\b/, 'flame'],
  [/\b(wave|waves|swell|sea|marine|coastal)\b/, 'wave'],
  [/\b(landslide|rockfall|avalanche)\b/, 'mountain'],
];
function hazardIcon(a) {
  const text = `${a.hazard || ''} ${a.event || ''} ${a.headline || ''}`.toLowerCase();
  for (const [re, icon] of HAZARD_ICON) if (re.test(text)) return icon;
  return null;
}

// The four states the page can be in. `alerts` wins whenever a real alert
// exists: an alert is never replaced by an empty-state panel.
const EMPTY = {
  clear: { icon: 'check', cls: 'is-clear', title: 'alertsNoneTitle', body: 'alertsNoneBody' },
  unavailable: { icon: 'offline', cls: 'is-unavailable', title: 'alertsCannotTitle', body: 'alertsCannotBody' },
  nearby: { icon: 'map', cls: 'is-nearby', title: 'alertsNearbyTitle', body: 'alertsNearbyBody' },
};

// Map backend lifecycle states to i18n keys
const STATE_I18N_KEY = {
  'UPCOMING': 'stUpcoming',
  'PRE-ALERT': 'stPreAlert',
  'ACTIVE': 'stActive',
  'UPDATED': 'stUpdated',
  'EXTENDED': 'stExtended',
  'ENDED': 'stEnded',
  'CANCELLED': 'stCancelled',
};

function AlertCard({ a, nowMs, nearby = false, onClick, children }) {
  const { lang, speak, setView, setPendingAsk, loc } = useApp();
  const sev = a.severity || 'UNKNOWN';
  const exp = isExpired(a.valid_until || a.expires, nowMs);
  const until = formatValidUntil(a.valid_until || a.expires);
  const countdown = formatCountdown(a.valid_until || a.expires, nowMs);
  const head = (a.headline || a.message || a.hazard || a.event || '').trim();
  const area = a.areaDesc || a.area;
  const ageMin = minutesSince(a.issued_at || a.sent, nowMs);
  // Hazard first (what is coming), official severity colour second, severity
  // icon only when the source told us nothing about the hazard.
  const icon = hazardIcon(a) || (sev === 'GREEN' ? 'check' : sev === 'UNKNOWN' ? 'help' : 'alert');
  const spoken = `${a.hazard || a.event || ''}. ${head}. ${a.instruction || ''}`;
  const ask = (e) => {
    e.stopPropagation();
    setPendingAsk(`Tell me about this alert: ${a.hazard || a.event || ''} in ${area || loc.district}`);
    setView('ask');
  };
  // Lifecycle state from backend — never re-derived here
  const lifecycleState = String(a.lifecycle_state || a.state || 'UPCOMING').toUpperCase();
  const stateLabel = STATE_I18N_KEY[lifecycleState] ? t(lang, STATE_I18N_KEY[lifecycleState]) : lifecycleState;
  const stateKey = lifecycleState.toLowerCase().replace(/[^a-z]/g, '');
  // Lifecycle rail: detected → issued → live → resolved. The backend state is
  // only *presented* on this rail (index lookup into the existing stateKey);
  // nothing is re-derived.
  const LC_STEPS = [
    { key: 'lcDetected', states: ['upcoming'] },
    { key: 'lcIssued', states: ['prealert'] },
    { key: 'lcLive', states: ['active', 'updated', 'extended'] },
    { key: 'lcResolved', states: ['ended', 'cancelled'] },
  ];
  const lcIndex = Math.max(0, LC_STEPS.findIndex((s) => s.states.includes(stateKey)));

  return (
    <article
      className={`alert-card${exp ? ' is-expired' : ''}${nearby ? ' is-nearby' : ''}`}
      data-sev={sev}
      data-unconf={a.unconfirmed ? 'true' : undefined}
      data-state={stateKey}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <ol className="lc-steps" aria-hidden="true">
        {LC_STEPS.map((s, i) => (
          <li key={s.key} className={`lc-step${i === lcIndex ? ' is-now' : ''}${i < lcIndex ? ' is-done' : ''}`}>
            <span className="lc-dot" />
            <span className="lc-name">{t(lang, s.key)}</span>
          </li>
        ))}
      </ol>
      <span className="alert-icon" data-sev={sev} aria-hidden><Icon name={icon} size={26} /></span>
      <div className="alert-body">
        <div className="alert-sevrow">
          <span className="alert-sevword">{t(lang, sevKey(sev))}</span>
          <span className={`demo-state st-${stateKey}`}>{stateLabel}</span>
          {nearby && (
            <span className="alert-nearby-badge"><Icon name="map" size={12} />{t(lang, 'alertsNearbyBadge')}</span>
          )}
          {a.unconfirmed && (
            <span className="alert-unconf"><Icon name="help" size={12} />{t(lang, 'basisUnverified')}</span>
          )}
          {exp && <span className="alert-exp">{t(lang, 'verdictExpired')}</span>}
        </div>
        {head && <div className="alert-headline">{head}</div>}
        <div className="alert-area">
          {area && <><Icon name="pin" size={13} /><span>{area}</span></>}
          {until && !exp && (
            <><span>·</span><Icon name="clock" size={13} /><span>{until}{countdown && countdown !== 'expired' ? ` (${countdown})` : ''}</span></>
          )}
          {exp && <><span>·</span><span>{t(lang, 'staleMay')}</span></>}
          {ageMin != null && <><span>·</span><span>{t(lang, 'agoPattern').replace('{m}', ageMin)}</span></>}
        </div>
        <div className="alert-actions">
          <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); speak(spoken); }}>
            <Icon name="speaker" size={14} /> {t(lang, 'alertsListen')}
          </button>
          <button type="button" className="btn ghost sm" onClick={ask}>{t(lang, 'alertsAsk')}</button>
        </div>
        {children}
      </div>
    </article>
  );
}

// One block, three looks. The icon and the colour carry the meaning before the
// words are read: tick/green, offline/grey, map/blue.
function EmptyState({ state, nearbyCount = 0, onRetry }) {
  const { lang } = useApp();
  const cfg = EMPTY[state];
  return (
    <div className={`alert-none ${cfg.cls}`} data-state={state}>
      <Icon name={cfg.icon} size={52} className="big" />
      <div className="alert-headline">{t(lang, cfg.title)}</div>
      <p className="sub">{t(lang, cfg.body).replace('{n}', nearbyCount)}</p>
      {state === 'unavailable' && (
        <button type="button" className="btn ghost sm" onClick={onRetry}>
          <Icon name="refresh" size={14} /> {t(lang, 'alertsRetry')}
        </button>
      )}
    </div>
  );
}

// Official alerts that did NOT verify for this district. They are context and
// must never read like the user's own warning, so every card here is dashed,
// tinted and badged "nearby". When there is no alert of the user's own, this
// section carries the whole state-3 banner.
function NearbySection({ alerts, prominent, nowMs }) {
  const { lang } = useApp();
  return (
    <section className={`nearby-sec${prominent ? ' is-prominent' : ''}`}>
      {prominent ? (
        <EmptyState state="nearby" nearbyCount={alerts.length} />
      ) : (
        <div className="nearby-head">
          <Icon name="map" size={18} />
          <h2>{t(lang, 'alertsNearbyTitle')}</h2>
        </div>
      )}
      {!prominent && <p className="sub">{t(lang, 'alertsNearbySub')}</p>}
      <div className="alert-stack">
        {alerts.map((a, i) => <AlertCard key={a.identifier || i} a={a} nowMs={nowMs} nearby />)}
      </div>
    </section>
  );
}

// Community observations: user-submitted, COMMUNITY provenance, never official
// and never auto-promoted to a warning.
const REPORT_TYPES = [
  { id: 'flooding', icon: 'flood', key: 'rtFlooding' },
  { id: 'road_blocked', icon: 'route', key: 'rtRoadBlocked' },
  { id: 'fallen_tree', icon: 'crop', key: 'rtFallenTree' },
  { id: 'damage', icon: 'alert', key: 'rtDamage' },
  { id: 'waterlogging', icon: 'drop', key: 'rtWaterlogging' },
];
const REPORT_ICON = Object.fromEntries(REPORT_TYPES.map((r) => [r.id, r.icon]));
const REPORT_WORD = Object.fromEntries(REPORT_TYPES.map((r) => [r.id, r.key]));

/** Demo-only controls: fire the start → clear notification cycle on demand. */
function NotifyDemo() {
  const { lang, demoMode, simulateAlert, simulateClear, notifyPerm, pushReady, sendTestPush } = useApp();
  if (!demoMode) return null;
  const blocked = notifyPerm !== 'granted';
  return (
    <div className="row" style={{ alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <button type="button" className="btn ghost sm" onClick={simulateAlert}>
        <Icon name="bell" size={15} /> {t(lang, 'demoAlert')}
      </button>
      <button type="button" className="btn ghost sm" onClick={simulateClear}>
        <Icon name="check" size={15} /> {t(lang, 'demoClear')}
      </button>
      {/* This one is sent by the SERVER, so it is the honest proof of the
          closed-app path: close the tab, then press it from another device. */}
      <button
        type="button"
        className="btn ghost sm"
        onClick={sendTestPush}
        disabled={!pushReady}
        title={pushReady ? t(lang, 'demoPushHint') : t(lang, 'notifyPushFailed')}
        style={{ opacity: pushReady ? 1 : 0.5 }}
      >
        <Icon name={pushReady ? 'wifi' : 'offline'} size={15} /> {t(lang, 'notifyTestSent')}
      </button>
      <span className="mono" style={{ color: blocked ? 'var(--off)' : 'var(--ink-3)' }}>
        {blocked ? t(lang, 'notifyBlocked') : pushReady ? t(lang, 'notifyOnBackground') : t(lang, 'demoNotifyHint')}
      </span>
    </div>
  );
}

export default function AlertCenter() {
  const { loc, lang, syncTick, publishVerdict } = useApp();
  // Everything fetched is stamped with the location it was fetched for, so a
  // slow reply for the old district can never be shown under the new one — and
  // the reset happens during render instead of as a cascading effect setState.
  const locKey = `${loc.district}|${loc.lat}|${loc.lon}`;
  const [warnAt, setWarnAt] = useState(null);        // { key, data } | null
  const [reportsAt, setReportsAt] = useState(null);  // { key, items } | null
  const [form, setForm] = useState({ report_type: 'flooding', text: '' });
  const [reportNote, setReportNote] = useState('');
  const [tick, setTick] = useState(0);
  // Expiry must be evaluated against the CURRENT time. A frozen mount-time clock
  // keeps expired alerts looking active, which is a safety bug, not a cosmetic one.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    api.warnings(loc.district, loc.lat, loc.lon)
      .then((d) => { if (alive) setWarnAt({ key: locKey, data: d }); })
      .catch(() => { if (alive) setWarnAt({ key: locKey, data: { status: 'unavailable' } }); });
    api.reports(loc.district)
      .then((d) => { if (alive) setReportsAt({ key: locKey, items: d.reports || [] }); })
      .catch(() => { /* offline - keep the reports we already have */ });
    return () => { alive = false; };
  }, [locKey, loc.district, loc.lat, loc.lon, syncTick, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const warn = warnAt && warnAt.key === locKey ? warnAt.data : null;
  const reports = reportsAt && reportsAt.key === locKey ? reportsAt.items : [];

  // One verdict, from the backend. The Alerts page and the Home hero must agree.
  const verdict = warn?.verdict || null;

  // Publish it so the notification watcher sees the same verdict this screen
  // renders — one source of severity, and the alerts feature cannot drift from it.
  useEffect(() => {
    if (verdict) publishVerdict(verdict, loc.district);
  }, [verdict, loc.district, publishVerdict]);
  // No verdict at all is not a calm: with nothing to render we cannot confirm.
  const basis = verdict?.basis || 'unavailable';

  const verifiedWarning = !!(warn?.verified && warn.verified.verified);
  const alerts = [...(warn?.cap_alerts || [])];
  const nearby = [...(warn?.nearby_alerts || [])];
  if (warn?.warning) {
    if (verifiedWarning || basis === 'unverified_warning') {
      // A warning the backend could NOT validate must never render at full
      // severity - it would contradict the verdict shown on Home.
      alerts.unshift({
        ...warn.warning,
        headline: warn.warning.message,
        area: warn.warning.district,
        severity: verifiedWarning ? warn.warning.severity : 'UNKNOWN',
        unconfirmed: !verifiedWarning,
      });
    } else {
      // The warning we received is for another district. It is context, not
      // this district's warning, so it belongs in the nearby stack.
      nearby.push({
        ...warn.warning,
        headline: warn.warning.message,
        severity: 'UNKNOWN',
        unconfirmed: true,
      });
    }
  }

  const state = alerts.length > 0 ? 'alerts'
    : basis === 'unavailable' ? 'unavailable'
      : nearby.length > 0 ? 'nearby'
        : 'clear';

  async function submitReport(e) {
    e.preventDefault();
    setReportNote('');
    try {
      const r = await api.report({ ...form, latitude: loc.lat, longitude: loc.lon, district: loc.district });
      if (r.report) {
        setReportsAt({ key: locKey, items: [...reports, r.report] });
        setForm({ report_type: 'flooding', text: '' });
      } else {
        setReportNote(`${t(lang, 'commRejected')}${r.reason ? ` ${r.reason}` : ''}`);
      }
    } catch {
      setReportNote(t(lang, 'commOffline'));
    }
  }

  return (
    <section className="panel">
      <h2>{t(lang, 'alertsTitle')} · {loc.district}</h2>
      {/* Demo-only: fire a warning and its all-clear through the real
          notification path, so the cycle can be shown without waiting for NDMA.
          Hidden outside demo mode — it is a demonstration, not a control. */}
      <NotifyDemo />
      {!warn ? (
        <div className="mono">{t(lang, 'alertsLoading')}</div>
      ) : state === 'alerts' ? (
        <div className="alert-stack">
          {alerts.map((a, i) => <AlertCard key={a.identifier || i} a={a} nowMs={nowMs} />)}
        </div>
      ) : state === 'nearby' ? null : (
        // Rendered by NearbySection below, which carries the state-3 banner.
        <EmptyState state={state} nearbyCount={nearby.length} onRetry={reload} />
      )}

      {nearby.length > 0 && (
        <NearbySection alerts={nearby} prominent={state === 'nearby'} nowMs={nowMs} />
      )}

      <h2 style={{ marginTop: 20 }}>{t(lang, 'commTitle')}</h2>
      <p className="sub">{t(lang, 'commSub')}</p>
      {reports.length === 0 ? <p className="sub">{t(lang, 'commEmpty')}</p> : reports.map((r) => (
        <div className="evrow" key={r.report_id}>
          <span className="k rep-k">
            <Icon name={REPORT_ICON[r.report_type] || 'info'} size={13} />
            {REPORT_WORD[r.report_type] ? t(lang, REPORT_WORD[r.report_type]) : String(r.report_type).replaceAll('_', ' ')}
            {' · '}{r.district}
          </span>
          <span>{r.text} <span className="prov COMMUNITY">COMMUNITY</span></span>
        </div>
      ))}
      <div className="pick-grid">
        {REPORT_TYPES.map((rt) => (
          <button
            key={rt.id}
            type="button"
            className="pick-tile"
            aria-pressed={form.report_type === rt.id}
            onClick={() => setForm({ ...form, report_type: rt.id })}
          >
            <Icon name={rt.icon} size={22} />
            <span>{t(lang, rt.key)}</span>
          </button>
        ))}
      </div>
      <form onSubmit={submitReport} className="row">
        <input
          type="text"
          placeholder={t(lang, 'commWhatPh')}
          aria-label={t(lang, 'commWhatPh')}
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          style={{ flex: 1 }}
        />
        <button className="btn" type="submit"><Icon name="send" size={14} /> {t(lang, 'commSend')}</button>
      </form>
      {reportNote ? <p className="mono" role="status">{reportNote}</p> : null}
    </section>
  );
}
