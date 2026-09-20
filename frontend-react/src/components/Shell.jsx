// App shell: persistent sidebar (desktop), bottom tab bar (mobile), top status bar.
// Navigation is a real <nav> with aria-current - no scroll-wall of stacked panels.
//
// REDESIGN (Sep 2026)
// -------------------
// The old TopBar held EIGHT controls on one row: persona, district, GPS,
// language, notification toggle, offline-sim toggle, theme switch and the
// connection pill. On a 360px phone the citizen's chrome was the app. The new
// shell is two-tier:
//
//   Tier 1 (always visible): brand, connection pill, notification toggle,
//   language, and a "More" overflow menu. Four controls, all thumb-sized.
//   Tier 2 (inside More): settings (theme + offline-sim), persona + district,
//   GPS locate, a discreet demo section (the data-source mode switch lives
//   here AND in the Admin demo panel — never in the open citizen chrome), and
//   "Take the tour".
//
// Mobile nav now carries Trust (six tabs, 48px targets); the mode switch left
// the StatusBanner for Admin, leaving the banner a compact informational chip.
import { useEffect, useRef, useState } from 'react';
import { t, NAV, PERSONAS, PERSONA_LABELS, DISTRICTS } from '../i18n';
import { useApp, SOURCE_MODES, modeLabel, modeNote } from '../store';
import Icon from './icons';

const CONN_COLOR = { LIVE: 'var(--live)', OFFLINE: 'var(--off)' };
const connColor = (c) => CONN_COLOR[c] || 'var(--cached)';

const THEME_OPTIONS = [
  { id: 'auto', icon: 'monitor', labelKey: 'themeAuto' },
  { id: 'light', icon: 'sun', labelKey: 'themeLight' },
  { id: 'dark', icon: 'moon', labelKey: 'themeDark' },
];

const LANGS = [
  { id: 'en', label: 'EN' },
  { id: 'hi', label: '\u0939\u093f\u0902\u0926\u0940' },
  { id: 'te', label: '\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41' },
];

