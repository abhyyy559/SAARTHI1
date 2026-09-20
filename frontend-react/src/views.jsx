// SIGNAL BOARD view set: Home (district dispatch), Ask (facts console),
// Advisory (dispatch cards), Alerts (mayday console), Notifications
// (lifecycle trail), Advisor (role cards), Admin (backstage console),
// Trust (source guarantees), Details (selected alert), Sources.
import Home from './components/Home';
import ChatPanel from './components/ChatPanel';
import AlertCenter from './components/AlertCenter';
import AlertDetails from './components/AlertDetails';
import Emergency from './components/Emergency';
import ProfileAdvice from './components/ProfileAdvice';
import ViewHead from './components/ViewHead';
import NotificationCenter from './components/NotificationCenter';
import Advisor from './components/Advisor';
import AdminPanel from './components/AdminPanel';
import AuthorityDashboard from './components/AuthorityDashboard';
import CoverageDashboard from './components/CoverageDashboard';
import SourceStatus from './components/SourceStatus';
import HowItWorks from './components/HowItWorks';
import { useApp } from './store';
import { t } from './i18n';
import { useState } from 'react';
import { Card } from './components/ui';
import SourceStrip from './components/SourceStrip';
import Icon from './components/icons';

// Team-only gate for the admin console. This is a DEMO gate, not
// authentication: it keeps the backstage controls out of the normal user's
// path (?view=admin is no longer in any nav). The real protection is
// server-side — demo/management endpoints are DEMO_MODE-gated in the API.
// PIN override: VITE_ADMIN_PIN. Session-scoped: closing the tab re-locks.
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || '26068';
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
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 12)); setWrong(false); }}
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

export function HomeView() {
  return (
    <>
      <ViewHead titleKey="navHome" subKey="viewHomeSub" />
      <Home />
    </>
  );
}

export function AskView() {
  const { lang, persona, loc } = useApp();
  return (
    <>
      <ViewHead titleKey="viewAsk" subKey="viewAskSub" />
      <ChatPanel key={`chat:${lang}:${persona}:${loc.district}`} />
    </>
  );
}

// Alerts: the mayday console leads (SOS is the one control that must work
// with shaking hands), then official bulletins, then the P2P panel — always
// stamped SIMULATED. Emergency carries its own translated heading.
export function AlertsView() {
  return (
    <>
      <ViewHead titleKey="viewAlerts" subKey="viewAlertsSub" />
      <Emergency />
      <AlertCenter />
    </>
  );
}

export function NotificationsView() {
  return (
    <>
      <ViewHead titleKey="ntfTitle" subKey="ntfSub" />
      <NotificationCenter />
    </>
  );
}

export function AdvisorView() {
  return (
    <>
      <ViewHead titleKey="advTitle" subKey="advSub" />
      <Advisor />
    </>
  );
}

// Advisory — the persona guidance (ProfileAdvice) lives here alone; the
// Home/chat surface never shows advice.
export function AdvisoryView() {
  return (
    <>
      <ViewHead titleKey="viewAdvisory" subKey="viewAdvisorySub" />
      <ProfileAdvice />
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

export function TrustView() {
  const { lang } = useApp();
  return (
    <>
      <ViewHead titleKey="viewTrust" subKey="viewTrustSub" />
      {/* Citizen first: the plain-English state of every line. The raw
          machine statuses stay one tap away behind a disclosure. */}
      <SourceStatus />
      <Card>
        <details className="src-why">
          <summary>{t(lang, 'trustTechWhy')}</summary>
          <SourceStrip refreshKey={0} />
        </details>
      </Card>
      <HowItWorks />
    </>
  );
}

// Alert details as a view: shows the citizen-selected alert (tapped from a
// bulletin or alert card). If nothing was ever selected the board says so
// honestly instead of inventing a "latest" alert.
export function DetailsView() {
  const { lang, setView, selectedAlert } = useApp();
  if (!selectedAlert) {
    return (
      <>
        <ViewHead titleKey="navDetails" subKey="viewDetailsSub" />
        <div className="empty-state" data-state="details-none">
          <div className="display">{t(lang, 'detailsNoneTitle')}</div>
          <p className="sub">{t(lang, 'detailsNoneBody')}</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button type="button" className="btn" onClick={() => setView('alerts')}>
              <Icon name="alert" size={18} />
              {t(lang, 'navAlerts')}
            </button>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <ViewHead titleKey="navDetails" subKey="viewDetailsSub" />
      <AlertDetails alert={selectedAlert} onBack={() => setView('alerts')} />
    </>
  );
}

// Source status as a view, reachable via ?view=sources.
export function SourcesView() {
  return (
    <>
      <ViewHead titleKey="navSources" subKey="viewSourcesSub" />
      <SourceStatus />
    </>
  );
}
