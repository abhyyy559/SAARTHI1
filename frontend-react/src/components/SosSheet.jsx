// Floating SOS — the mayday console, reachable from every view.
//
// Abhiram's call (2026-09-23): SOS left the Alerts route. It now floats above
// the whole app: a red FAB (icon + the word SOS, never color alone) in the
// shell opens the full Emergency console in a modal sheet. Everything inside
// the sheet is the untouched Emergency component — arm→send, the picture
// grid, the delivery stepper, the session inbox, the QR relay, and its own
// "SIMULATED — FOR DEMO ONLY" stamp all ride along unchanged.
import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import Emergency from './Emergency';

// Safety-critical, so never hidden: one FAB, every view, bottom-right.
export function SosFab({ onOpen }) {
  const { lang } = useApp();
  return (
    <button
      type="button"
      className="sos-fab"
      aria-label={t(lang, 'sendSosTitle')}
      title={t(lang, 'sendSosTitle')}
      onClick={onOpen}
    >
      <Icon name="sos" size={22} aria-hidden="true" />
      {/* "SOS" is the universal distress word — identical in EN/HI/TE, so no
          new i18n key. The localized "Send SOS" rides on aria-label/title. */}
      <span aria-hidden="true">SOS</span>
    </button>
  );
}

export default function SosSheet({ open, onClose }) {
  const { lang } = useApp();
  const closeRef = useRef(null);
  const openerRef = useRef(null);

  // Focus management + Escape + scroll lock while the sheet is open —
  // the same dialog contract as the notifications panel.
  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement;
    const frame = requestAnimationFrame(() => { if (closeRef.current) closeRef.current.focus(); });
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (openerRef.current && openerRef.current.focus) openerRef.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button type="button" className="sos-scrim" aria-label={t(lang, 'panelClose')} onClick={onClose} />
      <section
        className="sos-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, 'sendSosTitle')}
      >
        <div className="sos-sheet-head">
          <span className="sheet-handle" aria-hidden="true" />
          <button
            ref={closeRef}
            type="button"
            className="btn-icon"
            aria-label={t(lang, 'panelClose')}
            onClick={onClose}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="sos-sheet-body">
          <Emergency />
        </div>
      </section>
    </>
  );
}
