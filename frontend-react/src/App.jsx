import { Component, Suspense } from 'react';
import { AppProvider, useApp } from './store';
import { t } from './i18n';
import Shell from './components/Shell';
import FirstRunOnboarding from './components/FirstRunOnboarding';
import { HomeView, AlertsView, NotificationsView, AdvisoryView, AdminView, TrustSourcesView, OfflineView, SettingsView } from './views';
import { Loading } from './components/ui';

// Every id the store's `?view=` whitelist accepts must be registered here.
// IA dedup (2026-09-20): ask/advisor/details/sources are gone — their content
// was folded into Home (chat), Advisory, and Alerts (inline detail). Aviation
// is a profile, not a route — its briefing renders on Home for the aviation
// persona. A stale deep link to one of them falls back to Home; there is no
// public route.
const VIEWS = {
  home: HomeView,
  alerts: AlertsView,
  notifications: NotificationsView,
  advisory: AdvisoryView,
  offline: OfflineView,
  trust: TrustSourcesView,
  settings: SettingsView,
  admin: AdminView,
};

/** One broken view must never take the console down - and never fake data. */
class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  render() {
    if (!this.state.err) return this.props.children;
    const { lang } = this.props;
    return (
      <div className="card">
        <h2 className="card-title">{t(lang, 'boundaryTitle')}</h2>
        <p className="sub">{t(lang, 'boundaryBody')}</p>
        <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
          {String(this.state.err.message || this.state.err)}
        </pre>
      </div>
    );
  }
}

function Console() {
  const { view, lang } = useApp();
  const Active = VIEWS[view] || HomeView;
  return (
    <Shell>
      {/* First-run welcome + permission flow. One-time; the spotlight tour
          launches from its finish step, so they never overlap. */}
      <FirstRunOnboarding />
      {/* Keyed by view: without this, one view that threw kept the boundary
          in its failed state for the whole session, so every other view —
          which was working — appeared broken too. A new view must get a
          fresh boundary. */}
      <Boundary key={view} lang={lang}>
        <Suspense fallback={<Loading />}>
          <Active />
        </Suspense>
      </Boundary>
    </Shell>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Console />
    </AppProvider>
  );
}
