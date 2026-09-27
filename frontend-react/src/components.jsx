// SAARTHI v2 component library — part 1: icons + primitives.
import { useEffect, useRef, useState } from 'react';
import { t, tp } from './i18n.jsx';
import { skyTheme, conditionKind, severityMeta, sourceStatusMeta, agoParts, fmtTemp, weekdayLabel, normalizeAlert } from './lib.js';
import { useEscape } from './hooks.js';

/* ---------------- Icons (inline SVG, stroke style) ---------------- */
const Svg = ({ children, ...p }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{children}</svg>
);

export const I = {
  sun: (p) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>,
  moon: (p) => <Svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></Svg>,
  cloud: (p) => <Svg {...p}><path d="M17.5 19a4.5 4.5 0 0 0 .4-8.98 6 6 0 0 0-11.7 1.62A4 4 0 0 0 7 19h10.5z" /></Svg>,
  rain: (p) => <Svg {...p}><path d="M17.5 15a4.5 4.5 0 0 0 .4-8.98 6 6 0 0 0-11.7 1.62A4 4 0 0 0 7 15" /><path d="M8 18v2.5M12 17v3.5M16 18v2.5" /></Svg>,
  bolt: (p) => <Svg {...p}><path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2z" /></Svg>,
  fog: (p) => <Svg {...p}><path d="M4 10h16M6 14h12M4 18h16M8 6h8" /></Svg>,
  snow: (p) => <Svg {...p}><path d="M12 2v20M4 6l16 12M20 6 4 18M12 6l-2-2M12 6l2-2M12 18l-2 2M12 18l2 2" /></Svg>,
  wind: (p) => <Svg {...p}><path d="M3 8h9a3 3 0 1 0-3-3M3 12h13a3 3 0 1 1-3 3M3 16h6a2.5 2.5 0 1 1-2.5 2.5" /></Svg>,
  drop: (p) => <Svg {...p}><path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z" /></Svg>,
  umbrella: (p) => <Svg {...p}><path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 3v2M12 12v7a2 2 0 0 0 4 0" /></Svg>,
  pin: (p) => <Svg {...p}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></Svg>,
  bell: (p) => <Svg {...p}><path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9zM10 20a2 2 0 0 0 4 0" /></Svg>,
  home: (p) => <Svg {...p}><path d="M3 11.5 12 4l9 7.5M5.5 10.5V20h13v-9.5" /></Svg>,
  alertTri: (p) => <Svg {...p}><path d="M12 3 2.5 20h19L12 3zM12 10v4M12 17.5v.01" /></Svg>,
  spark: (p) => <Svg {...p}><path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" /></Svg>,
  chat: (p) => <Svg {...p}><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" /></Svg>,
  dots: (p) => <Svg {...p}><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></Svg>,
  mic: (p) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>,
  send: (p) => <Svg {...p}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></Svg>,
  x: (p) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>,
  check: (p) => <Svg {...p}><path d="M4.5 12.5 10 18 19.5 6.5" /></Svg>,
  chevR: (p) => <Svg {...p}><path d="m9 5 7 7-7 7" /></Svg>,
  chevD: (p) => <Svg {...p}><path d="m5 9 7 7 7-7" /></Svg>,
  search: (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>,
  shield: (p) => <Svg {...p}><path d="M12 3 5 6v5c0 5 3.4 8.4 7 10 3.6-1.6 7-5 7-10V6l-7-3z" /><path d="m9 12 2 2 4-4.5" /></Svg>,
  clock: (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></Svg>,
  info: (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></Svg>,
  phone: (p) => <Svg {...p}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></Svg>,
  refresh: (p) => <Svg {...p}><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /></Svg>,
  user: (p) => <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></Svg>,
  sprout: (p) => <Svg {...p}><path d="M12 21v-8M12 13c0-4 3-7 8-7 0 4-3 7-8 7zM12 13c0-3-2.5-5-6-5 0 3 2.5 5 6 5z" /></Svg>,
  truck: (p) => <Svg {...p}><path d="M2 6h12v10H2zM14 10h4l4 4v2h-8" /><circle cx="6.5" cy="18" r="1.8" /><circle cx="17.5" cy="18" r="1.8" /></Svg>,
  waves: (p) => <Svg {...p}><path d="M2 8c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2M2 14c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2" /></Svg>,
  plane: (p) => <Svg {...p}><path d="M10.5 13.5 3 11l1.5-1.5L11 11l3.5-5.5c.8-1.2 2.5-1.4 3.4-.6.9.9.7 2.6-.6 3.4L13 12l1.5 6.5L13 20l-2.5-6.5z" /></Svg>,
  bus: (p) => <Svg {...p}><rect x="3" y="4" width="18" height="12" rx="2.5" /><path d="M3 10h18M7 20v-4M17 20v-4" /><circle cx="7.5" cy="18.5" r="0.5" /><circle cx="16.5" cy="18.5" r="0.5" /></Svg>,
  briefcase: (p) => <Svg {...p}><rect x="3" y="8" width="18" height="12" rx="2.5" /><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" /></Svg>,
  eye: (p) => <Svg {...p}><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.8" /></Svg>,
  globe: (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18" /></Svg>,
  db: (p) => <Svg {...p}><ellipse cx="12" cy="5.5" rx="8" ry="2.8" /><path d="M4 5.5v13c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-13M4 12c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8" /></Svg>,
};

export const ROLE_ICONS = {
  general: I.user, farmer: I.sprout, driver: I.truck, fisherman: I.waves,
  aviation: I.plane, commuter: I.bus, office: I.briefcase,
};

/* ---------------- CountUp ---------------- */
export function CountUp({ value, format = fmtTemp, duration = 900 }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const target = Number(value);
    if (!Number.isFinite(target) || reduce) { setDisplay(Number.isFinite(target) ? target : 0); return; }
    const from = fromRef.current;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = from + (target - from) * eased;
      setDisplay(cur);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <span>{format(display)}</span>;
}

/* ---------------- ConditionArt: animated SVG sky art ---------------- */
export function ConditionArt({ condition, night }) {
  const kind = conditionKind(condition);
  if (kind === 'clear' && !night) {
    return (
      <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g className="art-rays" opacity="0.9">
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * Math.PI) / 6;
            return <line key={i} x1={320 + Math.cos(a) * 52} y1={70 + Math.sin(a) * 52}
              x2={320 + Math.cos(a) * 74} y2={70 + Math.sin(a) * 74}
              stroke="#fff7d6" strokeWidth="7" strokeLinecap="round" />;
          })}
        </g>
        <circle cx="320" cy="70" r="42" fill="#ffe9a8" />
        <circle cx="320" cy="70" r="34" fill="#ffd968" />
        <g className="art-cloud" opacity="0.85"><ellipse cx="90" cy="200" rx="70" ry="22" fill="#ffffff" opacity="0.5" /></g>
        <g className="art-cloud slow" opacity="0.6"><ellipse cx="250" cy="230" rx="90" ry="20" fill="#ffffff" opacity="0.35" /></g>
      </svg>
    );
  }
  if (kind === 'clear' && night) {
    return (
      <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {[[60, 40], [150, 70], [230, 35], [300, 90], [110, 120], [350, 150], [200, 130]].map(([x, y], i) => (
          <circle key={i} className="art-star" cx={x} cy={y} r={i % 3 === 0 ? 2.6 : 1.6}
            fill="#fff" style={{ animationDelay: `${i * 0.5}s` }} />
        ))}
        <path d="M300 40a44 44 0 1 0 24 80 36 36 0 1 1-24-80z" fill="#f4ecd8" />
        <g className="art-cloud" opacity="0.5"><ellipse cx="120" cy="210" rx="80" ry="20" fill="#8ea6c9" opacity="0.5" /></g>
      </svg>
    );
  }
  if (kind === 'storm') {
    return (
      <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g className="art-cloud"><ellipse cx="200" cy="80" rx="130" ry="44" fill="#2b2a4a" opacity="0.9" />
          <ellipse cx="120" cy="100" rx="70" ry="30" fill="#3a3860" opacity="0.9" /></g>
        <path className="art-bolt" d="M205 110l-28 52h22l-8 48 44-66h-24l14-34h-20z" fill="#fde047" />
        <g className="art-rain" stroke="#9fc3e8" strokeWidth="4" strokeLinecap="round">
          {[90, 140, 260, 310].map((x, i) => (
            <line key={i} x1={x} y1={150} x2={x - 8} y2={190} style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </g>
      </svg>
    );
  }
  if (kind === 'rain' || kind === 'snow') {
    const col = kind === 'snow' ? '#ffffff' : '#bfe0f5';
    return (
      <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g className="art-cloud"><ellipse cx="200" cy="70" rx="140" ry="42" fill={night ? '#1d2f4d' : '#e8f1f8'} opacity="0.92" />
          <ellipse cx="110" cy="92" rx="70" ry="28" fill={night ? '#243b5e' : '#d5e5f2'} opacity="0.9" /></g>
        <g className="art-rain" stroke={col} strokeWidth="5" strokeLinecap="round">
          {Array.from({ length: 9 }).map((_, i) => (
            <line key={i} x1={60 + i * 36} y1={120} x2={52 + i * 36} y2={165}
              style={{ animationDelay: `${(i % 4) * 0.25}s` }} opacity="0.85" />
          ))}
        </g>
      </svg>
    );
  }
  if (kind === 'fog') {
    return (
      <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {[70, 120, 170, 215].map((y, i) => (
          <rect key={i} x={40 + (i % 2) * 30} y={y} width={280 - (i % 2) * 40} height="16" rx="8"
            fill="#ffffff" opacity={0.28 - i * 0.04} className={i % 2 ? 'art-cloud slow' : 'art-cloud'} />
        ))}
      </svg>
    );
  }
  // cloudy (default)
  return (
    <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g className="art-cloud"><ellipse cx="150" cy="90" rx="110" ry="38" fill={night ? '#22304f' : '#ffffff'} opacity="0.85" /></g>
      <g className="art-cloud slow"><ellipse cx="300" cy="150" rx="120" ry="36" fill={night ? '#2b3c60' : '#f2f7fc'} opacity="0.7" /></g>
      <g className="art-cloud"><ellipse cx="90" cy="200" rx="90" ry="26" fill={night ? '#1a2540' : '#e6eef7'} opacity="0.6" /></g>
    </svg>
  );
}

/* ---------------- SkyHero ---------------- */
export function SkyHero({ condition, temp, observedAt, source, locationName, children }) {
  const hour = (() => { try { return new Date(observedAt).getHours(); } catch { return new Date().getHours(); } })();
  const night = !(hour >= 6 && hour < 18);
  const theme = skyTheme(condition, hour);
  return (
    <section className={`sky sky-${theme}`} aria-label={t('rightNow')}>
      <div className="sky-art"><ConditionArt condition={condition} night={night} /></div>
      <div className="sky-body">
        <span className="sky-kicker"><I.pin />{locationName}</span>
        <div className="temp-display" aria-live="polite"><CountUp value={temp} /></div>
        <div className="sky-cond">{condition || '–'}</div>
        <span className="sky-src"><I.db />{tp('basedOn', { s: source || '–' })}</span>
        {children}
      </div>
    </section>
  );
}

/* ---------------- Small primitives ---------------- */
export function GlassStat({ icon, label, value }) {
  const Icon = icon;
  return (
    <div className="glass-stat">
      <span className="gs-label"><Icon />{label}</span>
      <span className="gs-value">{value}</span>
    </div>
  );
}

export function SourceChip({ source }) {
  if (!source) return null;
  return <span className="sky-src"><I.db />{tp('basedOn', { s: source })}</span>;
}

export function SevBadge({ severity }) {
  const m = severityMeta(severity);
  const Icon = m.tone === 'bad' ? I.alertTri : m.tone === 'warn' ? I.alertTri : m.tone === 'ok' ? I.check : I.info;
  return <span className={`pill ${m.tone}`}><Icon />{t(m.key)}</span>;
}

export function StatusPill({ status }) {
  const m = sourceStatusMeta(status);
  const Icon = m.tone === 'ok' ? I.check : m.tone === 'warn' ? I.clock : m.tone === 'bad' ? I.x : m.tone === 'info' ? I.bolt : I.info;
  return <span className={`pill ${m.tone}`}><Icon />{t(m.key)}</span>;
}

export function ProofLine({ at }) {
  const parts = agoParts(at);
  const when = parts ? tp(parts.key, parts.params) : '';
  return (
    <span className="proof"><I.check />{tp('proofChecked', { t: when })}</span>
  );
}

export function Skeleton({ kind = 'card' }) {
  if (kind === 'hero') return <div className="skel hero" role="status" aria-label={t('loading')} />;
  if (kind === 'lines') return (
    <div className="card" role="status" aria-label={t('loading')}>
      <div className="skel line w60" style={{ marginBottom: 10 }} />
      <div className="skel line" style={{ marginBottom: 10 }} />
      <div className="skel line w80" />
    </div>
  );
  return <div className="skel card" role="status" aria-label={t('loading')} />;
}

export function SectionHead({ title, sub, action }) {
  return (
    <div className="section-head">
      <div><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, sub, action }) {
  const Icon = icon || I.info;
  return (
    <div className="empty">
      <span className="em-icon"><Icon /></span>
      <h3>{title}</h3>
      {sub ? <p>{sub}</p> : null}
      {action}
    </div>
  );
}

/* ---------------- Toasts ---------------- */
let toastPush = null;
export function toast(msg, tone = 'ok') {
  if (toastPush) toastPush(msg, tone);
}
export function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    toastPush = (msg, tone) => {
      const id = Math.random().toString(36).slice(2);
      setItems((xs) => [...xs, { id, msg, tone }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3200);
    };
    return () => { toastPush = null; };
  }, []);
  const Icon = { ok: I.check, warn: I.alertTri, bad: I.x } ;
  return (
    <div className="toast-wrap" aria-live="polite">
      {items.map((x) => {
        const Ic = Icon[x.tone] || I.info;
        return <div key={x.id} className={`toast ${x.tone}`}><Ic />{x.msg}</div>;
      })}
    </div>
  );
}

/* ---------------- Sheet (bottom sheet) ---------------- */
export function Sheet({ title, sub, onClose, children, label }) {
  useEscape(onClose);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label || title}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('close')}><I.x /></button>
        </div>
        {sub ? <p className="sh-sub">{sub}</p> : null}
        {children}
      </div>
    </>
  );
}

