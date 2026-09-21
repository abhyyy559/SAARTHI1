// AlertOverlay — the ONE alert mention across the whole app.
//
// Constraint from the user: an alert must not be repeated on every page.
// Instead this single slim overlay sits on top of all pages and appears only
// while at least one alert is active. It never pushes content around
// (position:fixed), never blocks taps (only the pill itself takes pointer
// events), and it is dismissible — dismissal lasts until the alert set
// changes, so a genuinely new alert always re-announces itself.
//
// Tapping the pill opens the Alerts view, the one and only full alert home.
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { api } from '../api';
import { useApp } from '../store';
import { isExpired } from '../format';
import Icon from './icons';

// Highest severity first — the pill names the most urgent alert.
const SEV_RANK = {
  CRITICAL: 0, RED: 0,
  HIGH: 1, ORANGE: 1,
  MODERATE: 2, YELLOW: 2,
  LOW: 3, GREEN: 3,
};
const rankOf = (a) => SEV_RANK[String(a.severity || '').toUpperCase()] ?? 4;

function useActiveAlerts() {
  const { loc, syncTick } = useApp();
  const [items, setItems] = useState([]);
  const locKey = `${loc.district}|${loc.lat}|${loc.lon}`;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let alive = true;
    api.warnings(loc.district, loc.lat, loc.lon)
      .then((d) => {
        if (!alive) return;
        const out = [];
        if (d && d.warning && !isExpired(d.warning.valid_until, nowMs)) {
          out.push({ ...d.warning, headline: d.warning.message || d.warning.hazard });
        }
        for (const a of (d && d.cap_alerts) || []) {
          if (!isExpired(a.valid_until || a.expires, nowMs)) out.push(a);
        }
        out.sort((x, y) => rankOf(x) - rankOf(y));
        setItems(out);
      })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [locKey, loc.district, loc.lat, loc.lon, syncTick, nowMs]);
  return items;
}

export default function AlertOverlay() {
  const { lang, setView } = useApp();
  const items = useActiveAlerts();
  const [dismissedKey, setDismissedKey] = useState(null);

  if (items.length === 0) return null;
  // One identity per alert set: dismissing hides the pill only until the
  // set itself changes (new alert, alert ended), never forever.
  const setKey = items.map((a) => a.identifier || a.id || '').sort().join('|');
  if (dismissedKey === setKey) return null;

  const top = items[0];
  const sev = String(top.severity || 'UNKNOWN').toUpperCase();
  const head = (top.headline || top.title || top.message || top.hazard || top.event || '').trim();
  const countLabel = items.length === 1
    ? t(lang, 'ovlActiveOne')
    : t(lang, 'ovlActiveMany').replace('{n}', String(items.length));

  return (
    <div className="alert-overlay" data-sev={sev} role="status" aria-live="polite">
      <button
        type="button"
        className="alert-overlay-pill"
        onClick={() => setView('alerts')}
        aria-label={t(lang, 'ovlOpenAlerts')}
      >
        <span className="alert-overlay-icon" aria-hidden="true">
          <Icon name="alert" size={18} />
        </span>
        <span className="alert-overlay-text">
          <b>{countLabel}</b>
          {head && <span className="alert-overlay-head">{head}</span>}
        </span>
        <Icon name="chevron" size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="alert-overlay-x"
        onClick={() => setDismissedKey(setKey)}
        aria-label={t(lang, 'ovlDismiss')}
      >
        <Icon name="close" size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
