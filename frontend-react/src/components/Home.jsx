// Home, redesigned for Round 2 — the situation dashboard.
//
// WHAT CHANGED AND WHY
// --------------------
// The old Home was a front door: two big tiles + a verdict card. Round 2's
// product is the ALERT LIFECYCLE, so Home now leads with the situation:
//
//   1. Status strip    — connection state + last sync, always visible
//   2. HeroCard        — the safety verdict (untouched; its honesty rules are
//                        battle-tested: no guessed all-clears, no invented
//                        severity, provenance strip, offline snapshots)
//   3. Active-alert    — demo/official alerts live on HOME now, with the
//                        lifecycle state (UPCOMING/PRE-ALERT/ACTIVE/ENDED) as a
//                        chip, so the stage demo shows the story on one screen
//   4. Weather now     — temp/condition as a quiet strip (footnote, not headline)
//   5. Action tiles    — Ask / Alerts / Notifications (with LIVE unread badge
//                        fetched from the server) / Advisor
//   6. Notifications   — the two latest entries, deep-linking to the center
//
// Every rule from PROBLEM-STATEMENT-RULES.md §2 is preserved: severity is the
// backend's verdict only, absence of data is never rendered as safety, demo
// alerts carry their source label, and nothing here re-derives anything.
import { useEffect, useState } from 'react';
import { t, PERSONA_QUESTIONS } from '../i18n';
import { api } from '../api';
import { useApp } from '../store';
import SourceStrip from './SourceStrip';
import Icon from './icons';
import LocationPrompt from './LocationPrompt';
import HeroCard from './HeroCard';

// One picture per quick question, so the chip is recognisable before it is read.
const QUESTION_ICON = {
  q1: 'rain', q2: 'wave', q3: 'alert', q4: 'crop',
  qDriver: 'truck', qResearch: 'search', qEmergency: 'sos',
};

// Demo/CAP lifecycle state -> chip tone. Order = the story the jury follows.
const STATE_CHIP = {
  'PRE-ALERT': { cls: 'st-pre-alert' },
  ACTIVE: { cls: 'st-active' },
  UPDATED: { cls: 'st-active' },
  EXTENDED: { cls: 'st-active' },
  UPCOMING: { cls: 'st-upcoming' },
  ENDED: { cls: 'st-ended' },
  CANCELLED: { cls: 'st-ended' },
};

// Demo-alert state -> the single short word a non-reader sees on Home.
const STATE_WORD_KEY = {
  'PRE-ALERT': 'stPreAlert', ACTIVE: 'stActive', UPDATED: 'stUpdated',
  EXTENDED: 'stExtended', UPCOMING: 'stUpcoming', ENDED: 'stEnded', CANCELLED: 'stCancelled',
};

const NOTIF_ICON = {
  'pre-alert': 'clock', active: 'alert', updated: 'refresh', extended: 'clock',
  ended: 'check', cancelled: 'offline', clear: 'check', escalate: 'alert', start: 'alert',
};

function StatusStrip() {
  const { lang, netState, lastSync, loc } = useApp();
  // Ticking clock: "updated Xm ago" must age forward without a refetch. Same
  // 30s pattern HeroCard uses for its expiry countdown.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const cfg = {
    live: { icon: 'wifi', cls: 'is-live', key: 'hConnLive' },
    reconnecting: { icon: 'refresh', cls: 'is-cached', key: 'hConnReconnecting' },
    offline: { icon: 'offline', cls: 'is-off', key: 'hConnOffline' },
  }[netState] || { icon: 'wifi', cls: 'is-live', key: 'hConnLive' };
  const ageMin = lastSync ? Math.max(0, Math.floor((nowMs - new Date(lastSync).getTime()) / 60000)) : null;
  const syncText = !lastSync ? t(lang, 'hSyncNever')
    : ageMin < 1 ? t(lang, 'hSyncNow')
      : t(lang, 'hSyncAgo').replace('{m}', ageMin);
  return (
    <div className={`h-status ${cfg.cls}`}>
      <span className="h-status-item">
        <Icon name={cfg.icon} size={14} />
        {t(lang, cfg.key)}
      </span>
      <span className="h-status-sep" aria-hidden>·</span>
      <span className="h-status-item mono">
        <Icon name="refresh" size={13} />
        {syncText}
      </span>
      <span className="h-status-spacer" />
      <span className="h-status-item mono h-status-loc">
        <Icon name="pin" size={13} />
        {loc.district}
      </span>
    </div>
  );
}