/* ---------------- TopBar ---------------- */
export function TopBar({ locName, statusTone, unread, onLocation, onBell, lang, onLang }) {
  return (
    <header className="topbar">
      <span className="brand"><span className="brand-mark">S</span><span className="brand-name">{t('appName')}</span></span>
      <button className="loc-btn" onClick={onLocation} aria-label={t('changeLocation')}>
        <I.pin /><span className="loc-name">{locName}</span><I.chevD />
      </button>
      <span className="topbar-spacer" />
      <span className={`dot ${statusTone}`} role="img" aria-label={t(statusTone === 'ok' ? 'stLive' : 'stError')} />
      <button className="icon-btn" onClick={onBell} aria-label={t('notifications')}>
        <I.bell />
        {unread > 0 ? <span className="badge-count">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      <div className="lang-seg" role="group" aria-label={t('language')}>
        {[['en', 'EN'], ['hi', 'हिं'], ['te', 'తె']].map(([code, label]) => (
          <button key={code} aria-pressed={lang === code} onClick={() => onLang(code)} lang={code}>{label}</button>
        ))}
      </div>
    </header>
  );
}

/* ---------------- BottomNav ---------------- */
const NAV = [
  ['home', 'navHome', I.home],
  ['alerts', 'navAlerts', I.bell],
  ['advice', 'navAdvice', I.spark],
  ['chat', 'navChat', I.chat],
  ['more', 'navMore', I.dots],
];
export function BottomNav({ view, onNav }) {
  return (
    <nav className="bottomnav" aria-label={t('appName')}>
      {NAV.map(([id, key, Icon]) => (
        <button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => onNav(id)}>
          <span className="nav-pill"><Icon /></span>
          {t(key)}
        </button>
      ))}
    </nav>
  );
}

