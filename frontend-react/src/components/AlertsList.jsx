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
import { relTime, mergeAlerts, isPastAlert } from './inboxLogic';
import AlertDetails from './AlertDetails';
import DistrictMap from './DistrictMap';
import { districtsOfAlert } from './mapLogic';
import QrRelay from './QrRelay';
import QrScan from './QrScan';
import { readCache, saveCache } from '../offline';

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

// QR data sharing (Show QR / Scan QR) — the Alerts view is the reachable
// entry point (bottom section, tabbed). Fully offline: the sender renders
// from props with the bundled `qrcode` lib (no network), the scanner uses
// the camera + local reassembly (only the optional ack sync needs network).
// Previously the sender QR was buried inside the SOS sheet and the scanner
// had no entry at all.
function QrShareSection({ alerts }) {
  const { lang, loc, device, online } = useApp();
  const [qrTab, setQrTab] = useState('show');
  const [forwardEnv, setForwardEnv] = useState(null);
  return (
    <>
      <div className="alert-sec-title" style={{ marginTop: 16 }}>
        <span className="kicker">{t(lang, 'qrTitle')}</span>
      </div>
      <p className="sub">{t(lang, 'qrSub')}</p>
      <div className="segmented" role="tablist" aria-label={t(lang, 'qrTitle')} style={{ marginBottom: 12 }}>
        <button
          type="button"
          role="tab"
          aria-selected={qrTab === 'show'}
          className={`seg-opt${qrTab === 'show' ? ' is-active' : ''}`}
          onClick={() => setQrTab('show')}
        >
          {t(lang, 'qrShowTab')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={qrTab === 'scan'}
          className={`seg-opt${qrTab === 'scan' ? ' is-active' : ''}`}
          onClick={() => setQrTab('scan')}
        >
          {t(lang, 'qrScanTab')}
        </button>
      </div>
      {qrTab === 'show' ? (
        <QrRelay alerts={alerts} lang={lang} deviceLabel={device || ''} relayEnvelope={forwardEnv} />
      ) : (
        <QrScan
          api={api}
          lang={lang}
          district={loc.district}
          deviceId={device || ''}
          deviceLabel={device || ''}
          online={online}
          onRelayFurther={(env) => { setForwardEnv(env); setQrTab('show'); }}
        />
      )}
    </>
  );
}

function alertTime(a) {
  return a.updated_at || a.issued_at || a.sent || a.created_at || '';
}

export default function AlertsList({ initialAlertId = null }) {
  const { lang, loc, syncTick, speak, demoMode } = useApp();
  const [alerts, setAlerts] = useState(null);
  // Same-state-but-not-this-district alerts: context, never the verdict.
  // Dropped silently until now — a page showing "all clear" while ten
  // same-state warnings existed is exactly what "can't see any alerts" meant.
  const [nearbyAlerts, setNearbyAlerts] = useState([]);
  const [unavailable, setUnavailable] = useState(false);
  const [openId, setOpenId] = useState(initialAlertId);
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // `staleCache`: the server did not answer, so the list below is what this
  // phone saved earlier — labelled as saved, never as live.
  const [staleCache, setStaleCache] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const locKey = `${loc.district}|${loc.lat}|${loc.lon}`;

  useEffect(() => {
    let alive = true;
    // Reset on location/mode change so stale alerts never flash as current.
    setAlerts(null);
    setNearbyAlerts([]);
    setUnavailable(false);
    // Demo alerts live behind a DEMO_MODE-gated endpoint: in imd/hybrid the
    // backend 403s by design, so don't even ask — it only spams the console
    // and wastes a round trip.
    Promise.all([
      api.warnings(loc.district, loc.lat, loc.lon).catch(() => null),
      (demoMode ? demoAlertApi.list(loc.district).catch(() => null) : Promise.resolve(null)),
    ]).then(([w, d]) => {
      if (!alive) return;
      if (!w && !d) {
        // Both sources unreachable: fall back to what this phone saved
        // earlier so QR sharing keeps working fully offline. The saved list
        // is labelled as saved (staleCache), never as live — and an empty
        // cache stays an honest "cannot check", never a fake all-clear.
        let cached = null;
        try {
          const snap = (readCache().alerts_list || {}).data || null;
          if (snap && Array.isArray(snap.alerts) && snap.alerts.length) cached = snap.alerts;
        } catch { /* cache read is best-effort */ }
        if (cached) {
          setAlerts(cached);
          setStaleCache(true);
          return;
        }
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
      const merged = mergeAlerts(deduped, demo).filter(isOfficialSource);
      setAlerts(merged);
      // Nearby = official chain only (same gate as the main list): state
      // neighbours the user should know about, explicitly not their verdict.
      setNearbyAlerts([...(w?.nearby_alerts || [])].filter(isOfficialSource));
      setStaleCache(false);
      // Snapshot the list on this phone so the QR sender + offline view keep
      // working with zero connectivity. Best-effort: never blocks render.
      try {
        if (merged.length) saveCache('alerts_list', { alerts: merged, district: loc.district, at: new Date().toISOString() });
      } catch { /* storage unavailable — ignore */ }
    });
    return () => { alive = false; };
  }, [locKey, loc.district, loc.lat, loc.lon, syncTick, tick, demoMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setTick((n) => n + 1), []);

  if (alerts === null) {
    return <p className="mono" role="status">{t(lang, 'alertsLoading')}</p>;
  }

  if (unavailable) {
    // Server unreachable AND nothing saved: the map (grey, honest) and the
    // scanner below stay fully usable — receiving a QR is how this phone
    // gets its first alert.
    return (
      <>
        <DistrictMap alerts={[]} />
        <div className="offline-panel" role="status">
          <div className="display">{t(lang, 'alertsCannotTitle')}</div>
          <p className="sub">{t(lang, 'alertsCannotBody')}</p>
          <div className="row">
            <button type="button" className="btn sm" style={{ minHeight: 44 }} onClick={reload}>
              <Icon name="refresh" size={14} /> {t(lang, 'alertsRetry')}
            </button>
          </div>
        </div>
        <QrShareSection alerts={[]} />
      </>
    );
  }

  // No early return on empty: the main render below already shows the empty
  // message inside the active section, and the QR share/scan section must stay
  // visible even with zero alerts (the scanner is how this phone GETS one).

  // Ended alerts stay visible with their full lifecycle, but under their own
  // honest heading — an ENDED row under "Emergency alerts" reads as active.
  // That includes withdrawn (CANCELLED) demo alerts and official bulletins
  // whose validity window has closed: neither is in force, and the verdict
  // already ignores expired alerts.
  const isEndedAlert = (a) => isPastAlert(a, nowMs);
  const activeAlerts = alerts.filter((a) => !isEndedAlert(a));
  const endedAlerts = alerts.filter(isEndedAlert);
  // section prefixes the DOM id: renderRows runs once per section, so a
  // bare index would emit duplicate ids across the active/ended lists.
  const renderRows = (list, section) => list.map((a, i) => {
      const key = alertKey(a);
      const open = openId === key;
      const sev = a.severity || 'UNKNOWN';
      const head = (a.headline || a.title || a.message || a.hazard || a.event || '').trim();
      const district = a.district || a.areaDesc || a.area || loc.district;
      const tag = isDemoAlert(a) ? t(lang, 'listDemoTag') : t(lang, 'listOfficialTag');
      const state = String(a.lifecycle_state || a.state || '').toUpperCase();
      const rowId = `alert-row-${section}-${i}`;
      const toggle = () => {
        const next = open ? null : key;
        setOpenId(next);
        // Keep the expanded detail clear of the sticky header: the detail
        // used to open with its title hidden underneath the top nav.
        if (!open) {
          requestAnimationFrame(() => {
            document.getElementById(rowId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        }
      };
      return (
        <div key={key} id={rowId} className={`alerts-row${open ? ' is-open' : ''}`} role="listitem" data-sev={sev}>
          <button
            type="button"
            className="alerts-row-head"
            style={{ minHeight: 56 }}
            aria-expanded={!!open}
            aria-label={`${head || t(lang, 'listUnknownAlert')} — ${open ? t(lang, 'listCollapse') : t(lang, 'listExpand')}`}
            onClick={toggle}
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
                  gone by design. The row header toggles, and the Close
                  button below collapses it. */}
              <AlertDetails alert={a} />
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
  // Map tap → expand that district's first alert inline (reuses the
  // row-expansion machinery; no new navigation, no new state). The map also
  // shows official alerts for nearby districts, so look there second.
  const openDistrictFirst = (name) => {
    for (const [list, section] of [[activeAlerts, 'active'], [nearbyAlerts, 'nearby']]) {
      const hit = list.find((a) => districtsOfAlert(a, [name]).length > 0);
      if (!hit) continue;
      setOpenId(alertKey(hit));
      requestAnimationFrame(() => {
        document.getElementById(`alert-row-${section}-${list.indexOf(hit)}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
      return;
    }
  };

  return (
    <>
      {staleCache && (
        <p className="sub" role="status" style={{ marginBottom: 8 }}>
          <Icon name="offline" size={14} /> {t(lang, 'alertsCachedNote')}
        </p>
      )}
      <DistrictMap alerts={[...activeAlerts, ...nearbyAlerts]} onSelectDistrict={openDistrictFirst} />
      <div className="alert-sec-title">
        <span className="kicker">{t(lang, 'alertsEmergencyTitle')}</span>
      </div>
      <div className="alerts-list" role="list">
      {activeAlerts.length === 0 ? (
        <div role="status">
          <div className="display">{t(lang, 'alertsNoneTitle')}</div>
          <p className="sub">{t(lang, 'alertsNoneBody')}</p>
        </div>
      ) : renderRows(activeAlerts, 'active')}
      </div>
      {/* Past alerts: completed emergencies with their full lifecycle. Kept
          visible, but never under the active "Emergency alerts" heading. */}
      {endedAlerts.length > 0 && (
        <>
          <div className="alert-sec-title">
            <span className="kicker">{t(lang, 'alertsPastTitle')}</span>
          </div>
          <div className="alerts-list" role="list">
            {renderRows(endedAlerts, 'ended')}
          </div>
        </>
      )}
      {/* Nearby: official warnings in your state that are NOT for your
          district. Context for travel — never your verdict, never alarming
          as your own. */}
      {nearbyAlerts.length > 0 && (
        <>
          <div className="alert-sec-title">
            <span className="kicker">{t(lang, 'alertsNearby')}</span>
          </div>
          <p className="sub">{t(lang, 'alertsNearbySub')}</p>
          <div className="alerts-list" role="list">
            {renderRows(nearbyAlerts, 'nearby')}
          </div>
        </>
      )}
      <QrShareSection alerts={alerts} />
    </>
  );
}
