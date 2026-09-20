// Home — the district dispatch board.
//
//   1. District dispatch strip — kicker "YOUR DISTRICT", the district as a
//      condensed headline, right-aligned location actions, live/updated stamps.
//   2. Verdict bulletin (HeroCard) — the backend's ONE verdict, inverted board.
//   3. Action tiles — Ask SAARTHI / My advice / Alerts / Field reports.
//   4. TODAY'S BULLETINS — official + demo alerts as bulletin cards with
//      signal bars; tapping opens Details (the alert is selected in the store).
//
// Honesty rules: severity is the backend's verdict only, absence of data is
// never rendered as safety, demo alerts carry their source label, and nothing
// here re-derives anything.
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { api } from '../api';
import { useApp } from '../store';
import { minutesSince, isExpired } from '../format';
import Icon from './icons';
import LocationPrompt from './LocationPrompt';
import HeroCard from './HeroCard';
import { sevWord } from './ui';

// Demo/CAP lifecycle state -> translated word key. Order = the story.
const STATE_WORD_KEY = {
  'PRE-ALERT': 'stPreAlert', ACTIVE: 'stActive', UPDATED: 'stUpdated',
  EXTENDED: 'stExtended', UPCOMING: 'stUpcoming', ENDED: 'stEnded', CANCELLED: 'stCancelled',
};

// The district dispatch strip: where am I, and is the board live?
function DispatchStrip() {
  const { lang, netState, lastSync, loc, locReady } = useApp();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const connKey = netState === 'live' ? 'hConnLive' : netState === 'offline' ? 'hConnOffline' : 'hConnReconnecting';
  const ageMin = lastSync ? Math.max(0, Math.floor((nowMs - new Date(lastSync).getTime()) / 60000)) : null;
  const syncText = !lastSync ? t(lang, 'hSyncNever')
    : ageMin < 1 ? t(lang, 'hSyncNow')
    : t(lang, 'hSyncAgo').replace('{m}', ageMin);
  // M3: before a confirmed location there is no district and no live claim —
  // the placeholder must never pretend to be a checked place.
  const hasDistrict = locReady && loc.district;
  return (
    <div className="dispatch-strip" aria-label={t(lang, 'sbDistrictKicker')}>
      <span className="d-flag"><Icon name="pin" size={24} /></span>
      <div>
        <span className="kicker">{t(lang, 'sbDistrictKicker')}</span>
        <div className="dd-title">{hasDistrict ? loc.district : t(lang, 'noDistrict')}</div>
        <div className="dd-sub mono">
          {hasDistrict ? <>{t(lang, connKey)} · {syncText}</> : t(lang, 'noDistrictHint')}
        </div>
      </div>
    </div>
  );
}

