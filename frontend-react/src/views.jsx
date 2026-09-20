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
import { Card } from './components/ui';
import SourceStrip from './components/SourceStrip';
import Icon from './components/icons';

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
