// First-run onboarding — the "what is this app and what will it ask me" flow.
//
// On a brand-new browser (no saved state), before anything else, the user gets:
//   1. WELCOME  — what SAARTHI does (verified alerts, ask by voice, offline+P2P).
//   2. LOCATION — why it is asked (warnings are district-specific) and a real
//      permission prompt. The store's requestLocation() is the ONLY path used,
//      so this is the same permission the Home prompt would have asked.
//   3. ALERTS   — why it is asked (reach you while the app is closed) and the
//      real notification+push toggle (store's toggleNotify()).
//   4. DONE     — an honest "what happens on every visit / refresh" line, then
//      it hands over to the spotlight tour (wgpt:tour event).
//
// Rules kept from the rest of the app:
//   - No fake success. A denied permission shows the honest fallback sentence
//     and the flow continues; nothing is claimed to be "on" that is not.
//   - Steps the user already satisfied are skipped (saved location / alerts on).
//   - A deep link (?view=) always wins: onboarding stays silent, exactly like
//     the tour's auto-start guard.
//   - One-time: the wgpt.onboarded flag never makes this reappear; the tour
//     stays replayable from More/Settings.
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

const ONBOARD_KEY = 'wgpt.onboarded';

// Step ids so skip logic reads as intent, not magic numbers.
const STEPS = ['welcome', 'location', 'alerts', 'done'];

