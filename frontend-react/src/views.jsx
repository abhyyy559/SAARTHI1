// Round2 view set: Home (safety + speak/tap to ask), Ask (conversation +
// voice), Alerts (official warnings + resilient SOS network), Notifications
// (lifecycle trail), Advisor (persona advice), Admin (demo panel), Coverage
// (authority dashboard). The jury can trigger every step of the alert story
// live from these screens.
import { useEffect, useState } from 'react';
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
import './components/Round2.css';
import './components/Home2.css';
import { useApp } from './store';
import { t } from './i18n';
import { Card } from './components/ui';
import SourceStrip from './components/SourceStrip';

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

export function AlertsView() {
  return (
    <>
      <ViewHead titleKey="viewAlerts" subKey="viewAlertsSub" />
      <AlertCenter />
      <Emergency />
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

// Advisory - the persona guidance (ProfileAdvice) lives here alone; the
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
    <>
      <ViewHead titleKey="demoTitle" subKey="demoSub" />
      <AdminPanel />
      <AuthorityDashboard />
      <CoverageDashboard />
    </>
  );
}

export function TrustView() {
  const { lang } = useApp();
  return (
    <>
      <ViewHead titleKey="viewTrust" subKey="viewTrustSub" />
      <Card
        title={t(lang, 'tag')}
        sub={t(lang, 'srcStatusSub')}
      >
        <SourceStrip refreshKey={0} />
        {/* SourceStatus used to be rendered twice on this view (once here and
            once below the card), so the whole table appeared twice. */}
        <SourceStatus />
      </Card>
      {/* What GIS actually does here, and what WIS 2.0 actually is. This
          component existed but was never mounted, so the honest explanation of
          both was unreachable. */}
      <HowItWorks />
    </>
  );
}

// Alert details as a view: shows the latest demo alert (or nothing selected).
// Reached via ?view=details — e.g. from a future AlertCenter/AdminPanel
// selection — without touching the citizen nav.
export function DetailsView() {
  const { setView } = useApp();
  const [alert, setAlert] = useState(undefined);
  useEffect(() => {
    let dead = false;
    import('./api').then(({ api }) =>
      api.demoAlerts().then(
        (d) => { if (!dead) setAlert((d.alerts || []).slice(-1)[0] || null); },
        () => { if (!dead) setAlert(null); },
      ));
    return () => { dead = true; };
  }, []);
  if (alert === undefined) return null;
  return (
    <>
      <ViewHead titleKey="viewAlerts" subKey="viewAlertsSub" />
      <AlertDetails alert={alert} onBack={() => setView('alerts')} />
    </>
  );
}

// Source status as a view, reachable via ?view=sources.
export function SourcesView() {
  return (
    <>
      <ViewHead titleKey="viewTrust" subKey="viewTrustSub" />
      <SourceStatus />
    </>
  );
}
