import { Component, Suspense } from 'react';
import { AppProvider, useApp } from './store';
import { t } from './i18n';
import { Sidebar, TopBar, MobileNav, StatusBanner } from './components/Shell';
import { HomeView, AskView, AlertsView, NotificationsView, AdvisorView, AdvisoryView, AdminView, TrustView, DetailsView, SourcesView } from './views';
import { Loading } from './components/ui';
import InstallPrompt from './components/InstallPrompt';
import OnboardingTour from './components/OnboardingTour';

// Every id the store's `?view=` whitelist accepts must be registered here.
// `trust` was whitelisted but missing, so /?view=trust silently rendered Home
// instead of the source-status and GIS/WIS explanation it promises.
const VIEWS = {
  home: HomeView,
  ask: AskView,
  alerts: AlertsView,
  notifications: NotificationsView,
  advisor: AdvisorView,
  advisory: AdvisoryView,
  admin: AdminView,
  trust: TrustView,
  details: DetailsView,
  sources: SourcesView,
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
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <Sidebar />
      <div className="main">
        <TopBar />
        <StatusBanner />
        <main className="view" id="main" tabIndex={-1}>
          {/* Keyed by view: without this, one view that threw kept the boundary
              in its failed state for the whole session, so every other view —
              which was working — appeared broken too. A new view must get a
              fresh boundary. */}
          <Boundary key={view} lang={lang}>
            <Suspense fallback={<Loading />}>
              <Active />
            </Suspense>
          </Boundary>
        </main>
      </div>
      <MobileNav />
      <InstallPrompt />
      <OnboardingTour />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Console />
    </AppProvider>
  );
}
