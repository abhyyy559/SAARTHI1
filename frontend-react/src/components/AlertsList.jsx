// AlertsList — the one and only alerts surface. List; tapping an alert
// expands its full detail INLINE (bottom of the row), never a separate
// route. This kills the Alerts-vs-Alert-details duplicate: one route, one
// component, expansion instead of navigation.
//
// SOURCE HONESTY (Phase 1 Crew D): this page shows ONLY official sources —
// the admin dashboard (demo alerts, always labelled DEMO), SACHET, NDMA, IMD.
// Third-party providers (WeatherAPI.com, GDACS) feed the verdict engine but
// never render here as warnings; community reports are a separate surface
// entirely. `official === false` is an explicit backend opt-out and always
// wins over name matching.
import { useCallback, useEffect, useState } from 'react';
import { api, demoAlertApi } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import { SevStamp } from './ui';
import { relTime, mergeAlerts } from './inboxLogic';
import AlertDetails from './AlertDetails';

// An alert is a demo/admin-dashboard alert: simulated content that must wear
// the DEMO badge — never presented as a live official warning.
export function isDemoAlert(a) {
  if (!a) return false;
  const src = String(a.source || '').toUpperCase();
  return src.includes('DEMO') || a._origin === 'demo' || a.demo === true;
}

// The Alerts page admits only official sources. The admin dashboard's demo
// alerts are admitted too, but isDemoAlert marks them DEMO on the row.
export function isOfficialSource(a) {
  if (!a) return false;
  if (a.official === false) return false; // explicit backend opt-out (third-party)
  if (isDemoAlert(a)) return true;
  if (a.official === true) return true;
  const src = String(a.source || '').toUpperCase();
  return src.includes('SACHET') || src.includes('NDMA') || src.includes('IMD');
}

function alertKey(a) {
  return String(a.id || a.identifier || a.headline || Math.random());
}

function alertTime(a) {
  return a.updated_at || a.issued_at || a.sent || a.created_at || '';
}

