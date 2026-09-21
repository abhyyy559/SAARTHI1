// Spotlight onboarding: points AT the real control, not a popup about it.
// Five icon-led steps, one short line each, built for low-literacy users —
// the icon carries the meaning, the text only confirms.
//
// SELECTOR CONTRACTS (Agent 4 / anyone touching IA — read before renaming):
//   1. hero   -> '[data-tour="verdict"]'     on the Home hero (components/HomeHero.jsx).
//   2. chat   -> '[data-tour="home-chat"]'   on the HOME chat composer. This is
//      the contract for the home composer: whoever mounts it MUST carry
//      data-tour="home-chat", or the step skips itself honestly (see below).
//      (The Ask view's composer keeps the older 'chatbox' hook; the tour no
//      longer navigates away from home for the chat step.)
//   3. alerts -> '[data-tour="nav-alerts"]'  on the alerts tab (components/Shell.jsx,
//      rail on desktop + tab bar on mobile — whichever is rendered wins).
//   4. offline -> '[data-tour="conn"]' with '.conn-pill' fallback, the topbar
//      connectivity pill (components/Shell.jsx, always rendered).
//   5. notify -> '[data-tour="notify-bell"]' on the topbar bell (components/Shell.jsx,
//      preferred hook — Shell owner: please add data-tour="notify-bell" to the
//      bell button) with '.bell-btn' fallback, which matches today. Unlike the
//      other steps this one carries its own "Allow notifications" button wired
//      to enableNotify() — the SAME enable flow as the bell — so the permission
//      ask works even before the preferred hook exists. The spotlight only
//      points; the dialog asks.
//
// A step whose selector never appears (missing hook, display:none) is SKIPPED,
// never ringed on empty space. The deep-link guard stands: a launch URL naming
// a view (?view= / #view=) always wins over the first-run auto-start.
// Replay: window.dispatchEvent(new Event('wgpt:tour')) — the More/Settings
// "Take the tour" entry dispatches exactly this.
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

const SEEN_KEY = 'wgpt-onboarded';

const STEPS = [
  { view: 'home', sels: ['[data-tour="verdict"]'], icon: 'sun', title: 'ot1t', body: 'ot1b' },
  { view: 'home', sels: ['[data-tour="home-chat"]'], icon: 'chat', title: 'ot2t', body: 'ot2b' },
  { view: 'home', sels: ['[data-tour="nav-alerts"]'], icon: 'bell', title: 'ot3t', body: 'ot3b' },
  { view: 'home', sels: ['[data-tour="conn"]', '.conn-pill'], icon: 'offline', title: 'ot4t', body: 'ot4b' },
  // Last: the notifications permission ask. Wired to the same enable flow as
  // the bell (enableNotify), retry-safe — tapping it when already enabled is
  // a no-op, never a toggle-off.
  { view: 'home', sels: ['[data-tour="notify-bell"]', '.bell-btn'], icon: 'radio', title: 'ot5t', body: 'ot5b', action: 'notify' },
];

