// SOS — the mayday console, reachable from every view.
//
// Abhiram's call (2026-09-23): SOS left the Alerts route and is reachable
// from everywhere. It is docked, never floating over the page: the centre
// slot of the mobile bar and the top of the desktop rail (both SosFab).
// Tapping it opens the full Emergency console in a modal sheet — arm→send,
// the picture grid, the delivery stepper, the session inbox and the QR relay.
// Sending now also floods the SOS phone to phone over Bluetooth, and the top
// of the sheet shows the relay and a link to the Nearby SOS screen.
import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import Emergency from './Emergency';
import { RelayStatus, useOpenSosCount } from './Nearby';

// Safety-critical, so never hidden: in the bar on phones, in the rail on desktop.
// The red count says how many people nearby are asking for help right now.
export function SosFab({ onOpen, variant = 'nav', count = 0 }) {
  const { lang } = useApp();
  const label = count > 0
    ? `${t(lang, 'sendSosTitle')} · ${t(lang, 'meshSosCount').replace('{n}', String(count))}`
    : t(lang, 'sendSosTitle');
  return (
    <button
      type="button"
      className={`sos-fab is-${variant}`}
      aria-label={label}
      title={label}
      onClick={onOpen}
    >
      <span className="sos-fab-mark">
        <Icon name="sos" size={variant === 'nav' ? 20 : 22} aria-hidden="true" />
        {/* "SOS" is the universal distress word — identical in EN/HI/TE, so no
            new i18n key. The localized "Send SOS" rides on aria-label/title. */}
        <span aria-hidden="true">SOS</span>
      </span>
      {count > 0 && <span className="sos-fab-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </button>
  );
}

function NearbyLink({ onGo }) {
  const { lang } = useApp();
  const n = useOpenSosCount();
  return (
    <button type="button" className="nearby-link" data-active={n > 0 ? 'yes' : 'no'} onClick={onGo}>
      <Icon name="users" size={20} />
      <span>{n > 0 ? t(lang, 'meshSosCount').replace('{n}', String(n)) : t(lang, 'meshSosNone')}</span>
      <span className="sub">{t(lang, 'meshOpenNearby')}</span>
      <Icon name="chevron" size={18} />
    </button>
  );
}

export default function SosSheet({ open, onClose }) {
  const { lang, setView } = useApp();
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
          <div className="sos-sheet-mesh">
            <RelayStatus compact />
            <NearbyLink onGo={() => { onClose(); setView('nearby'); }} />
          </div>
          <Emergency />
        </div>
      </section>
    </>
  );
}
