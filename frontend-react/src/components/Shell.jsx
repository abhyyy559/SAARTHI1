// App shell — the SIGNAL BOARD console.
// White desktop rail (248px) with full-bleed yellow active blocks,
// a utility top bar, hazard-stripe demo/offline banners, exactly four
// mobile tabs (Home · Ask · Alerts · More) with a More bottom sheet.
// Single light theme: no theme switcher.
import { useEffect, useRef, useState } from 'react';
import { HIDDEN_VIEWS, NAV, PRIMARY_VIEWS, t } from '../i18n';
import { useApp, SOURCE_MODES } from '../store';
import { resolveVoicePopup } from '../voiceUi';
import { notificationsApi } from '../api';
import Icon from './icons';
import InstallPrompt from './InstallPrompt';
import NotificationsPanel from './NotificationsPanel';
import OnboardingTour from './OnboardingTour';

const NAV_ICONS = {
  home: 'home',
  alerts: 'alert',
  advisory: 'sun',
  offline: 'offline',
  aviation: 'send',
  trust: 'shield',
  settings: 'list',
  admin: 'layers',
};

// IA dedup: three primary tabs; everything else lives in the More sheet.
// Notifications are NOT a More-sheet row: the topbar bell opens the
// notifications side panel, which is the one and only notifications home.
const MORE_ROWS = [
  { view: 'offline', labelKey: 'navOffline', icon: 'offline' },
  { view: 'trust', labelKey: 'navTrustSources', icon: 'shield' },
  { view: 'settings', labelKey: 'navSettings', icon: 'list' },
];
// NOTE: the old admin row was removed from MORE_ROWS on purpose — admin
// stays a HIDDEN_VIEW (i18n.js) and is never a public nav row. The
// HIDDEN_VIEWS filter above remains as a guard for any future rows.

// Global voice popup — unmissable, Harbour Signal dressed. speak() flips
// speechState synchronously on tap so the Speaking card renders on the next
// frame; HomeChat mirrors its mic phase into listenState for the Listening
// card. Fixed near the top so it never covers the mic toggle or
// the chat composer at mobile widths. aria-live announces it to screen
// readers. Dismissal is automatic: state returns to idle on audio end,
// or the user taps it away.
// final transcript, error, timeout, or permission denial.
function VoicePopups() {
  const { lang, speechState, stopSpeaking, listenState } = useApp();
  const model = resolveVoicePopup({ speechState, listenState });
  if (!model) return null;
  return (
    <div className="voice-popup" role="status" aria-live="polite">
      {model.visual === 'bars' ? (
        <span className="voice-bars" aria-hidden="true"><i /><i /><i /><i /></span>
      ) : (
        <span className="voice-dot" aria-hidden="true" />
      )}
      <span className="voice-popup-text">
        <strong>{t(lang, model.labelKey)}</strong>
        {model.subKey && <small>{t(lang, model.subKey)}</small>}
      </span>
      {model.kind === 'tts' && (
        <button type="button" className="btn btn-ghost sm" onClick={stopSpeaking} aria-label={t(lang, 'stop')}>
          {t(lang, 'stop')}
        </button>
      )}
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
  const { view, setView, lang, setLang, loc, locReady, sourceMode, setBackendMode, disaster, netState, device, syncTick } = useApp();
  const online = netState !== 'offline';
  const [moreOpen, setMoreOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  // The bell badge: the server's unread count for this device. Refreshed on
  // district/device/sync changes; while the panel is open the panel reports
  // its own count so the badge clears the moment items are marked read.
  useEffect(() => {
    if (panelOpen) return undefined;
    let alive = true;
    notificationsApi.unread(loc.district, device)
      .then((d) => { if (alive) setUnread(Number(d.unread) || 0); })
      .catch(() => { /* badge keeps its last known count */ });
    return () => { alive = false; };
  }, [loc.district, device, syncTick, panelOpen]);

  // Stale ?view=notifications deep links (and any other opener) raise this
  // event; the panel is the one and only notifications home.
  useEffect(() => {
    const open = () => setPanelOpen(true);
    window.addEventListener('wgpt:notifications-open', open);
    return () => window.removeEventListener('wgpt:notifications-open', open);
  }, []);

  // Belt and braces for the redirect above: React runs child effects before
  // parent effects, so on a FRESH ?view=notifications load the child's
  // wgpt:notifications-open fires before this listener attaches and the event
  // is lost. Watching the view directly has no ordering dependency.
  useEffect(() => {
    if (view === 'notifications') {
      setPanelOpen(true);
      setView('home');
    }
  }, [view, setView]);

  useEffect(() => {
    const onToast = (e) => {
      // The event detail may be a plain string (store's showToast) or an
      // object ({text, error}). The renderer reads toast.text, so normalize:
      // a string detail must not render as an empty toast.
      const detail = e.detail;
      const shaped = typeof detail === 'string' ? { text: detail } : detail;
      setToast(shaped || null);
      clearTimeout(toastTimer.current);
      if (shaped) {
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
  const demoBannerViews = new Set(['home', 'alerts', 'advisory', 'notifications', 'offline', 'trust']);
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
            {/* The bell OPENS the notifications side panel — it no longer
                toggles push on/off directly. The enable/disable switch lives
                inside the panel (store's toggleNotify). The badge is the
                server's unread count for this device. */}
            <button
              type="button"
              className="btn-icon bell-btn"
              data-tour="notify-bell"
              title={t(lang, 'navNotifications')}
              aria-label={unread > 0 ? t(lang, 'panelBellUnread').replace('{n}', String(unread)) : t(lang, 'navNotifications')}
              aria-haspopup="dialog"
              onClick={() => setPanelOpen(true)}
            >
              <Icon name="bell" size={20} />
              {unread > 0 && (
                <span className="bell-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>
              )}
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
      <NotificationsPanel open={panelOpen} onClose={() => setPanelOpen(false)} onUnread={setUnread} />
      <InstallPrompt />
      <OnboardingTour />

      {toast && (
        <div className={`toast${toast.error ? ' is-error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
      <VoicePopups />
    </div>
  );
}
