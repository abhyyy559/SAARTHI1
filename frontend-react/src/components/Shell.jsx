// App shell — the SIGNAL BOARD console.
// White desktop rail (248px) with full-bleed yellow active blocks,
// a utility top bar, hazard-stripe demo/offline banners, exactly four
// mobile tabs (Home · Ask · Alerts · More) with a More bottom sheet.
// Single light theme: no theme switcher.
import { useEffect, useRef, useState } from 'react';
import { HIDDEN_VIEWS, NAV, PRIMARY_VIEWS, t } from '../i18n';
import { useApp, SOURCE_MODES } from '../store';
import Icon from './icons';
import InstallPrompt from './InstallPrompt';
import OnboardingTour from './OnboardingTour';

const NAV_ICONS = {
  home: 'home',
  alerts: 'alert',
  advisory: 'sun',
  notifications: 'bell',
  offline: 'offline',
  aviation: 'send',
  trust: 'shield',
  settings: 'list',
  admin: 'layers',
};

// IA dedup: three primary tabs; everything else lives in the More sheet.
const MORE_ROWS = [
  { view: 'notifications', labelKey: 'navNotifications', icon: 'bell' },
  { view: 'offline', labelKey: 'navOffline', icon: 'offline' },
  { view: 'aviation', labelKey: 'navAviation', icon: 'send' },
  { view: 'trust', labelKey: 'navTrustSources', icon: 'shield' },
  { view: 'settings', labelKey: 'navSettings', icon: 'list' },
];
// NOTE: the old admin row was removed from MORE_ROWS on purpose — admin
// stays a HIDDEN_VIEW (i18n.js) and is never a public nav row. The
// HIDDEN_VIEWS filter above remains as a guard for any future rows.

// Global "speaking…" indicator. speak() sets speechState='loading'
// synchronously on tap, so this renders on the next frame — within 100ms of
// tapping any Listen/speaker button, with a stop control. aria-live so
// screen readers announce it.
function SpeakingIndicator() {
  const { lang, speechState, stopSpeaking } = useApp();
  if (speechState !== 'loading' && speechState !== 'playing') return null;
  return (
    <div className="speaking-chip" role="status" aria-live="polite">
      <span className="speaking-dot" aria-hidden="true" />
      {t(lang, 'speaking')}
      <button type="button" className="btn btn-ghost sm" onClick={stopSpeaking} aria-label={t(lang, 'stop')}>
        {t(lang, 'stop')}
      </button>
    </div>
  );
}

function StatusBanner({ kind, children }) {
  return (
    <div className={`banner ${kind === 'offline' ? 'banner-offline' : 'banner-hazard'}`} role="status">
      {(kind === 'demo' || kind === 'offline') && <span className="hz-stripes" aria-hidden="true" />}
      <Icon name={kind === 'offline' ? 'offline' : 'alert'} size={18} />
      <span>{children}</span>
      {(kind === 'demo' || kind === 'offline') && <span className="hz-stripes" aria-hidden="true" />}
    </div>
  );
}

