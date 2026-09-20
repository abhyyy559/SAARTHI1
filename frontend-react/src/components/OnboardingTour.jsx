// Spotlight onboarding: points AT the real button, not a popup about it.
// Each step navigates to a view, highlights one element with a cutout ring,
// and shows an icon-led card beside it. Built for low-literacy users:
// icons carry meaning, text stays one line + one short sentence.
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';

const SEEN_KEY = 'wgpt-onboarded';

const STEPS = [
  { view: 'home', sel: null, icon: 'check', title: 'obt1t', body: 'obt1b' },
  { view: 'home', sel: '[data-tour="mic"]', icon: 'mic', title: 'obt2t', body: 'obt2b' },
  { view: 'home', sel: '[data-tour="verdict"]', icon: 'shield', title: 'obt3t', body: 'obt3b' },
  { view: 'home', sel: '[data-tour="persona-top"]', icon: 'person', title: 'obt4t', body: 'obt4b' },
  { view: 'ask', sel: '[data-tour="chatbox"]', icon: 'chat', title: 'obt5t', body: 'obt5b' },
  { view: 'ask', sel: '[data-tour="nav-alerts"]', icon: 'bell', title: 'obt6t', body: 'obt6b' },
];

const ICONS = {
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 12.5l2.5 2.5L16 9.5" /></svg>,
  mic: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v3" /></svg>,
  shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L4 12l8 10 8-10-8-10z" /></svg>,
  person: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></svg>,
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" /></svg>,
  bell: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>,
};

export default function OnboardingTour() {
  const { lang, setView } = useApp();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const stepRef = useRef(0);
  const dialogRef = useRef(null);

  const measure = useCallback((sel) => {
    if (!sel) {
      setRect(null);
      return;
    }
    const el = document.querySelector(sel);
    if (!el) {
      setRect(null);
      return;
    }
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
    // Measure after scroll settles so the ring lands on the element.
    setTimeout(() => {
      if (stepRef.current !== STEPS.findIndex((s) => s.sel === sel)) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }, 450);
  }, []);

  const goStep = useCallback((i) => {
    const s = STEPS[Math.max(0, Math.min(STEPS.length - 1, i))];
    stepRef.current = STEPS.indexOf(s);
    setStep(STEPS.indexOf(s));
    setView(s.view);
    setRect(null);
    setActive(true);
    measure(s.sel);
  }, [setView, measure]);

  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { seen = true; }
    const replay = () => goStep(0);
    window.addEventListener('wgpt:tour', replay);
    let tId = null;
    if (!seen) tId = setTimeout(() => goStep(0), 900);
    const onResize = () => {
      const s = STEPS[stepRef.current];
      if (s && s.sel) measure(s.sel);
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (tId) clearTimeout(tId);
      window.removeEventListener('wgpt:tour', replay);
      window.removeEventListener('resize', onResize);
    };
  }, [goStep, measure]);

  const close = useCallback((done) => {
    setActive(false);
    if (done) {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    }
  }, []);

  // Escape closes the tour. It is a modal dialog, and a desktop user who opens
  // it by accident (or by pressing the sidebar button) must not have to hunt for
  // the Skip control. Treated like Skip rather than like a stray backdrop click:
  // Escape is deliberate, so it counts as having seen the tour. It stays
  // re-openable from "Take the tour", so nothing is lost.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, close]);

  // Move focus into the dialog when it opens, so the tour is keyboard-reachable
  // and a screen reader announces it.
  useEffect(() => {
    if (active) dialogRef.current?.focus();
  }, [active, step]);

  if (!active) return null;
  const s = STEPS[step];
  const pad = 8;
  const tipTop = rect ? rect.top + rect.height + 12 : null;
  const flip = tipTop != null && tipTop > window.innerHeight - 220;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400 }}>
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.62)' }}
        onClick={() => close(false)}
      />
      {rect && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            top: Math.max(4, rect.top - pad),
            left: Math.max(4, rect.left - pad),
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            border: '3px solid var(--accent)',
            borderRadius: 16,
            boxShadow: '0 0 0 9999px rgba(0,0,0,.62), 0 0 32px var(--accent)',
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        ref={dialogRef}
        role="dialog" aria-modal="true" aria-label={t(lang, s.title)} tabIndex={-1}
        className="card"
        style={{
          position: 'fixed',
          left: '50%', transform: 'translateX(-50%)',
          top: rect ? (flip ? Math.max(8, rect.top - 218) : Math.min(window.innerHeight - 218, rect.top + rect.height + 12)) : 'auto',
          bottom: rect ? undefined : 24,
          width: 'min(400px, calc(100vw - 32px))',
          maxHeight: 210,
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ width: 30, height: 30, color: 'var(--accent)', flexShrink: 0 }}>{ICONS[s.icon]}</span>
          <b>{t(lang, s.title)}</b>
          <span className="mono" style={{ marginLeft: 'auto' }}>{step + 1}/{STEPS.length}</span>
        </div>
        <p className="sub" style={{ marginBottom: 12 }}>{t(lang, s.body)}</p>
        <div className="row" style={{ display: 'flex', gap: 8 }}>
          {step > 0 && (
            <button type="button" className="btn ghost" onClick={() => goStep(step - 1)}>{t(lang, 'obBack')}</button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={() => close(true)}>{t(lang, 'obSkip')}</button>
          <button type="button" className="btn" onClick={() => (step < STEPS.length - 1 ? goStep(step + 1) : (close(true), setView('home')))}>
            {t(lang, 'obNext')}
          </button>
        </div>
      </div>
    </div>
  );
}
