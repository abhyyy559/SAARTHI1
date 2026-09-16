// App shell: persistent sidebar (desktop), bottom tab bar (mobile), top status bar.
// Navigation is a real <nav> with aria-current - no scroll-wall of stacked panels.
import { t, NAV, PERSONAS, PERSONA_LABELS } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

const CONN_COLOR = { LIVE: 'var(--live)', OFFLINE: 'var(--off)' };
const connColor = (c) => CONN_COLOR[c] || 'var(--cached)';

const THEME_OPTIONS = [
  { id: 'auto', icon: 'monitor', label: 'Match system theme' },
  { id: 'light', icon: 'sun', label: 'Light theme' },
  { id: 'dark', icon: 'moon', label: 'Dark theme' },
];

const LANGS = [
  { id: 'en', label: 'EN' },
  { id: 'hi', label: '\u0939\u093f\u0902\u0926\u0940' },
  { id: 'te', label: '\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41' },
];

function ThemeSwitch() {
  const { theme, setTheme } = useApp();
  return (
    <div className="seg" role="group" aria-label="Colour theme">
      {THEME_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.label}
          aria-label={o.label}
          aria-pressed={theme === o.id}
          onClick={() => setTheme(o.id)}
        >
          <Icon name={o.icon} size={17} />
        </button>
      ))}
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
      <nav className="nav" aria-label="Sections">
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
      </div>
    </aside>
  );
}

export function MobileNav() {
  const { view, setView, lang } = useApp();
  return (
    <nav className="mobile-nav" aria-label="Sections">
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

export function TopBar() {
  const { lang, setLang, persona, setPersona, conn } = useApp();
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
        <label className="mono">
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
          {t(lang, 'lang')}
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t(lang, 'lang')}>
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <ThemeSwitch />
      </div>
    </header>
  );
}

export function StatusBanner() {
  const { demoMode, disaster } = useApp();
  return (
    <>
      <div className={`banner ${demoMode ? 'demo' : 'live'}`} role="status">
        {demoMode
          ? 'DEMO MODE - simulated data, clearly labelled'
          : 'LIVE MODE - real sources, provenance on every fact'}
      </div>
      {disaster && (
        <div className="banner disaster" role="alert">
          DISASTER MODE - verified severe warning active. Safety first, then communication.
        </div>
      )}
    </>
  );
}
