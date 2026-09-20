// AlertsList — the one and only alerts surface. List; tapping an alert
// expands its full detail INLINE (bottom of the row), never a separate
// route. This kills the Alerts-vs-Alert-details duplicate: one route, one
// component, expansion instead of navigation.
//
// The backend is authoritative: severity is rendered from the alert dict,
// never re-derived here. Rows carry relative timestamps ("2 min ago") so the
// board reads as live, not as a rumor mill.
import { useCallback, useEffect, useState } from 'react';
import { api, demoAlertApi } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import { SevStamp } from './ui';
import { relTime, mergeAlerts } from './inboxLogic';
import AlertDetails from './AlertDetails';

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
      const official = [...(w?.cap_alerts || [])];
      if (w?.warning && (w.verified?.verified || w.verdict?.basis === 'unverified_warning')) {
        official.unshift({ ...w.warning, headline: w.warning.message });
      }
      const demo = [...(d?.alerts || [])];
      setAlerts(mergeAlerts(official, demo));
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

  return (
    <div className="alerts-list" role="list">
      {alerts.map((a) => {
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
      })}
    </div>
  );
}
