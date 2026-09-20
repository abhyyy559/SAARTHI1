import { Component, Suspense } from 'react';
import { AppProvider, useApp } from './store';
import { t } from './i18n';
import Shell from './components/Shell';
import { HomeView, AskView, AlertsView, NotificationsView, AdvisorView, AdvisoryView, AdminView, TrustView, DetailsView, SourcesView } from './views';
import { Loading } from './components/ui';

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
    <Shell>
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