export default function AlertsList({ initialAlertId = null }) {
  const { lang, loc, syncTick, speak } = useApp();
  const [alerts, setAlerts] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [openId, setOpenId] = useState(initialAlertId);
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const locKey = `${loc.district}|${loc.lat}|${loc.lon}`;

  useEffect(() => {
    let alive = true;
    // Reset on location/mode change so stale alerts never flash as current.
    setAlerts(null);
    setUnavailable(false);
    Promise.all([
      api.warnings(loc.district, loc.lat, loc.lon).catch(() => null),
      demoAlertApi.list(loc.district).catch(() => null),
    ]).then(([w, d]) => {
      if (!alive) return;
      if (!w && !d) {
        // Both sources unreachable: say so honestly, never a fake all-clear.
        setUnavailable(true);
        setAlerts([]);
        return;
      }
      const official = [];
      // In demo mode the whole warnings payload is simulated content: every
      // fixture alert wears the DEMO badge, so the jury sees the simulation
      // for what it is instead of an official-looking warning.
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
      // The backend can return the same warning twice: once as the headline
      // `warning` (verdict input) and once inside cap_alerts. Never render the
      // same alert as two rows — an identical twin reads as two emergencies.
      // Canonical identity: a real id wins; otherwise the headline,
      // normalized — the twins can differ by a trailing period or case
      // ("…places." vs "…places"), which must not defeat the dedup.
      const canonKey = (a) => {
        const raw = a.id || a.identifier;
        if (raw) return `id:${raw}`;
        return `h:${String(a.headline || '').trim().toLowerCase().replace(/[.\s]+$/, '')}`;
      };
      const seenIds = new Set();
      const deduped = official.filter((a) => {
        const key = canonKey(a);
        if (seenIds.has(key)) return false;
        seenIds.add(key);
        return true;
      });
      const demo = [...(d?.alerts || [])];
      // Emergency alerts only, and only official sources: demo-store alerts
      // are admin-dashboard alerts (admitted, DEMO-badged); third-party chain
      // alerts (WeatherAPI.com, GDACS — official=false) never render here.
      setAlerts(mergeAlerts(deduped, demo).filter(isOfficialSource));
    });
    return () => { alive = false; };
  }, [locKey, loc.district, loc.lat, loc.lon, syncTick, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setTick((n) => n + 1), []);

  if (alerts === null) {
    return <p className="mono" role="status">{t(lang, 'alertsLoading')}</p>;
  }

  if (unavailable) {
    return (
      <div className="offline-panel" role="status">
        <div className="display">{t(lang, 'alertsCannotTitle')}</div>
        <p className="sub">{t(lang, 'alertsCannotBody')}</p>
        <div className="row">
          <button type="button" className="btn sm" style={{ minHeight: 44 }} onClick={reload}>
            <Icon name="refresh" size={14} /> {t(lang, 'alertsRetry')}
          </button>
        </div>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div role="status">
        <div className="display">{t(lang, 'alertsNoneTitle')}</div>
        <p className="sub">{t(lang, 'alertsNoneBody')}</p>
      </div>
    );
  }

  // Ended alerts stay visible with their full lifecycle, but under their own
  // honest heading — an ENDED row under "Emergency alerts" reads as active.
  const isEndedAlert = (a) => String(a.lifecycle_state || a.state || '').toUpperCase() === 'ENDED';
  const activeAlerts = alerts.filter((a) => !isEndedAlert(a));
  const endedAlerts = alerts.filter(isEndedAlert);
  const renderRows = (list) => list.map((a) => {
      const key = alertKey(a);
      const open = openId === key;
      const sev = a.severity || 'UNKNOWN';
      const head = (a.headline || a.title || a.message || a.hazard || a.event || '').trim();
      const district = a.district || a.areaDesc || a.area || loc.district;
      const tag = isDemoAlert(a) ? t(lang, 'listDemoTag') : t(lang, 'listOfficialTag');
      const state = String(a.lifecycle_state || a.state || '').toUpperCase();
      return (
        <div key={key} className={`alerts-row${open ? ' is-open' : ''}`} role="listitem" data-sev={sev}>
          <button
            type="button"
            className="alerts-row-head"
            style={{ minHeight: 56 }}
            aria-expanded={!!open}
            aria-label={`${head || t(lang, 'listUnknownAlert')} — ${open ? t(lang, 'listCollapse') : t(lang, 'listExpand')}`}
            onClick={() => setOpenId(open ? null : key)}
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
                {state && <span>{state}</span>}
                {' · '}{relTime(alertTime(a), nowMs)}
              </span>
            </span>
            <span style={{ display: 'inline-flex', transform: open ? 'rotate(-90deg)' : undefined }} aria-hidden="true">
              <Icon name="chevron" size={18} />
            </span>
          </button>
          {open && (
            <div className="alerts-row-detail">
              {/* The detail renders inline — the separate Details route is
                  gone by design. onBack collapses the row instead of
                  navigating away. */}
              <AlertDetails
                alert={a}
                onBack={() => setOpenId(null)}
              />
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  type="button" className="btn btn-ghost sm" style={{ minHeight: 44 }}
                  onClick={() => speak(`${head}. ${a.instruction || ''}`)}
                >
                  <Icon name="speaker" size={14} /> {t(lang, 'alertsListen')}
                </button>
                <button
                  type="button" className="btn btn-ghost sm" style={{ minHeight: 44 }}
                  onClick={() => setOpenId(null)}
                >
                  {t(lang, 'listCollapse')}
                </button>
              </div>
            </div>
          )}
        </div>
      );
  });
  return (
    <>
      <div className="alert-sec-title">
        <span className="kicker">{t(lang, 'alertsEmergencyTitle')}</span>
      </div>
      <div className="alerts-list" role="list">
      {activeAlerts.length === 0 ? (
        <div role="status">
          <div className="display">{t(lang, 'alertsNoneTitle')}</div>
          <p className="sub">{t(lang, 'alertsNoneBody')}</p>
        </div>
      ) : renderRows(activeAlerts)}
      </div>
      {/* Past alerts: completed emergencies with their full lifecycle. Kept
          visible, but never under the active "Emergency alerts" heading. */}
      {endedAlerts.length > 0 && (
        <>
          <div className="alert-sec-title">
            <span className="kicker">{t(lang, 'alertsPastTitle')}</span>
          </div>
          <div className="alerts-list" role="list">
            {renderRows(endedAlerts)}
          </div>
        </>
      )}
    </>
  );
}
