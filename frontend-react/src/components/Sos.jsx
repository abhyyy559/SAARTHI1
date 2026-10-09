// Emergency help. Calls go through the phone's dialler (work with no
// internet); "send my location" goes through the phone's own share/SMS, so
// nothing depends on our server being up. Numbers are India's official
// emergency lines: 112 (all emergencies), 108 (ambulance), 1077 / 1070
// (district / state disaster control rooms).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../lib/appState';
import { t } from '../lib/i18n';
import { Icon } from './Icons';
import { SpeakButton } from './ui';

const LINES = [
  { num: '112', key: 'sosCall112', primary: true },
  { num: '108', key: 'sosCall108' },
  { num: '1077', key: 'sosCall1077' },
  { num: '1070', key: 'sosCall1070' },
];

function currentPosition(fallback) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(fallback); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(fallback),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

function SosSheet({ onClose }) {
  const { lang, loc } = useApp();
  const [sending, setSending] = useState(false);

  const sendLocation = async () => {
    setSending(true);
    const p = await currentPosition({ lat: loc.lat, lon: loc.lon });
    const url = `https://maps.google.com/?q=${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    const text = `${t(lang, 'sosMsg', { url })} (${loc.district})`;
    setSending(false);
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch { /* cancelled: fall back to SMS */ }
    window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
  };

  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={t(lang, 'sosTitle')} onClick={onClose}>
      <div className="sheet sos-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2><span className="sos-dot">SOS</span> {t(lang, 'sosTitle')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'close')}><Icon name="close" size={24} /></button>
        </div>
        <SpeakButton text={t(lang, 'sosSpeak')} lang={lang} id="sos" />
        {LINES.map((l) => (
          <a key={l.num} className={`sos-call ${l.primary ? 'primary' : ''}`} href={`tel:${l.num}`}>
            <Icon name="phone" size={30} />
            <span className="sos-num">{l.num}</span>
            <span className="sos-label">{t(lang, l.key)}</span>
          </a>
        ))}
        <button type="button" className="btn-big" onClick={sendLocation} disabled={sending}>
          <Icon name="pin" size={24} /> {sending ? t(lang, 'locating') : t(lang, 'sosSend')}
        </button>
        <p className="note center"><Icon name="info" size={14} /> {t(lang, 'sosNote')}</p>
      </div>
    </div>
  );
}

export function SosButton() {
  const { lang } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="sos-btn" onClick={() => setOpen(true)} aria-label={t(lang, 'sosTitle')}>SOS</button>
      {open ? createPortal(<SosSheet onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}
