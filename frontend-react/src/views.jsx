// SIGNAL BOARD view set — IA dedup (2026-09-20), notifications panel (2026-09-21).
// Public IA: Home (hero + chat) · Alerts (inline detail) · Advisory (merged)
// · topbar bell → notifications side panel (the one and only notifications
// home) · More sheet → Offline & P2P · Aviation · Trust & sources ·
// Settings · Tour replay. Admin is hidden, PIN-gated, direct URL only.
import Home from './components/Home';
import Emergency from './components/Emergency';
import AlertsList from './components/AlertsList';
import Advisor from './components/Advisor';
import AdviceCards from './components/AdviceCards';
import ViewHead from './components/ViewHead';
import AdminPanel from './components/AdminPanel';
import AuthorityDashboard from './components/AuthorityDashboard';
import CoverageDashboard from './components/CoverageDashboard';
import SourceStatus from './components/SourceStatus';
import SourceStrip from './components/SourceStrip';
import CityOpsPanel from './components/CityOpsPanel';
import HowItWorks from './components/HowItWorks';
import SettingsPanel from './components/SettingsPanel';
import { useApp } from './store';
import { t } from './i18n';
import { useEffect, useState } from 'react';
import { Card } from './components/ui';
import Icon from './components/icons';

// Team-only gate for the admin console. This is a DEMO gate, not
// authentication: it keeps the backstage controls out of the normal user's
// path (?view=admin is in no nav). The real protection is server-side —
// demo/management endpoints are DEMO_MODE-gated in the API.
// PIN override: VITE_ADMIN_PIN. Session-scoped: closing the tab re-locks.
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || 'SAARTHI';
const ADMIN_OK_KEY = 'wgpt-admin-ok';

function AdminGate({ children }) {
  const { lang } = useApp();
  const [ok, setOk] = useState(() => {
    try { return sessionStorage.getItem(ADMIN_OK_KEY) === '1'; } catch { return false; }
  });
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  if (ok) return children;
  const submit = (e) => {
    e.preventDefault();
    if (pin === ADMIN_PIN) {
      try { sessionStorage.setItem(ADMIN_OK_KEY, '1'); } catch { /* private mode: unlock lasts this view only */ }
      setOk(true);
    } else {
      setWrong(true);
      setPin('');
    }
  };
  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>{t(lang, 'adminGateTitle')}</h2>
      <p>{t(lang, 'adminGateBody')}</p>
      <form onSubmit={submit}>
        <label htmlFor="admin-pin" style={{ display: 'block', marginBottom: 8 }}>
          {t(lang, 'adminGatePinLabel')}
        </label>
        <input
          id="admin-pin"
          type="password"
          autoComplete="off"
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)); setWrong(false); }}
          style={{ fontSize: 18, padding: '10px 12px', minHeight: 44 }}
          aria-invalid={wrong}
          aria-describedby={wrong ? 'admin-pin-err' : undefined}
        />
        {wrong && (
          <p id="admin-pin-err" role="alert" style={{ color: 'var(--sev-red)' }}>
            {t(lang, 'adminGateWrong')}
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          <button type="submit" className="btn" disabled={!pin}>
            {t(lang, 'adminGateUnlock')}
          </button>
        </div>
      </form>
    </Card>
  );
}

// Home: the wow hero on top, the conversation below it, then today's warnings
// as teasers into the Alerts route. The old standalone Ask route is gone.
// NOTE: no ViewHead here by design — Ask's hero carries the single Home h1
// (Worker 3 contract), and the tab bar already labels this view "Home". A
// ViewHead would create a second h1 and push Ask below the fold of meaning.
export function HomeView() {
  return <Home />;
}

// Alerts: one route. SOS first (shaking hands), then the bulletin list with
// inline detail — no separate Details route.
// NOTE (Agent 1): AlertsList IS the alerts surface (list + inline expansion).
// A warning tapped on Home arrives via the store's selectedAlert.
export function AlertsView() {
  const { lang, selectedAlert } = useApp();
  const initialId = selectedAlert ? String(selectedAlert.id || selectedAlert.identifier || '') : null;
  return (
    <>
      <ViewHead titleKey="viewAlerts" subKey="viewAlertsSub" />
      <Emergency />
      <AlertsList key={initialId || 'all'} initialAlertId={initialId} />
      <p className="sub mono" style={{ marginTop: 8 }}>
        <Icon name="info" size={14} /> {t(lang, 'alertsInlineHint')}
      </p>
    </>
  );
}

export function NotificationsView() {
  // Notifications no longer has a full route: the side panel opened from the
  // topbar bell is the one and only notifications home. This export stays so
  // a stale ?view=notifications deep link opens the panel instead of landing
  // on a dead page; Shell listens for the event.
  const { setView } = useApp();
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('wgpt:notifications-open'));
    setView('home');
  }, [setView]);
  return null;
}

// Advisory: ONE route. The persona grid on top (pick your world by picture),
// the dynamic situation cards below it. The old separate Advisor route and
// its duplicate ProfileAdvice body are folded in — one advice home.
export function AdvisoryView() {
  return (
    <>
      <ViewHead titleKey="viewAdvisory" subKey="viewAdvisorySub" />
      <Advisor />
      <AdviceCards />
    </>
  );
}

// Offline & P2P: no separate page or nav section (Phase 1). The QR relay
// (QrRelay/QrScan over src/p2pqr.js) remains a background capability only.

// Aviation is a PROFILE, not a route: the briefing renders on Home for the
// aviation persona (see Home.jsx). There is no public aviation view.

// Trust & sources: ONE route. Every fact already carries its provenance chip;
// the machine statuses stay one tap away. City ops lives here (source
// guarantees, not a separate city route).
export function TrustSourcesView() {
  const { lang } = useApp();
  return (
    <>
      <ViewHead titleKey="navTrustSources" subKey="viewTrustSourcesSub" />
      <SourceStatus />
      <Card>
        <details className="src-why">
          <summary>{t(lang, 'trustTechWhy')}</summary>
          <SourceStrip refreshKey={0} />
        </details>
      </Card>
      <CityOpsPanel />
      <HowItWorks />
    </>
  );
}

export function SettingsView() {
  return (
    <>
      <ViewHead titleKey="navSettings" subKey="viewSettingsSub" />
      <SettingsPanel />
    </>
  );
}

export function AdminView() {
  return (
    <AdminGate>
      <ViewHead titleKey="demoTitle" subKey="demoSub" />
      <AdminPanel />
      <AuthorityDashboard />
      <CoverageDashboard />
    </AdminGate>
  );
}