/* ---------------- SosFab ---------------- */
export function SosFab({ onClick }) {
  return (
    <button className="sos-fab" onClick={onClick} aria-label={t('sos')}>
      <I.phone />{t('sos')}
    </button>
  );
}

/* ---------------- RoleGrid ---------------- */
const ROLE_ORDER = ['general', 'farmer', 'driver', 'fisherman', 'aviation', 'commuter', 'office'];
export function RoleGrid({ value, onPick }) {
  return (
    <div className="role-grid" role="group" aria-label={t('pickRole')}>
      {ROLE_ORDER.map((r) => {
        const Icon = ROLE_ICONS[r] || I.user;
        const active = value === r;
        return (
          <button key={r} className="role-card" aria-pressed={active} onClick={() => onPick(r)}>
            <span className="rc-icon"><Icon /></span>
            <span style={{ minWidth: 0 }}>
              <span className="rc-name">{t(`role_${r}`)}</span><br />
              <span className="rc-desc">{t(`role_${r}_d`)}</span>
            </span>
            {active ? <I.check style={{ marginLeft: 'auto', color: 'var(--accent)', flex: 'none' }} /> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- ForecastRail ---------------- */
export function ForecastRail({ days, lang }) {
  if (!days || !days.length) return null;
  return (
    <div className="rail" role="list" aria-label={t('forecast')}>
      {days.slice(0, 7).map((d) => (
        <div className="rail-cell day-cell" role="listitem" key={d.date}>
          <span className="dc-day">{weekdayLabel(d.date, lang)}</span>
          <MiniArt condition={d.condition} />
          <span className="dc-t">{fmtTemp(d.max_temperature)} <small>{fmtTemp(d.min_temperature)}</small></span>
          {Number(d.rain_chance) > 0 ? <span className="dc-rain">{tp('rainChance', { n: Math.round(d.rain_chance) })}</span> : <span className="dc-rain"> </span>}
        </div>
      ))}
    </div>
  );
}

function MiniArt({ condition }) {
  const kind = conditionKind(condition);
  const map = { clear: I.sun, rain: I.rain, storm: I.bolt, cloudy: I.cloud, fog: I.fog, snow: I.snow };
  const Icon = map[kind] || I.sun;
  const color = { clear: '#ffd968', rain: '#7cc4f2', storm: '#fde047', cloudy: '#c8d6e8', fog: '#aeb9c9', snow: '#eaf4ff' }[kind];
  return <Icon style={{ color }} />;
}


/* ---------------- AlertCard ---------------- */
export function AlertCard({ alert, lang, open, onToggle }) {
  const n = normalizeAlert(alert);
  const m = severityMeta(n.severity);
  const title = n.title || t('untitled');
  return (
    <article className="card alert-card" aria-expanded={open}>
      <div className={`sev-strip ${m.tone}`} />
      <div className="ac-head">
        <span className={`as-icon ${m.tone}`} style={{ width: 46, height: 46 }}>
          {m.tone === 'bad' || m.tone === 'warn' ? <I.alertTri /> : <I.shield />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{title}</h3>
          <div className="adv-meta" style={{ marginTop: 6 }}>
            <SevBadge severity={n.severity} />
            {n.official ? <span className="pill info"><I.shield />{t('official')}</span> : null}
            {n.nearby ? <span className="pill muted">{t('nearby')}</span> : null}
          </div>
        </div>
      </div>
      <dl className="ac-meta">
        {n.issuedAt ? <div><dt>{t('issued')}</dt><dd>{fmtDateTime(n.issuedAt, lang)}</dd></div> : null}
        {n.endsAt ? <div><dt>{t('expires')}</dt><dd>{fmtDateTime(n.endsAt, lang)}</dd></div> : null}
        {n.area ? <div><dt>{t('area')}</dt><dd>{n.area}</dd></div> : null}
        {n.sender ? <div><dt>{t('issuedBy')}</dt><dd>{n.sender}</dd></div> : null}
      </dl>
      {n.instruction ? (
        <div className="ac-inst"><strong>{t('instruction')}</strong>{n.instruction}</div>
      ) : null}
      {open && n.body && n.body !== n.instruction ? <p style={{ color: 'var(--ink2)' }}>{n.body}</p> : null}
      {open ? <p className="sr-time">ID: {n.id}</p> : null}
      <button className="link-btn" onClick={onToggle} aria-expanded={open}>
        {open ? t('close') : t('tapRead')} <I.chevR />
      </button>
    </article>
  );
}

function fmtDateTime(iso, lang) {
  try {
    const loc = lang === 'hi' ? 'hi-IN' : lang === 'te' ? 'te-IN' : 'en-IN';
    return new Date(iso).toLocaleString(loc, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}