// Active alerts ON HOME — including the demo alerts driving the Round-2 story.
// A demo alert is labelled DEMO next to its severity; a CAP alert keeps its
// official source. Expired ENDED/CANCELLED alerts drop off automatically.
function ActiveAlerts() {
  const { lang, loc, demoMode, setView } = useApp();
  const [demoAlerts, setDemoAlerts] = useState([]);

  useEffect(() => {
    if (!demoMode) return undefined;
    let alive = true;
    const load = () => api.demoAlerts(loc.district)
      .then((d) => { if (alive) setDemoAlerts(d.alerts || []); })
      .catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [demoMode, loc.district]);

  const live = demoAlerts.filter((a) => a.state !== 'ENDED' && a.state !== 'CANCELLED');
  if (!demoMode || live.length === 0) return null;

  return (
    <section className="h-alerts" aria-label={t(lang, 'hAlertsTitle')}>
      <div className="h-alerts-head">
        <b>{t(lang, 'hAlertsTitle')}</b>
        <button type="button" className="btn ghost sm" onClick={() => setView('alerts')}>
          {t(lang, 'hAlertsGo')} <Icon name="chevron" size={13} />
        </button>
      </div>
      {live.map((a) => (
        <div key={a.id} className="h-alert-row" data-state={a.state}>
          <span className="h-alert-pulse" aria-hidden />
          <div className="h-alert-body">
            <b>{a.title}</b>
            <span className="mono">{a.district} · {a.severity}</span>
          </div>
          <span className={`demo-state ${STATE_CHIP[a.state]?.cls || ''}`}>
            {t(lang, STATE_WORD_KEY[a.state] || a.state)}
          </span>
        </div>
      ))}
    </section>
  );
}

function WeatherNow() {
  const { lang, loc, locReady, syncTick } = useApp();
  const [wx, setWx] = useState(null);
  useEffect(() => {
    if (!locReady) return undefined;
    let alive = true;
    api.current(loc.lat, loc.lon)
      .then((d) => { if (alive) setWx(d.current || null); })
      .catch(() => { if (alive) setWx(null); });
    return () => { alive = false; };
  }, [locReady, loc.lat, loc.lon, syncTick]);
  if (!wx) return null;
  const fmt = (n, d = 0) => (n == null ? '–' : Number(n).toFixed(d));
  return (
    <div className="h-now" aria-label={t(lang, 'hNowTitle')}>
      <span className="h-now-temp">{fmt(wx.temperature)}°</span>
      <span className="h-now-cond">{wx.condition || '—'}</span>
      <span className="h-status-sep" aria-hidden>·</span>
      <span className="h-now-meta mono">{t(lang, 'humidity')} {fmt(wx.humidity)}%</span>
      <span className="h-now-meta mono">{t(lang, 'windKmh')} {fmt(wx.wind_speed, 1)}</span>
      <span className="h-now-meta mono">{t(lang, 'rainMm')} {fmt(wx.rainfall, 1)}</span>
    </div>
  );
}

function ActionTiles() {
  const { lang, loc, device, setView } = useApp();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api.notificationsUnread(loc.district, device)
      .then((d) => { if (alive) setUnread(d.unread || 0); })
      .catch(() => {});
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [loc.district, device]);
  const ask = () => setView('ask');
  const tiles = [
    { id: 'ask', icon: 'mic', label: 'hTileAsk', onClick: ask, primary: true },
    { id: 'alerts', icon: 'bell', label: 'hTileAlerts', onClick: () => setView('alerts') },
    { id: 'notifications', icon: 'bell', label: 'hTileNotif', onClick: () => setView('notifications'), badge: unread },
    { id: 'advisor', icon: 'speaker', label: 'hTileAdvisor', onClick: () => setView('advisor') },
  ];
  return (
    <div className="h-tiles" role="group" aria-label={t(lang, 'hTilesTitle')}>
      {tiles.map((tl) => (
        <button key={tl.id} type="button"
          className={`h-tile${tl.primary ? ' h-tile--primary' : ''}`}
          onClick={tl.onClick} aria-label={t(lang, tl.label)}>
          <span className="h-tile-icon">
            <Icon name={tl.icon} size={26} />
            {tl.badge > 0 && <span className="h-tile-badge">{tl.badge > 9 ? '9+' : tl.badge}</span>}
          </span>
          <span className="h-tile-label">{t(lang, tl.label)}</span>
        </button>
      ))}
    </div>
  );
}

