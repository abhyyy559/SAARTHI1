// AlertsList — the one and only alerts surface. List; tapping an alert
// expands its full detail INLINE (bottom of the row), never a separate
// route. This kills the Alerts-vs-Alert-details duplicate: one route, one
// component, expansion instead of navigation.
//
// The backend is authoritative: severity is rendered from the alert dict,
// never re-derived here. Rows carry relative timestamps ("2 min ago") so the
// board reads as live, not as a rumor mill.
//
// The main list is EMERGENCY alerts only. Community observations are fetched
// too, but they render in a separate, clearly badged section BELOW the
// emergency list (COMMUNITY provenance, never presented as official warnings)
// — they must never sit in the main list, and never become warnings.
import { useCallback, useEffect, useState } from 'react';
import { api, demoAlertApi } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import { SevStamp } from './ui';
import { relTime, mergeAlerts } from './inboxLogic';
import AlertDetails from './AlertDetails';

// Defensive: an item is community-provenance (not an emergency alert) and
// must be kept out of the main list no matter which feed it arrived on.
function isCommunityItem(a) {
  const prov = String(a.provenance || a.source || '').toUpperCase();
  return prov === 'COMMUNITY' || a._origin === 'community';
}

function alertKey(a) {
  return String(a.id || a.identifier || a.headline || Math.random());
}

function alertTime(a) {
  return a.updated_at || a.issued_at || a.sent || a.created_at || '';
}

// Community report types -> translated word. Same keys AlertCenter uses, so
// the two surfaces can never disagree on what a report type is called.
const REPORT_WORD = {
  flooding: 'rtFlooding',
  road_blocked: 'rtRoadBlocked',
  fallen_tree: 'rtFallenTree',
  damage: 'rtDamage',
  waterlogging: 'rtWaterlogging',
};

export default function AlertsList({ initialAlertId = null }) {
  const { lang, loc, syncTick, speak } = useApp();
  const [alerts, setAlerts] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [openId, setOpenId] = useState(initialAlertId);
  // Community observations: fetched alongside, rendered in their own honestly
  // badged section below the emergency list — never in it.
  const [reports, setReports] = useState([]);
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
      const official = [...(w?.cap_alerts || [])];
      if (w?.warning && (w.verified?.verified || w.verdict?.basis === 'unverified_warning')) {
        official.unshift({ ...w.warning, headline: w.warning.message });
      }
      // The backend can return the same warning twice: once as the headline
      // `warning` (verdict input) and once inside cap_alerts. Never render the
      // same alert as two rows — an identical twin reads as two emergencies.
      const seenIds = new Set();
      const deduped = official.filter((a) => {
        const key = a.id || a.identifier || a.headline;
        if (seenIds.has(key)) return false;
        seenIds.add(key);
        return true;
      });
      const demo = [...(d?.alerts || [])];
      // Emergency alerts only in the main list. Community items are shown in
      // their own section below, so a stray community-provenance item is
      // filtered here, not promoted to an emergency alert.
      setAlerts(mergeAlerts(deduped, demo).filter((a) => !isCommunityItem(a)));
    });
    // Community observations render separately; their failure must never
    // change the emergency list (or its empty states).
    api.reports(loc.district)
      .then((r) => { if (alive) setReports(r.reports || []); })
      .catch(() => { /* offline - keep the reports we already have */ });
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
      const tag = a._origin === 'demo' ? t(lang, 'listDemoTag') : t(lang, 'listOfficialTag');
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
      {/* Community observations live here, never in the emergency list above.
          COMMUNITY provenance is badged on the section and on every row, in
          machine-readable form, so a community report can never be mistaken
          for an official warning. */}
      <section className="community-sec" aria-label={t(lang, 'commSecTitle')}>
        <div className="alert-sec-title">
          <span className="kicker">{t(lang, 'commSecTitle')}</span>
          <span className="prov COMMUNITY">COMMUNITY</span>
        </div>
        <p className="sub">{t(lang, 'commSecSub')}</p>
        {reports.length === 0 ? (
          <p className="sub">{t(lang, 'commEmpty')}</p>
        ) : (
          reports.map((r) => (
            <div className="evrow" key={r.report_id || r.id || r.text}>
              <span className="k">
                {r.report_type ? t(lang, REPORT_WORD[r.report_type] || 'commReportType') : t(lang, 'commReportType')}
                {' · '}{r.district}
              </span>
              <span>{r.text} <span className="prov COMMUNITY">COMMUNITY</span></span>
            </div>
          ))
        )}
      </section>
    </>
  );
}
