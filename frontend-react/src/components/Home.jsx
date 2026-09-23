// Home — one screen, one job: ask about it first.
//
// Top to bottom:
//   0. About-you strip — the compact echo of the role picker (the same
//      USER_TYPES the Advisor grid and Settings use): who the app is
//      answering as, one tap to change it in Settings. It never duplicates
//      the full onboarding or the picker itself.
//   1. Ask, the hero (Agent 3's HomeChat) — the flagship, the first thing the
//      eye hits and the largest element on the screen.
//   2. WeatherCard — current conditions, raw values plus provenance.
//   3. HomeAlerts — ACTIVE alerts only, top 3, each tappable straight into
//      the Alerts view. Abhiram's call (2026-09-23): alerts belong on home —
//      this overrides the old IA-dedup "no per-page alert block" decision.
//      Ended alerts never appear here.
//   4. HomeHero — the safety-critical current-conditions verdict readout,
//      compact and subordinate to Ask.
//
// Alert detail always lives in the Alerts view (AlertsList expands inline);
// Home never repeats full detail — it links, once per row.
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';
import { api, demoAlertApi } from '../api';
import HomeHero from './HomeHero';
import HomeChat from './HomeChat';
import AviationBriefing from './AviationBriefing';
import WeatherCard from './WeatherCard';
import { USER_TYPES } from './Advisor';
import { isDemoAlert, isOfficialSource } from './AlertsList';
import { mergeAlerts, relTime } from './inboxLogic';
import { SevStamp } from './ui';
import Icon from './icons';

// The compact "conversation about you": the same USER_TYPES list the role
// picker uses, reduced to the current role as a chip plus a change
// affordance. Settings (the RoleCard grid) is the one editor — this strip
// never picks, it only reflects and links.
function AboutYou() {
  const { lang, persona, setView } = useApp();
  const ut = USER_TYPES.find((u) => u.id === persona);
  const goSettings = () => setView('settings');
  // Harbour Signal, inline: paper chip, 2px ink border, sentence case. (New
  // blocks carry their own styles — styles.css is owned by another stream.)
  return (
    <section aria-label={t(lang, 'h3RoleTitle')} className="home-aboutyou" style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      background: 'var(--paper)', border: '2px solid var(--ink)',
      borderRadius: 'var(--radius)', padding: '8px 12px',
    }}>
      {ut ? (
        <>
          <span className="ay-label" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)' }}>
            {t(lang, 'askAs')}
          </span>
          <span className="ay-chip" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#fff', border: '2px solid var(--ink)', borderRadius: 999,
            padding: '2px 12px', fontSize: 14, fontWeight: 700,
          }}>
            <Icon name={ut.icon} size={15} aria-hidden="true" />
            <b>{t(lang, ut.key)}</b>
          </span>
          <button type="button" className="btn btn-ghost sm ay-change" style={{ marginLeft: 'auto' }} onClick={goSettings}>
            {t(lang, 'h3RoleChange')}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-signal sm ay-set" onClick={goSettings}>
          <Icon name="user" size={15} aria-hidden="true" />
          {t(lang, 'h3RoleSet')}
        </button>
      )}
    </section>
  );
}

// HomeAlerts — the compact active-alerts section. Same two sources as
// AlertsList (official CAP warnings + demo-store alerts), the same dedup and
// official-source admission, then ACTIVE ONLY, top 3. Each row is a link into
// the Alerts view via the store's selectedAlert — detail lives there.
const endedState = (a) => String(a.lifecycle_state || a.state || '').toUpperCase() === 'ENDED';