function MobileNav({ current, onPick, moreOpen }) {
  const { lang, setView } = useApp();
  const tabs = [
    { view: 'home', label: t(lang, 'navHome'), icon: 'home' },
    { view: 'alerts', label: t(lang, 'navAlerts'), icon: 'alert' },
    { view: 'advisory', label: t(lang, 'navAdvisory'), icon: 'sun' },
  ];
  return (
    <nav className="mobile-nav" aria-label={t(lang, 'navLabel')}>
      <div className="mnav-inner">
        {tabs.map((tb) => (
          <button
            key={tb.view}
            type="button"
            className={`mnav-item${current === tb.view ? ' is-active' : ''}`}
            data-tour={tb.view === 'alerts' ? 'nav-alerts' : undefined}
            aria-current={current === tb.view ? 'page' : undefined}
            onClick={() => setView(tb.view)}
          >
            <Icon name={tb.icon} size={22} />
            <span>{tb.label}</span>
          </button>
        ))}
        <button
          type="button"
          className={`mnav-item${moreOpen ? ' is-active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={!!moreOpen}
          onClick={onPick}
        >
          <Icon name="menu" size={22} />
          <span>{t(lang, 'menuMore')}</span>
        </button>
      </div>
    </nav>
  );
}

function MoreSheet({ open, onClose }) {
  const { lang, setView } = useApp();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const go = (view) => { setView(view); onClose(); };
  return (
    <>
      <button type="button" className="sheet-scrim" aria-label={t(lang, 'close')} onClick={onClose} />
      <div className="more-sheet" role="dialog" aria-modal="true" aria-label={t(lang, 'menuMore')}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="more-title">
          <span className="kicker">{t(lang, 'navSections')}</span>
        </div>
        {/* Team-only views (HIDDEN_VIEWS) stay out of the public More sheet. */}
        {MORE_ROWS.filter((r) => !HIDDEN_VIEWS.includes(r.view)).map((r) => (
          <button key={r.view} type="button" className="more-row" onClick={() => go(r.view)}>
            <span className="rail-icon"><Icon name={r.icon} size={20} /></span>
            <span>{t(lang, r.labelKey)}</span>
            <span className="chev"><Icon name="chevron" size={18} /></span>
          </button>
        ))}
        <button
          type="button"
          className="more-row"
          onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('wgpt:tour')); }}
        >
          <span className="rail-icon"><Icon name="eye" size={20} /></span>
          <span>{t(lang, 'sbTakeTour')}</span>
          <span className="chev"><Icon name="chevron" size={18} /></span>
        </button>
      </div>
    </>
  );
}

export default function Shell({ children }) {
  const { view, setView, lang, setLang, loc, locReady, sourceMode, setBackendMode, notifyOn, toggleNotify, disaster, netState } = useApp();
  const online = netState !== 'offline';
  const [moreOpen, setMoreOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  useEffect(() => {
    const onToast = (e) => {
      setToast(e.detail || null);
      clearTimeout(toastTimer.current);
      if (e.detail) {
        toastTimer.current = setTimeout(() => setToast(null), 4200);
      }
    };
    window.addEventListener('wgpt:toast', onToast);
    return () => {
      window.removeEventListener('wgpt:toast', onToast);
      clearTimeout(toastTimer.current);
    };
  }, []);

  const conn = !online ? 'offline' : 'online';
  const connLabel = t(lang, conn === 'online' ? 'connOnline' : 'connOffline');

  const demoLive = sourceMode === 'demo';
  // The demo-data banner only belongs where demo/sample content can appear:
  // never on Admin or Trust chrome. SOS carries its own
  // "SIMULATED — FOR DEMO ONLY" stamp and lives inside the alerts view.
  const demoBannerViews = new Set(['home', 'alerts', 'advisory', 'notifications', 'offline', 'aviation', 'trust']);
  const showDemoBanner = demoLive && demoBannerViews.has(view);

  return (
    <div className="app">
      <a className="skip-link" href="#main">{t(lang, 'skipToContent')}</a>

      {/* -------- console rail -------- */}
      <aside className="rail" aria-label={t(lang, 'navLabel')}>
        <div className="rail-brand">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span className="brand-name">
            <b>SAARTHI</b>
            <span>WeatherGPT · India</span>
          </span>
        </div>
        <nav className="rail-nav">
          {/* Team-only views (HIDDEN_VIEWS) never appear in the public nav.
              Three primary tabs, then the More sheet's rows as a section. */}
          {PRIMARY_VIEWS.map((id) => {
            const n = NAV.find((x) => x.id === id);
            if (!n) return null;
            return (
              <button
                key={n.id}
                type="button"
                className={`rail-item${view === n.id ? ' is-active' : ''}`}
                data-tour={n.id === 'alerts' ? 'nav-alerts' : undefined}
                aria-current={view === n.id ? 'page' : undefined}
                onClick={() => setView(n.id)}
              >
                <span className="rail-icon"><Icon name={NAV_ICONS[n.id] || 'info'} size={20} /></span>
                <span>{t(lang, n.label)}</span>
              </button>
            );
          })}
          <div className="rail-more-label"><span>{t(lang, 'menuMore')}</span></div>
          {MORE_ROWS.filter((r) => !HIDDEN_VIEWS.includes(r.view)).map((r) => (
            <button
              key={r.view}
              type="button"
              className={`rail-item rail-sub${view === r.view ? ' is-active' : ''}`}
              aria-current={view === r.view ? 'page' : undefined}
              onClick={() => setView(r.view)}
            >
              <span className="rail-icon"><Icon name={r.icon} size={20} /></span>
              <span>{t(lang, r.labelKey)}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="sih">{t(lang, 'sbSih')}</div>
          <button
            type="button"
            className="btn sm"
            onClick={() => window.dispatchEvent(new CustomEvent('wgpt:tour'))}
          >
            <Icon name="eye" size={16} />
            {t(lang, 'sbTakeTour')}
          </button>
        </div>
      </aside>

      {/* -------- main column -------- */}
      <div className="main-col">
        <header className="topbar">
          <span className="brand-mark" aria-hidden="true">S</span>
          <div className="district-stamp" aria-live="polite">
            <span className="pin"><Icon name="pin" size={16} /></span>
            <span>
              <span className="sub-label">{t(lang, 'sbDistrictKicker')}</span>
              {locReady && loc.district ? loc.district : t(lang, 'noDistrict')}
            </span>
          </div>
          <div className="topbar-spacer" />

          {/* Mode controls live on the Admin view only — they are backstage,
              not a citizen setting. Rendered from SOURCE_MODES so the three
              modes always stay in sync with the store. */}
          {view === 'admin' && (
            <div className="segmented" role="group" aria-label={t(lang, 'demoModeTitle')}>
              {SOURCE_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`seg-opt${sourceMode === m ? ' is-active' : ''}`}
                  aria-pressed={sourceMode === m}
                  onClick={() => setBackendMode(m)}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <div className="topbar-group">
            <span className={`conn-pill is-${conn}`} role="status" title={connLabel}>
              <span className="dot" aria-hidden="true" />
              <span className="pill-label">{connLabel}</span>
            </span>
            <button
              type="button"
              className={`btn-icon bell-btn${notifyOn ? ' is-on' : ''}`}
              title={notifyOn ? t(lang, 'notifyOn') : t(lang, 'notifyOff')}
              aria-label={notifyOn ? t(lang, 'notifyOn') : t(lang, 'notifyOff')}
              aria-pressed={!!notifyOn}
              onClick={toggleNotify}
            >
              <Icon name="bell" size={20} />
            </button>
            <div className="segmented langseg" role="group" aria-label={t(lang, 'langLabel')}>
              {['en', 'hi', 'te'].map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`seg-opt${lang === l ? ' is-active' : ''}`}
                  aria-pressed={lang === l}
                  onClick={() => setLang(l)}
                >
                  {l === 'en' ? 'EN' : l === 'hi' ? 'हिं' : 'తె'}
                </button>
              ))}
            </div>
          </div>
        </header>

        {showDemoBanner && (
          <StatusBanner kind="demo">
            {t(lang, 'sbBannerDemo')}
          </StatusBanner>
        )}
        {!online && (
          <StatusBanner kind="offline">
            {t(lang, 'sbBannerOffline')}
          </StatusBanner>
        )}
        {disaster && (
          <StatusBanner kind="hazard">
            {t(lang, 'disasterBanner')}
          </StatusBanner>
        )}

        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>

      <MobileNav current={view} moreOpen={moreOpen} onPick={() => setMoreOpen(true)} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <InstallPrompt />
      <OnboardingTour />

      {toast && (
        <div className={`toast${toast.error ? ' is-error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
      <SpeakingIndicator />
    </div>
  );
}