export default function OnboardingTour() {
  const { lang, setView, enableNotify, pushMode } = useApp();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const [ctaBusy, setCtaBusy] = useState(false);
  const stepRef = useRef(0);
  const dialogRef = useRef(null);
  const activeRef = useRef(false);
  // Mirrors `active` for the resize listener below: a viewport resize must
  // only re-measure a tour the user actually started. Without this guard, a
  // resize (phone rotation, window resize, full-page screenshot) while the
  // tour is dormant would run measure() -> skip() -> goStep(), popping the
  // tour open mid-session and yanking the view back to Home.

  // The notifications CTA: the same enable flow as the bell, but retry-safe —
  // it only ever enables, so a tap can never switch alerts back off.
  const onNotifyCta = useCallback(async () => {
    if (ctaBusy || pushMode === 'background') return;
    setCtaBusy(true);
    try { await enableNotify(); } finally { setCtaBusy(false); }
  }, [ctaBusy, pushMode, enableNotify]);

  // Generation counter: close() bumps it, and every pending measure/tick/skip
  // chain captured at start bails the moment the generation changes. Without
  // this, a tick() already queued for a slow/absent target could fire AFTER
  // the user deliberately closed the tour (Escape/Skip/scrim) and call
  // skip() -> goStep(), popping the tour back open at step N+1 and yanking
  // the view to Home — the exact failure the resize guard alone can't stop.
  const genRef = useRef(0);

  // The tour is closed deliberately (Skip/Escape/finish) or never opened;
  // defined before measure because a skipped step may need to close the tour.
  const close = useCallback((done) => {
    genRef.current += 1; // invalidate every in-flight measure chain
    activeRef.current = false;
    stepRef.current = -1;
    setActive(false);
    if (done) {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    }
  }, []);

  // goStepRef breaks the measure <-> goStep cycle: measure's "skip this step"
  // path advances the tour, which needs goStep, which calls measure.
  const goStepRef = useRef(null);

  const measure = useCallback((sels, stepIdx) => {
    const list = Array.isArray(sels) ? sels : [sels];
    if (list.length === 0) {
      setRect(null);
      return;
    }
    // The target may render async (alerts/advice fetch), so poll briefly; if
    // it never appears — e.g. the home composer hook is not mounted yet, or a
    // desktop-only control on mobile — skip the step instead of spotlighting
    // empty space. A zero-size hit (display:none) counts as missing too.
    const SKIP_AFTER_MS = 2500;
    const started = Date.now();
    const gen = genRef.current; // the measure chain this tick belongs to
    const alive = () => genRef.current === gen && stepRef.current === stepIdx;
    const skip = () => {
      if (!alive()) return; // tour moved on or was closed: never advance
      if (stepIdx >= STEPS.length - 1) close(true);
      else goStepRef.current(stepIdx + 1);
    };
    const find = () => {
      for (const sel of list) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    };
    const tick = () => {
      if (!alive()) return; // user moved on, or closed the tour mid-poll
      const el = find();
      if (el) {
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
        // Measure after scroll settles so the ring lands on the element.
        setTimeout(() => {
          if (!alive()) return;
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
    activeRef.current = true;
    setView(s.view);
    setRect(null);
    setActive(true);
    measure(s.sels, idx);
  }, [setView, measure]);
  goStepRef.current = goStep;

  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { seen = true; }
    const replay = () => goStepRef.current(0);
    window.addEventListener('wgpt:tour', replay);
    let tId = null;
    // FIX (kept): a deep link (?view=) must win over the first-run auto-start.
    // A push notification that lands on ?view=alerts used to be yanked back to
    // Home 900ms later. Auto-start stays silent whenever the launch URL names
    // a view; the tour remains re-openable from "Take the tour".
    let deepLinked = false;
    try {
      deepLinked = new URLSearchParams(window.location.search).has('view')
        || window.location.hash.includes('view=');
    } catch { deepLinked = false; }
    if (!seen && !deepLinked) tId = setTimeout(() => goStepRef.current(0), 900);
    const onResize = () => {
      // Never wake a dormant tour: without this, any viewport resize while
      // the tour was never started runs measure() -> skip() -> goStep(),
      // popping the tour open mid-session and yanking the view to Home.
      if (!activeRef.current) return;
      const s = STEPS[stepRef.current];
      if (s && s.sels) measure(s.sels, stepRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (tId) clearTimeout(tId);
      window.removeEventListener('wgpt:tour', replay);
      window.removeEventListener('resize', onResize);
    };
  }, [measure]);

  // Escape closes the tour. It is a modal dialog, and a desktop user who opens
  // it by accident must not have to hunt for the Skip control. Treated like
  // Skip rather than like a stray backdrop click: Escape is deliberate, so it
  // counts as having seen the tour. It stays re-openable from "Take the tour".
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
  const tipTop = rect ? rect.top + rect.height + 12 : null;
  const flip = tipTop != null && tipTop > window.innerHeight - 220;

  // Black console tooltip, signal-yellow title — reads like the rest of
  // the board. The icon leads (low-literacy users read the picture first);
  // the deep-link guard above is unchanged.
  return (
    <>
      <div className="tour-scrim" onClick={() => close(false)} />
      {rect && (
        <div
          aria-hidden
          className="tour-ring"
          style={{
            top: Math.max(4, rect.top - 8),
            left: Math.max(4, rect.left - 8),
            width: rect.width + 16,
            height: rect.height + 16,
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
        <span className="tour-icon" aria-hidden="true"><Icon name={s.icon} size={30} /></span>
        <div className="display">{t(lang, s.title)}</div>
        <p>{t(lang, s.body)}</p>
        {s.action === 'notify' && (
          <button
            type="button"
            className="btn btn-signal"
            style={{ marginTop: 4, alignSelf: 'flex-start' }}
            disabled={ctaBusy || pushMode === 'background'}
            onClick={onNotifyCta}
          >
            {pushMode === 'background' ? t(lang, 'ot5on') : pushMode === 'inapp' ? t(lang, 'ot5inapp') : t(lang, 'ot5cta')}
          </button>
        )}
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
