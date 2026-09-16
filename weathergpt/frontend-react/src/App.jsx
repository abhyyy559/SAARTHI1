import { Component, Suspense } from 'react';
import { AppProvider, useApp } from './store';
import { Sidebar, TopBar, MobileNav, StatusBanner } from './components/Shell';
import { HomeView, AskView, AlertsView } from './views';
import { Loading } from './components/ui';

const VIEWS = {
  home: HomeView,
  ask: AskView,
  alerts: AlertsView,
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
        <h2 className="card-title">This view failed to render</h2>
        <p className="sub">
          The rest of the console keeps working. Nothing was invented to fill the gap
          {lang ? '' : ''}.
        </p>
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
          <Boundary lang={lang}>
            <Suspense fallback={<Loading label="Loading map..." />}>
              <Active />
            </Suspense>
          </Boundary>
        </main>
      </div>
      <MobileNav />
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