export default function FirstRunOnboarding() {
  const { lang, locStatus, requestLocation, notifyOn, toggleNotify } = useApp();
  const [open, setOpen] = useState(() => {
    try {
      if (localStorage.getItem(ONBOARD_KEY) === '1') return false;
      // Same deep-link rule as the tour: a launch URL naming a view wins.
      const deepLinked = new URLSearchParams(window.location.search).has('view')
        || window.location.hash.includes('view=');
      return !deepLinked;
    } catch { return false; }
  });
  const [step, setStep] = useState(0);
  const [ntfNote, setNtfNote] = useState('');
  const [ntfBusy, setNtfBusy] = useState(false);
  const dialogRef = useRef(null);

  const finish = useCallback((startTour) => {
    try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* private mode: ask again next run */ }
    setOpen(false);
    // Hand over to the spotlight tour so the user immediately sees where the
    // controls live. The tour's own auto-start waits for this flag, so this
    // dispatch is the single tour launch for a first run.
    if (startTour) window.dispatchEvent(new Event('wgpt:tour'));
  }, []);

  // The tour auto-start (OnboardingTour.jsx) waits for ONBOARD_KEY — this is
  // the contract that keeps the two first-run flows from ever overlapping.

  // Advance automatically when the location resolves; stay (with the honest
  // note) when it does not. Derived DURING RENDER (not in an effect) so the
  // step transition happens with the commit instead of after it.
  if (open && STEPS[step] === 'location' && locStatus === 'ready') {
    setStep(2);
  }

  // Keyboard: Escape means "not now" — treated as finished so we do not nag.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') finish(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open, step]);

  if (!open) return null;

  const cur = STEPS[step];

  const goNext = () => {
    // Skip steps already satisfied by saved state.
    let next = step + 1;
    if (STEPS[next] === 'location' && locStatus === 'ready') next += 1;
    if (STEPS[next] === 'alerts' && notifyOn) next += 1;
    if (STEPS[next] === 'done') setStep(STEPS.indexOf('done'));
    else setStep(next);
  };

  const allowLocation = () => {
    // Resolution (or an honest failure) is reflected by locStatus from the
    // store; the render-time transition above advances when it turns ready.
    requestLocation();
  };

  const allowAlerts = async () => {
    setNtfBusy(true);
    setNtfNote('');
    try {
      const ok = await toggleNotify();
      if (ok) {
        setNtfNote(t(lang, 'obwNtfOn'));
        setTimeout(() => goNext(), 700);
      } else {
        setNtfNote(t(lang, 'obwNtfDenied'));
      }
    } finally {
      setNtfBusy(false);
    }
  };

  const locPending = locStatus === 'requesting' || locStatus === 'resolving';
  const locFailed = locStatus === 'denied' || locStatus === 'error' || locStatus === 'unsupported';

  return (
    <>
      <div className="obw-scrim" />
      <div
        ref={dialogRef}
        className="obw-card"
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, 'obwTitle')}
        tabIndex={-1}
      >
        <div className="obw-progress" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={`obw-dot${i === step ? ' is-now' : i < step ? ' is-done' : ''}`} />
          ))}
        </div>

        {cur === 'welcome' && (
          <>
            <span className="obw-mark" aria-hidden="true">S</span>
            <h2 className="display">{t(lang, 'obwTitle')}</h2>
            <p className="obw-lead">{t(lang, 'obwLead')}</p>
            <ul className="obw-points">
              <li><Icon name="shield" size={20} aria-hidden="true" /><span><b>{t(lang, 'obwPt1t')}</b> {t(lang, 'obwPt1b')}</span></li>
              <li><Icon name="speaker" size={20} aria-hidden="true" /><span><b>{t(lang, 'obwPt2t')}</b> {t(lang, 'obwPt2b')}</span></li>
              <li><Icon name="offline" size={20} aria-hidden="true" /><span><b>{t(lang, 'obwPt3t')}</b> {t(lang, 'obwPt3b')}</span></li>
            </ul>
            <div className="obw-actions">
              <button type="button" className="btn btn-ghost" onClick={() => finish(true)}>{t(lang, 'obwSkip')}</button>
              <button type="button" className="btn btn-signal" onClick={goNext}>{t(lang, 'obwStart')}</button>
            </div>
          </>
        )}

        {cur === 'location' && (
          <>
            <span className="obw-icon" aria-hidden="true"><Icon name="pin" size={34} /></span>
            <h2 className="display">{t(lang, 'obwLocTitle')}</h2>
            <p className="obw-lead">{t(lang, 'obwLocBody')}</p>
            {locPending && <p className="mono" role="status">{t(lang, locStatus === 'requesting' ? 'locLocating' : 'locResolving')}</p>}
            {locFailed && <p className="obw-note" role="status">{t(lang, 'obwLocDenied')}</p>}
            <div className="obw-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>{t(lang, 'obwSkip')}</button>
              {!locPending && (
                <button type="button" className="btn btn-signal" onClick={allowLocation}>
                  <Icon name="pin" size={17} aria-hidden="true" /> {t(lang, 'obwLocAllow')}
                </button>
              )}
            </div>
          </>
        )}

        {cur === 'alerts' && (
          <>
            <span className="obw-icon" aria-hidden="true"><Icon name="bell" size={34} /></span>
            <h2 className="display">{t(lang, 'obwNtfTitle')}</h2>
            <p className="obw-lead">{t(lang, 'obwNtfBody')}</p>
            {ntfNote && <p className="obw-note" role="status">{ntfNote}</p>}
            <div className="obw-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(3)}>{t(lang, 'obwSkip')}</button>
              <button type="button" className="btn btn-signal" onClick={allowAlerts} disabled={ntfBusy}>
                <Icon name="bell" size={17} aria-hidden="true" /> {t(lang, 'obwNtfAllow')}
              </button>
            </div>
          </>
        )}

        {cur === 'done' && (
          <>
            <span className="obw-icon" aria-hidden="true"><Icon name="check" size={34} /></span>
            <h2 className="display">{t(lang, 'obwDoneTitle')}</h2>
            <p className="obw-lead">{t(lang, 'obwDoneBody')}</p>
            <div className="obw-actions">
              <button type="button" className="btn btn-ghost" onClick={() => finish(false)}>{t(lang, 'obwSkip')}</button>
              <button type="button" className="btn btn-signal" onClick={() => finish(true)}>
                <Icon name="eye" size={17} aria-hidden="true" /> {t(lang, 'obwTour')}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
