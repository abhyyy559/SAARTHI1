// App shell: persistent sidebar (desktop), bottom tab bar (mobile), top status bar.
// Navigation is a real <nav> with aria-current - no scroll-wall of stacked panels.
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
            data-tour={n.id === 'alerts' ? 'nav-alerts' : undefined}
          >
            <Icon name={n.icon} size={19} />
            <span>{t(lang, n.label)}</span>
          </button>
        ))}
      </nav>
      <div className="side-foot">
        <span className="mono">SIH 2026 | Problem 26068</span>
        <span className="mono">MoES / IMD</span>
        {/* The GIS / WIS 2.0 explanation lives on the trust view, which is
            deliberately outside the citizen nav. Without this it was reachable
            only by typing ?view=trust. */}
        <button
          type="button" className="btn ghost sm"
          onClick={() => setView('trust')}
        >
          <Icon name="shield" size={14} /> {t(lang, 'viewTrust')}
        </button>
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

export function TopBar() {
  const { lang, setLang, persona, setPersona, conn, loc, locStatus, locReady, requestLocation, setDistrict, districts,
          notifyOn, toggleNotify, simOffline, setSimOffline } = useApp();
  const color = connColor(conn);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <span className="topbar-title">WeatherGPT <em>| speak, listen, stay safe</em></span>
        <span className="conn" style={{ color }}>
          <span className="dot" style={{ background: color }} />
          {conn}
        </span>
        <div className="topbar-spacer" />
        <label className="mono" data-tour="persona-top">
          {t(lang, 'iAm')}
          <select value={persona} onChange={(e) => setPersona(e.target.value)} aria-label={t(lang, 'iAm')}>
            {PERSONAS.map((p) => (
              <option key={p} value={p}>
                {(PERSONA_LABELS[lang] && PERSONA_LABELS[lang][p]) || p}
              </option>
            ))}
          </select>
        </label>
        <label className="mono">
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
          <span className="mono" title={t(lang, 'locAuto')}>
            {t(lang, 'locBadgeReady')}
          </span>
        ) : (
          <button type="button" className="btn ghost sm" onClick={requestLocation} title={t(lang, 'locSub')}>
            {locStatus === 'requesting' || locStatus === 'resolving' ? '…' : t(lang, 'locCta')}
          </button>
        )}
        <label className="mono">
          {t(lang, 'lang')}
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t(lang, 'lang')}>
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <fieldset className="top-group">
          <legend>{t(lang, 'alertsGroup')}</legend>
          <IconToggle
            on={notifyOn}
            onClick={toggleNotify}
            icon="bell"
            label={notifyOn ? t(lang, 'notifyOn') : t(lang, 'notifyOff')}
          />
          <IconToggle
            on={simOffline}
            onClick={() => setSimOffline((v) => !v)}
            icon={simOffline ? 'offline' : 'cloud'}
            label={t(lang, simOffline ? 'offlineOn' : 'offlineOff')}
            tone="var(--off)"
          />
        </fieldset>
        <fieldset className="top-group">
          <legend>{t(lang, 'themeGroup')}</legend>
          <ThemeSwitch />
        </fieldset>
      </div>
    </header>
  );
}

export function StatusBanner() {
  const { sourceMode, setBackendMode, modeInfo, disaster, netState, toast, lang } = useApp();
  // Three modes, not two (docs/SOURCE-MODES.md). The banner names the sources
  // actually carrying the answer - "HYBRID" alone tells a fisherman nothing.
  const weatherSrc = (modeInfo && modeInfo.weather_source) || '';
  const warnSrc = (modeInfo && modeInfo.warnings_source) || '';
  return (
    <>
      <div className={`banner ${sourceMode === 'demo' ? 'demo' : 'live'}`} role="status">
        <span className="banner-mode">
          <b>{t(lang, 'modeLabel')}</b>
          <span className="banner-note">{modeNote(lang, sourceMode)}</span>
        </span>
        <span className="mode-switch" role="group" aria-label={t(lang, 'modeLabel')}>
          {SOURCE_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`mode-btn${sourceMode === m ? ' on' : ''}`}
              aria-pressed={sourceMode === m}
              onClick={() => setBackendMode(m)}
            >{modeLabel(lang, m)}</button>
          ))}
        </span>
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