function HomeAlerts() {
  const { lang, loc, locReady, syncTick, setView, setSelectedAlert } = useApp();
  const [alerts, setAlerts] = useState(null); // null = loading
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  const locKey = `${loc.district}|${loc.lat}|${loc.lon}`;

  useEffect(() => {
    if (!locReady) return undefined;
    let alive = true;
    setAlerts(null);
    setFailed(false);
    Promise.all([
      api.warnings(loc.district, loc.lat, loc.lon).catch(() => null),
      demoAlertApi.list(loc.district).catch(() => null),
    ]).then(([w, d]) => {
      if (!alive) return;
      if (!w && !d) {
        // Both sources unreachable: say so honestly, never a fake all-clear.
        setFailed(true);
        setAlerts([]);
        return;
      }
      const official = [];
      // Same demo-badging rule as AlertsList: in demo mode every fixture
      // alert wears the DEMO badge instead of reading as official.
      const responseIsDemo = String(w?.provenance || '').toUpperCase() === 'DEMO';
      for (const a of (w?.cap_alerts || [])) {
        official.push(responseIsDemo ? { ...a, demo: true } : a);
      }
      if (w?.warning && (w.verified?.verified || w.verdict?.basis === 'unverified_warning')) {
        official.unshift({
          ...w.warning,
          headline: w.warning.message,
          source: responseIsDemo ? 'DEMO' : (w.warning.source || 'IMD'),
        });
      }
      // Canonical identity so the same warning never renders twice.
      const seenIds = new Set();
      const deduped = official.filter((a) => {
        const raw = a.id || a.identifier;
        const key = raw ? `id:${raw}` : `h:${String(a.headline || '').trim().toLowerCase().replace(/[.\s]+$/, '')}`;
        if (seenIds.has(key)) return false;
        seenIds.add(key);
        return true;
      });
      const active = mergeAlerts(deduped, [...(d?.alerts || [])])
        .filter(isOfficialSource)
        .filter((a) => !endedState(a))
        .slice(0, 3);
      setAlerts(active);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locReady, locKey, syncTick, tick]);

  const openAlert = (a) => {
    setSelectedAlert(a);
    setView('alerts');
  };

  return (
    <section aria-label={t(lang, 'h3AlertsTitle')} className="home-alerts">
      <div className="alert-sec-title" style={{ marginTop: 0 }}>
        <span className="kicker">{t(lang, 'h3AlertsTitle')}</span>
        <button
          type="button"
          className="btn btn-ghost sm"
          onClick={() => setView('alerts')}
        >
          {t(lang, 'h3AlertsOpen')}
        </button>
      </div>
      {!locReady || alerts === null ? (
        <p className="mono" role="status">{t(lang, 'checking')}</p>
      ) : failed ? (
        <div role="status">
          <p className="sub" style={{ margin: '0 0 8px' }}>{t(lang, 'alertsCannotBody')}</p>
          <button type="button" className="btn btn-ghost sm" onClick={() => setTick((x) => x + 1)}>
            <Icon name="refresh" size={14} /> {t(lang, 'h3AlertsRetry')}
          </button>
        </div>
      ) : alerts.length === 0 ? (
        <p className="sub" role="status" style={{ margin: 0 }}>{t(lang, 'h3AlertsNone')}</p>
      ) : (
        <div className="alerts-list" role="list">
          {alerts.map((a, i) => {
            const sev = a.severity || 'UNKNOWN';
            const head = (a.headline || a.title || a.message || a.hazard || a.event || '').trim();
            const district = a.district || a.areaDesc || a.area || loc.district;
            const tag = isDemoAlert(a) ? t(lang, 'listDemoTag') : t(lang, 'listOfficialTag');
            const at = a.updated_at || a.issued_at || a.sent || a.created_at;
            return (
              <div key={String(a.id || a.identifier || head || i)} className="alerts-row" role="listitem" data-sev={sev}>
                <button
                  type="button"
                  className="alerts-row-head"
                  style={{ minHeight: 56 }}
                  onClick={() => openAlert(a)}
                  aria-label={`${head || t(lang, 'listUnknownAlert')} — ${t(lang, 'h3AlertsOpen')}`}
                >
                  <span className="sev-bar" aria-hidden="true" />
                  <span className="alerts-row-main">
                    <span className="alerts-row-title">
                      <SevStamp lang={lang} level={sev} />
                      <span>{head || t(lang, 'listUnknownAlert')}</span>
                    </span>
                    <span className="alerts-row-meta mono">
                      <span className="chip">{tag}</span>
                      {district && <span>{district}</span>}
                      {at && <span>{relTime(at)}</span>}
                    </span>
                  </span>
                  <span style={{ display: 'inline-flex' }} aria-hidden="true">
                    <Icon name="chevron" size={18} />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const { lang, persona, loc, speak, stopSpeaking, speechState, netState, setView, setListenState } = useApp();
  return (
    <div className="home-stack">
      {/* About-you first: a one-line reminder of who the app answers as. */}
      <AboutYou />
      <section aria-label={t(lang, 'heroAskAnything')} className="home-chat">
        {/* Ask is the hero of Home: it mounts FIRST, above the verdict card.
            Identity resets with lang/role/district so a new context never
            inherits the old one's answers. The location prompt renders once,
            inside HomeHero next to the place row — never duplicated here. */}
        <HomeChat
          key={`chat:${lang}:${persona}:${loc.district}`}
          lang={lang}
          persona={persona}
          loc={loc}
          speak={speak}
          stopSpeaking={stopSpeaking}
          speechState={speechState}
          netState={netState}
          onOpenAdvisory={() => setView('advisory')}
          onVoiceState={setListenState}
        />
      </section>
      {/* Current conditions: raw values, provenance chip, no verdict. */}
      <WeatherCard />
      {/* Active alerts (top 3) — rows tap through to the Alerts view. */}
      <HomeAlerts />
      {/* The verdict readout stays — safety-critical — but compact and
          subordinate, below Ask. */}
      <HomeHero />
      {/* Aviation is a profile, not a menu: the briefing lives on the
          dashboard itself when the aviation profile is active. */}
      {persona === 'aviation' && (
        <section aria-label={t(lang, 'utAviation')} className="home-aviation">
          <AviationBriefing />
        </section>
      )}
    </div>
  );
}
