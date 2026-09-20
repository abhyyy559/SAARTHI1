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
  // FIX: the only mic in the app is the Ask dictation button — the old
  // home view + '[data-tour="mic"]' matched nothing, so the ring drew on
  // empty space. The tour now navigates to ask and points at the real mic.
  { view: 'ask', sel: '[data-tour="mic"]', icon: 'mic', title: 'obt2t', body: 'obt2b' },
  { view: 'home', sel: '[data-tour="verdict"]', icon: 'shield', title: 'obt3t', body: 'obt3b' },
  // The "who is asking" step points at the role grid itself — the ten
  // persona cards are the same control on desktop and mobile, so the ring
  // always lands somewhere real.
  { view: 'advisor', sel: '[data-tour="persona-grid"]', icon: 'person', title: 'obt4t', body: 'obt4b' },
  { view: 'ask', sel: '[data-tour="chatbox"]', icon: 'chat', title: 'obt5t', body: 'obt5b' },
  { view: 'ask', sel: '[data-tour="nav-alerts"]', icon: 'bell', title: 'obt6t', body: 'obt6b' },
];

export default function OnboardingTour() {
  const { lang, setView } = useApp();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const stepRef = useRef(0);
  const dialogRef = useRef(null);

  // The tour is closed deliberately (Skip/Escape/finish) or never opened;
  // defined before measure because a skipped step may need to close the tour.
  const close = useCallback((done) => {
    setActive(false);
    if (done) {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    }
  }, []);

  // goStepRef breaks the measure <-> goStep cycle: measure's "skip this step"
  // path advances the tour, which needs goStep, which calls measure.
  const goStepRef = useRef(null);

  const measure = useCallback((sel, stepIdx) => {
    if (!sel) {
      setRect(null);
      return;
    }
    // The new view renders async (alerts/advice fetch), so the target may not
    // exist on the first tick. Poll briefly; if it never appears — e.g. a
    // desktop-only control on mobile — skip the step instead of spotlighting
    // empty space. A zero-size hit (display:none) counts as missing too.
    const SKIP_AFTER_MS = 2500;
    const started = Date.now();
    const skip = () => {
      if (stepIdx >= STEPS.length - 1) close(true);
      else goStepRef.current(stepIdx + 1);
    };
    const tick = () => {
      if (stepRef.current !== stepIdx) return; // user moved on
      const el = document.querySelector(sel);
      if (el) {
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
        // Measure after scroll settles so the ring lands on the element.
        setTimeout(() => {
          if (stepRef.current !== stepIdx) return;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) { skip(); return; }
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }, 450);
        return;
      }
      if (Date.now() - started > SKIP_AFTER_MS) { skip(); return; }
      setTimeout(tick, 200);
    };
    tick();
  }, [close]);

  const goStep = useCallback((i) => {
    const s = STEPS[Math.max(0, Math.min(STEPS.length - 1, i))];
    const idx = STEPS.indexOf(s);
    stepRef.current = idx;
    setStep(idx);
    setView(s.view);
    setRect(null);
    setActive(true);
    measure(s.sel, idx);
  }, [setView, measure]);
  goStepRef.current = goStep;

  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { seen = true; }
    const replay = () => goStepRef.current(0);
    window.addEventListener('wgpt:tour', replay);
    let tId = null;
    // FIX: a deep link (?view=) must win over the first-run auto-start. A push
    // notification that lands on ?view=alerts used to be yanked back to Home
    // 900ms later. Auto-start now stays silent whenever the launch URL names
    // a view; the tour remains re-openable from "Take the tour".
    let deepLinked = false;
    try {
      deepLinked = new URLSearchParams(window.location.search).has('view')
        || window.location.hash.includes('view=');
    } catch { deepLinked = false; }
    if (!seen && !deepLinked) tId = setTimeout(() => goStepRef.current(0), 900);
    const onResize = () => {
      const s = STEPS[stepRef.current];
      if (s && s.sel) measure(s.sel, stepRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (tId) clearTimeout(tId);
      window.removeEventListener('wgpt:tour', replay);
      window.removeEventListener('resize', onResize);
    };
  }, [measure]);

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

  // Black console tooltip, signal-yellow title — reads like the rest of
  // the board. The deep-link guard above is unchanged: a launch URL naming a
  // view always wins over first-run auto-start.
  return (
    <>
      <div className="tour-scrim" onClick={() => close(false)} />
      {rect && (
        <div
          aria-hidden
          className="tour-ring"
          style={{
            top: Math.max(4, rect.top - pad),
            left: Math.max(4, rect.left - pad),
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          }}
        />
      )}
      <div
        ref={dialogRef}
        role="dialog" aria-modal="true" aria-label={t(lang, s.title)} tabIndex={-1}
        className="tour-tip"
        style={{
          left: '50%', transform: 'translateX(-50%)',
          top: rect ? (flip ? Math.max(8, rect.top - 218) : Math.min(window.innerHeight - 218, rect.top + rect.height + 12)) : 'auto',
          bottom: rect ? undefined : 24,
        }}
      >
        <span className="tour-count">{step + 1}/{STEPS.length}</span>
        <div className="display">{t(lang, s.title)}</div>
        <p>{t(lang, s.body)}</p>
        <div className="tour-actions">
          {step > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => goStep(step - 1)}>{t(lang, 'obBack')}</button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={() => close(true)}>{t(lang, 'obSkip')}</button>
          <button type="button" className="btn btn-signal" onClick={() => (step < STEPS.length - 1 ? goStep(step + 1) : (close(true), setView('home')))}>
            {t(lang, 'obNext')}
          </button>
        </div>
      </div>
    </>
  );
}