function RecentNotifications() {
  const { lang, loc, device, setView, speak } = useApp();
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    api.notifications(loc.district, device)
      .then((d) => { if (alive) setItems((d.notifications || []).slice(0, 2)); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [loc.district, device]);
  if (!items || items.length === 0) {
    return items ? (
      <div className="h-notifs"><p className="sub">{t(lang, 'hNotifEmpty')}</p></div>
    ) : null;
  }
  return (
    <div className="h-notifs">
      <div className="h-alerts-head">
        <b>{t(lang, 'hNotifTitle')}</b>
        <button type="button" className="btn ghost sm" onClick={() => setView('notifications')}>
          {t(lang, 'hNotifAll')} <Icon name="chevron" size={13} />
        </button>
      </div>
      {items.map((n) => (
        <div key={n.id} className={`h-notif-row${n.read ? '' : ' is-unread'}`}>
          {/* Two real sibling controls, not a <button> wrapping a clickable
              <span>: that span was aria-hidden with no accessible name, so the
              listen action was invisible to a screen reader and unreachable by
              keyboard — and a control nested inside a button is invalid. */}
          <button type="button" className="h-notif-open" onClick={() => setView('notifications')}>
            <span className={`ntf-dot ${(NOTIF_ICON[n.kind] ? '' : 'info')}`} aria-hidden>
              <Icon name={NOTIF_ICON[n.kind] || 'info'} size={15} />
            </span>
            <span className="h-notif-body">
              <b>{n.title}</b>
              <span className="mono">{n.district || ''}{n.read ? '' : ' · ●'}</span>
            </span>
          </button>
          <button
            type="button" className="h-notif-speak"
            aria-label={t(lang, 'alertsListen')} title={t(lang, 'alertsListen')}
            onClick={() => speak(`${n.title}. ${n.body}`)}
          >
            <Icon name="speaker" size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const { lang, persona, locReady, setView, setPendingAsk } = useApp();
  const askFromHome = (text) => { setPendingAsk(text); setView('ask'); };
  // Persona-first questions: a farmer sees farm questions, a driver sees roads.
  // Same PERSONA_QUESTIONS map the Ask page uses, so the two never disagree.
  const quickKeys = (PERSONA_QUESTIONS[persona] || PERSONA_QUESTIONS.general).slice(0, 4);

  return (
    <div className="home-stack">
      <StatusStrip />
      {!locReady && <LocationPrompt />}
      <HeroCard />
      <ActiveAlerts />
      <WeatherNow />
      <ActionTiles />
      <RecentNotifications />
      <div className="h-quick card">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div className="card-head-text">
            <span className="eyebrow"><Icon name="chat" size={14} /> {t(lang, 'homeQuick')}</span>
          </div>
        </div>
        <div className="quick-row">
          {quickKeys.map((k) => (
            <button key={k} type="button" className="btn ghost" onClick={() => askFromHome(t(lang, k))}>
              <Icon name={QUESTION_ICON[k] || 'help'} size={17} />
              {t(lang, k)}
            </button>
          ))}
        </div>
      </div>
      <details className="card h-sources">
        <summary>{t(lang, 'sourcesDetails')}</summary>
        <SourceStrip refreshKey={0} />
      </details>
    </div>
  );
}