function ActionTiles() {
  const { lang, setView } = useApp();
  const tiles = [
    { id: 'ask', icon: 'chat', label: 'hTileAsk', sub: 'viewAskSub', onClick: () => setView('ask') },
    { id: 'advisory', icon: 'sun', label: 'navAdvisory', sub: 'viewAdvisorySub', onClick: () => setView('advisory') },
    { id: 'alerts', icon: 'alert', label: 'hTileAlerts', sub: 'viewAlertsSub', onClick: () => setView('alerts') },
    { id: 'reports', icon: 'crop', label: 'sbTileReports', sub: 'commSub', onClick: () => setView('alerts') },
  ];
  return (
    <div className="tile-grid" role="group" aria-label={t(lang, 'hTilesTitle')}>
      {tiles.map((tl) => (
        <button key={tl.id} type="button" className="tile" onClick={tl.onClick} aria-label={t(lang, tl.label)}>
          <span className="tile-icon"><Icon name={tl.icon} size={26} /></span>
          <span>
            <span className="tile-label">{t(lang, tl.label)}</span>
            <span className="tile-sub">{t(lang, tl.sub)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// TODAY'S BULLETINS — the same warnings feed the Alerts page renders, as
// stamped bulletin cards. Tapping selects the alert and opens Details.
function Bulletins() {
  const { lang, loc, demoMode, setView, setSelectedAlert, speak, syncTick } = useApp();
  const [warnAt, setWarnAt] = useState(null);
  const [demoAt, setDemoAt] = useState(null);
  const locKey = `${loc.district}|${loc.lat}|${loc.lon}`;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    api.warnings(loc.district, loc.lat, loc.lon)
      .then((d) => { if (alive) setWarnAt({ key: locKey, data: d }); })
      .catch(() => { if (alive) setWarnAt({ key: locKey, data: null }); });
    return () => { alive = false; };
  }, [locKey, loc.district, loc.lat, loc.lon, syncTick]);

  useEffect(() => {
    if (!demoMode) { setDemoAt(null); return undefined; }
    let alive = true;
    const load = () => api.demoAlerts(loc.district)
      .then((d) => { if (alive) setDemoAt({ key: locKey, items: d.alerts || [] }); })
      .catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [demoMode, locKey, loc.district]);

  const warn = warnAt && warnAt.key === locKey ? warnAt.data : null;
  const items = [];
  if (warn && warn.warning && !isExpired(warn.warning.valid_until, nowMs)) {
    items.push({
      ...warn.warning,
      headline: warn.warning.message || warn.warning.hazard,
      area: warn.warning.district,
      kind: 'official',
    });
  }
  for (const a of (warn && warn.cap_alerts) || []) {
    if (!isExpired(a.valid_until || a.expires, nowMs)) items.push({ ...a, kind: 'official' });
  }
  const demos = (demoAt && demoAt.key === locKey ? demoAt.items : [])
    .filter((a) => a.state !== 'ENDED' && a.state !== 'CANCELLED');
  for (const a of demos) {
    items.push({
      ...a,
      headline: a.title,
      area: a.district,
      valid_until: a.ends_at,
      issued_at: a.created_at,
      kind: 'demo',
    });
  }
  if (items.length === 0) return null;

  const open = (a) => { setSelectedAlert(a); setView('details'); };

  return (
    <section aria-label={t(lang, 'sbBulletins')}>
      <div className="alert-sec-title">
        <h2 className="display">{t(lang, 'sbBulletins')}</h2>
        <button type="button" className="btn btn-ghost sm" onClick={() => setView('alerts')}>
          {t(lang, 'hAlertsGo')} <Icon name="chevron" size={13} />
        </button>
      </div>
      <div className="bulletin-list">
        {items.slice(0, 6).map((a, i) => {
          const sev = a.severity || 'UNKNOWN';
          const head = (a.headline || a.message || a.hazard || a.event || '').trim();
          const area = (a.area || '').trim();
          const stateKey = a.state ? STATE_WORD_KEY[a.state] : null;
          return (
            <article
              key={a.identifier || a.id || i}
              className="bulletin-card"
              data-sev={sev}
            >
              <span className="sev-bar" aria-hidden="true" />
              <button
                type="button"
                className="bc-body"
                aria-label={`${head}. ${t(lang, 'navDetails')}`}
                onClick={() => open(a)}
              >
                <span className="bc-head">
                  <span className="sev-stamp">{sevWord(lang, sev)}</span>
                  {a.kind === 'demo' && <span className="prov DEMO">DEMO</span>}
                  {stateKey && <span className="chip mono">{t(lang, stateKey)}</span>}
                </span>
                <span className="bc-title">{head}</span>
                <span className="bc-meta">
                  {area && <>{area}</>}
                  {a.issued_at && <> · {minutesSince(a.issued_at, nowMs) != null ? t(lang, 'agoPattern').replace('{m}', minutesSince(a.issued_at, nowMs)) : ''}</>}
                </span>
              </button>
              <span className="bc-listen">
                <button
                  type="button"
                  className="h-notif-speak"
                  aria-label={t(lang, 'alertsListen')}
                  onClick={(e) => { e.stopPropagation(); speak(`${a.hazard || a.event || ''}. ${head}. ${a.instruction || ''}`); }}
                >
                  <Icon name="speaker" size={18} />
                </button>
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function Home() {
  const { locReady } = useApp();
  return (
    <div className="home-stack">
      {!locReady && <LocationPrompt />}
      <DispatchStrip />
      <HeroCard />
      <ActionTiles />
      <Bulletins />
    </div>
  );
}
