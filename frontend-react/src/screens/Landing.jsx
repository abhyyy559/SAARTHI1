// Opening screen: full-bleed video, pill nav, dot-matrix headline, glowing
// call to action, and four live numbers. Every number and source name comes
// from /api/stats; nothing on this screen is a marketing figure.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { keys, useApp } from '../lib/appState';
import { useData } from '../lib/useData';
import { LANGS, ago, t } from '../lib/i18n';
import { Icon } from '../components/Icons';

const VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4';

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// The video costs megabytes. Skip it on Data Saver, 2G, offline, and for
// reduced motion; the black backdrop underneath is the designed fallback.
function videoAllowed() {
  try {
    if (!navigator.onLine || prefersReducedMotion()) return false;
    const c = navigator.connection;
    if (c && (c.saveData || /2g$/.test(c.effectiveType || ''))) return false;
  } catch { /* unknown browser: allow */ }
  return true;
}

const easeOutCubic = (x) => 1 - (1 - x) ** 3;

export const NAV = [
  { id: 'home', key: 'navHome', icon: 'home' },
  { id: 'today', key: 'tabToday', icon: 'partly' },
  { id: 'ask', key: 'tabAsk', icon: 'mic' },
  { id: 'alerts', key: 'tabAlerts', icon: 'bell' },
  { id: 'map', key: 'tabMap', icon: 'globe' },
  { id: 'share', key: 'tabShare', icon: 'qr' },
];

function StatsRow({ stats, lang }) {
  const root = useRef(null);
  const valueEls = useRef([]);
  const [visible, setVisible] = useState(false);
  const items = [
    { glyph: '!', value: stats?.official_alerts_in_force, label: 'statAlerts' },
    { glyph: '#', value: stats?.districts_covered, label: 'statDistricts' },
    { glyph: '*', value: stats?.languages?.length, label: 'statLangs' },
    { glyph: '<', value: stats?.alert_check_minutes, label: 'statCheck', suffix: t(lang, 'minUnit') },
  ];
  const targets = items.map((i) => (i.value == null ? 'x' : String(i.value))).join('|');

  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Count up once the row is on screen and the numbers are known.
  useEffect(() => {
    if (!visible) return undefined;
    const frames = [];
    targets.split('|').forEach((raw, i) => {
      const el = valueEls.current[i];
      if (!el) return;
      if (raw === 'x') { el.textContent = '–'; return; }
      const target = Number(raw);
      if (prefersReducedMotion()) { el.textContent = String(target); return; }
      const start = performance.now() + 480 + i * 90;
      const duration = 1500 + i * 80;
      const step = (now) => {
        const p = Math.min(1, Math.max(0, (now - start) / duration));
        el.textContent = String(Math.round(target * easeOutCubic(p)));
        if (p < 1) frames[i] = requestAnimationFrame(step);
      };
      frames[i] = requestAnimationFrame(step);
    });
    return () => frames.forEach((id) => cancelAnimationFrame(id));
  }, [visible, targets]);

  return (
    <section className="stats-row" ref={root}>
      {items.map((it, i) => (
        <div key={it.label} className="stat-item anim" style={{ '--d': `${0.5 + i * 0.08}s` }}>
          <span className="stat-glyph" aria-hidden="true">{it.glyph}</span>
          <span className="stat-value">
            <span ref={(el) => { valueEls.current[i] = el; }}>{it.value == null ? '–' : '0'}</span>{it.value == null ? '' : it.suffix}
          </span>
          <span className="stat-label">{t(lang, it.label)}</span>
        </div>
      ))}
    </section>
  );
}