function ThemeSwitch() {
  const { theme, setTheme, lang } = useApp();
  return (
    <div className="seg" role="group" aria-label={t(lang, 'themeLabel')}>
      {THEME_OPTIONS.map((o) => {
        const label = t(lang, o.labelKey);
        return (
          <button
            key={o.id}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={theme === o.id}
            onClick={() => setTheme(o.id)}
          >
            <Icon name={o.icon} size={17} />
          </button>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const { view, setView, lang } = useApp();
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><Icon name="bolt" size={20} /></span>
        <span className="brand-text">
          <b>WeatherGPT</b>
          <span>Ask. Listen. Stay safe.</span>
        </span>
      </div>
      <nav className="nav" aria-label={t(lang, 'navSections')}>
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            className="nav-item"
            aria-current={view === n.id ? 'page' : undefined}
            onClick={() => setView(n.id)}
          >
            <Icon name={n.icon} size={19} />
            <span>{t(lang, n.label)}</span>
          </button>
        ))}
      </nav>
      <div className="side-foot">
        <span className="mono">SIH 2026 | Problem 26068</span>
        <span className="mono">MoES / IMD</span>
        <button
          type="button" className="btn ghost sm"
          onClick={() => window.dispatchEvent(new Event('wgpt:tour'))}
        >
          {t(lang, 'obTour')}
        </button>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const { view, setView, lang } = useApp();
  return (
    <nav className="mobile-nav" aria-label={t(lang, 'navSections')}>
      {NAV.map((n) => (
        <button
          key={n.id}
          type="button"
          className="mobile-tab"
          aria-current={view === n.id ? 'page' : undefined}
          onClick={() => setView(n.id)}
          // The onboarding step for alerts points at the mobile tab — the
          // audience is mobile-first, and this is the tab they can see.
          data-tour={n.id === 'alerts' ? 'nav-alerts' : undefined}
        >
          <Icon name={n.icon} size={20} />
          <span>{t(lang, n.label)}</span>
        </button>
      ))}
    </nav>
  );
}

function IconToggle({ on, onClick, icon, label, tone }) {
  return (
    <button
      type="button"
      className="btn ghost sm"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        opacity: on ? 1 : 0.45,
        color: on ? (tone || 'var(--accent)') : 'var(--ink-3)',
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

// The discreet demo section: the data-source mode switch for the operator,
// behind the More menu (and in the Admin panel). Rendered from SOURCE_MODES —
// a hardcoded pair here is how the old two-way LIVE/DEMO switch crept back.
function DemoSection({ onDone }) {
  const { lang, sourceMode, setBackendMode } = useApp();
  return (
    <div className="top-demo">
      <b className="top-demo-title">{t(lang, 'demoModeTitle')}</b>
      <p className="sub">{t(lang, 'demoModeSub')}</p>
      <div className="mode-switch" role="group" aria-label={t(lang, 'demoModeTitle')}>
        {SOURCE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={`mode-btn${sourceMode === m ? ' on' : ''}`}
            aria-pressed={sourceMode === m}
            onClick={() => { setBackendMode(m); onDone(); }}
          >{modeLabel(lang, m)}</button>
        ))}
      </div>
    </div>
  );
}

export function TopBar() {
  const { lang, setLang, persona, setPersona, conn, connectionPill, loc, locStatus, locReady, requestLocation, setDistrict, districts,
          notifyOn, toggleNotify, simOffline, setSimOffline, setView } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const color = connColor(conn);
  const pillLabel = connectionPill === 'Online' ? t(lang, 'connOnline')
    : connectionPill === 'Cached' ? t(lang, 'connCached') : t(lang, 'connOffline');

  // The overflow menu closes on Escape or an outside tap; it is not modal, so
  // no focus trap — the trigger keeps a correct aria-expanded.
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
    const onDoc = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDoc);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDoc);
    };
  }, [moreOpen]);
  const closeMore = () => setMoreOpen(false);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <span className="topbar-title">WeatherGPT <em>| speak, listen, stay safe</em></span>
        <span className="conn" role="status" style={{ color }}>
          <span className="dot" style={{ background: color }} />
          {pillLabel}
        </span>
        <span className="topbar-spacer" />
        {/* Tier 1: the four citizen controls. Everything else is one tap away
            behind More, so the chrome never crowds the verdict. */}
        <IconToggle
          on={notifyOn}
          onClick={toggleNotify}
          icon="bell"
          label={notifyOn ? t(lang, 'notifyOn') : t(lang, 'notifyOff')}
        />
        <label className="mono top-lang">
          <span className="sr-only">{t(lang, 'lang')}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t(lang, 'lang')}>
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <div className="top-more" ref={moreRef}>
          <button
            type="button" className="btn ghost sm top-more-btn"
            aria-expanded={moreOpen} aria-haspopup="menu"
            aria-label={t(lang, 'menuMore')} title={t(lang, 'menuMore')}
            onClick={() => setMoreOpen((o) => !o)}
          >
            <Icon name="menu" size={18} />
          </button>
          {moreOpen && (
            <div className="top-menu" role="menu" aria-label={t(lang, 'menuMore')}>
              <fieldset className="top-group">
                <legend>{t(lang, 'menuSettings')}</legend>
                <ThemeSwitch />
                <IconToggle
                  on={simOffline}
                  onClick={() => setSimOffline((v) => !v)}
                  icon={simOffline ? 'offline' : 'cloud'}
                  label={t(lang, simOffline ? 'offlineOn' : 'offlineOff')}
                  tone="var(--off)"
                />
              </fieldset>
              <label className="mono top-menu-row" data-tour="persona-top">
                {t(lang, 'iAm')}
                <select value={persona} onChange={(e) => setPersona(e.target.value)} aria-label={t(lang, 'iAm')}>
                  {PERSONAS.map((p) => (
                    <option key={p} value={p}>
                      {(PERSONA_LABELS[lang] && PERSONA_LABELS[lang][p]) || p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mono top-menu-row">
                {t(lang, 'district')}
                <select
                  value={loc.district}
                  onChange={(e) => {
                    const d = DISTRICTS.find((x) => x.district === e.target.value);
                    if (d) setDistrict(d);
                  }}
                  aria-label={t(lang, 'district')}
                >
                  {districts.map((d) => <option key={d.district} value={d.district}>{d.district}</option>)}
                </select>
              </label>
              {locReady && loc.source === 'gps' ? (
                <span className="mono top-menu-row" title={t(lang, 'locAuto')}>
                  {t(lang, 'locBadgeReady')}
                </span>
              ) : (
                <button type="button" className="btn ghost sm top-menu-row" onClick={() => { requestLocation(); }} title={t(lang, 'locSub')}>
                  {locStatus === 'requesting' || locStatus === 'resolving' ? '…' : t(lang, 'locCta')}
                </button>
              )}
              <DemoSection onDone={closeMore} />
              <button
                type="button" className="btn ghost sm top-menu-row"
                onClick={() => { closeMore(); setView('admin'); }}
              >
                <Icon name="layers" size={14} /> {t(lang, 'menuOpenDemo')}
              </button>
              <button
                type="button" className="btn ghost sm top-menu-row"
                onClick={() => { closeMore(); window.dispatchEvent(new Event('wgpt:tour')); }}
              >
                <Icon name="eye" size={14} /> {t(lang, 'obTour')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export function StatusBanner() {
  const { sourceMode, setView, modeInfo, disaster, netState, toast, lang } = useApp();
  // The mode SWITCH moved to the More menu and the Admin demo panel. The
  // banner keeps a compact informational chip — tapping it opens Admin, so the
  // jury can still reach the switch in one tap.
  const weatherSrc = (modeInfo && modeInfo.weather_source) || '';
  const warnSrc = (modeInfo && modeInfo.warnings_source) || '';
  return (
    <>
      <div className={`banner ${sourceMode === 'demo' ? 'demo' : 'live'}`} role="status">
        <button
          type="button" className="banner-mode-chip"
          onClick={() => setView('admin')}
          title={t(lang, 'menuDemoControls')}
        >
          <b>{modeLabel(lang, sourceMode)}</b>
          <span className="banner-note">{modeNote(lang, sourceMode)}</span>
        </button>
      </div>
      {/* Which source feeds what. Only shown once the backend has told us. */}
      {sourceMode !== 'demo' && (weatherSrc || warnSrc) && (
        <div className="banner live mode-sources">
          <span><b>{t(lang, 'modeWeather')}</b> {weatherSrc}</span>
          <span><b>{t(lang, 'modeWarnings')}</b> {warnSrc}</span>
        </div>
      )}
      {netState === 'offline' && (
        <div className="banner demo" role="alert">
          {t(lang, 'offlineBanner')}
        </div>
      )}
      {netState === 'reconnecting' && (
        <div className="banner live" role="status">
          {t(lang, 'reconnecting')}
        </div>
      )}
      {disaster && (
        <div className="banner disaster" role="alert">
          {t(lang, 'disasterBanner')}
        </div>
      )}
      {toast && (
        <div role="status" aria-live="polite" style={{
          position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-2)', color: 'var(--ink)', border: '1px solid var(--line)',
          borderRadius: 12, padding: '10px 16px', zIndex: 200, boxShadow: 'var(--shadow)',
          maxWidth: 'calc(100vw - 32px)', textAlign: 'center',
        }}>
          {toast}
        </div>
      )}
    </>
  );
}