function LangSheet({ onClose }) {
  const { lang, setLang } = useApp();
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={t(lang, 'language')} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2><Icon name="globe" size={22} /> {t(lang, 'language')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'close')}><Icon name="close" size={24} /></button>
        </div>
        <div className="pick-langs">
          {LANGS.map((l) => (
            <button key={l.id} type="button" className={`pick-lang ${lang === l.id ? 'is-on' : ''}`}
              onClick={() => { setLang(l.id); onClose(); }}>
              <span className="glyph">{l.glyph}</span><span>{l.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Landing({ ready, onStart, onNav }) {
  const { lang } = useApp();
  const stats = useData(keys.stats, () => api.stats(), { refreshMs: 5 * 60 * 1000 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [showVideo] = useState(videoAllowed);
  const video = useRef(null);
  // React sets `muted` as a property, not an attribute; autoplay rules
  // (notably iOS Safari) look for the attribute, so the video sat paused.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = true;
    v.setAttribute('muted', '');
    const p = v.play();
    if (p && p.catch) p.catch(() => { /* blocked: the black backdrop stays */ });
  }, []);
  const glyph = (LANGS.find((l) => l.id === lang) || LANGS[0]).glyph;
  const langName = (LANGS.find((l) => l.id === lang) || LANGS[0]).name;

  // Mobile menu: Escape and a wide window close it; the page must not scroll under it.
  useEffect(() => {
    if (!menuOpen) return undefined;
    document.body.classList.add('menu-open');
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    const onResize = () => { if (window.innerWidth > 720) setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.classList.remove('menu-open');
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [menuOpen]);

  const go = (id) => { setMenuOpen(false); if (id !== 'home') onNav(id); };
  const live = (stats.data?.sources || []).filter((s) => s.live).map((s) => s.name);
  // A saved copy (offline) says so, with its age: never "Live" from memory.
  const trust = stats.data ? (!live.length ? t(lang, 'trustNone')
    : stats.source === 'saved' ? t(lang, 'trustSaved', { age: ago(stats.savedAt, lang), list: live.join(' · ') })
      : t(lang, 'trustLive', { list: live.join(' · ') }))
    : t(lang, stats.loading ? 'loading' : 'trustNone');

  return (
    <div className="landing">
      <div className="bg" aria-hidden="true">
        {showVideo ? (
          <video ref={video} className="bg-video" autoPlay muted loop playsInline preload="auto">
            <source src={VIDEO_SRC} type="video/mp4" />
          </video>
        ) : null}
        <div className="bg-scrim" />
      </div>

      <div className="page">
        <header className="land-header">
          <button type="button" className="logo" aria-label="WeatherGPT" onClick={() => window.scrollTo(0, 0)}>
            <Icon name="partly" size={52} />
          </button>
          <nav className="nav-pill" aria-label="WeatherGPT">
            {NAV.map((n) => (
              <button key={n.id} type="button" className={`nav-link ${n.id === 'home' ? 'is-active' : ''}`}
                aria-current={n.id === 'home' ? 'page' : undefined} onClick={() => go(n.id)}>
                {t(lang, n.key)}
              </button>
            ))}
          </nav>
          <button type="button" className="lang-pill" onClick={() => setLangOpen(true)} aria-label={t(lang, 'language')}>
            <span className="lang-glyph">{glyph}</span> {langName}
          </button>
          <button type="button" className={`burger ${menuOpen ? 'is-open' : ''}`} aria-expanded={menuOpen}
            aria-controls="land-menu" aria-label={t(lang, menuOpen ? 'close' : 'menu')} onClick={() => setMenuOpen((v) => !v)}>
            <i /><i /><i />
          </button>
        </header>

        <main className="hero">
          <div className="trust anim" style={{ '--d': '0.05s' }}>
            <span className="trust-avatar a1"><span><Icon name="bell" size={16} /></span></span>
            <span className="trust-avatar a2"><span><Icon name="pin" size={16} /></span></span>
            <span className="trust-avatar a3"><span><Icon name="check" size={16} /></span></span>
            <span className="trust-pill">{trust}</span>
          </div>
          <h1 className="headline anim-none">
            <span className="line l1">{t(lang, 'landHead1')}</span>
            <span className="line l2">{t(lang, 'landHead2')}</span>
          </h1>
          <p className="subhead anim" style={{ '--d': '0.28s' }}>{t(lang, 'landSub')}</p>
          <button type="button" className="cta anim-pulse" style={{ '--d': '0.4s' }} onClick={onStart}>
            {t(lang, ready ? 'openToday' : 'getStarted')}
          </button>
        </main>

        <StatsRow stats={stats.data} lang={lang} />
      </div>

      {menuOpen ? (
        <>
          <div className="menu-overlay" onClick={() => setMenuOpen(false)} />
          <div className="menu-sheet" id="land-menu" role="dialog" aria-modal="true" aria-label={t(lang, 'menu')}>
            {NAV.map((n, i) => (
              <button key={n.id} type="button" className={`menu-link ${n.id === 'home' ? 'is-active' : ''}`}
                style={{ '--i': i }} onClick={() => go(n.id)}>
                <Icon name={n.icon} size={26} /> <span className="menu-label">{t(lang, n.key)}</span>
              </button>
            ))}
            <button type="button" className="menu-lang" style={{ '--i': NAV.length }}
              onClick={() => { setMenuOpen(false); setLangOpen(true); }}>
              <span className="lang-glyph">{glyph}</span> {langName}
            </button>
          </div>
        </>
      ) : null}
      {langOpen ? <LangSheet onClose={() => setLangOpen(false)} /> : null}
    </div>
  );
}
