import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { cache } from '../lib/cache';
import { keys, useApp } from '../lib/appState';
import { makeShareLink } from '../lib/share';
import { activeAlerts } from '../lib/weather';
import { fmtDateTime, t } from '../lib/i18n';
import { Icon } from '../components/Icons';

export function publicBase() {
  return (import.meta.env?.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, '');
}
const isLocal = (url) => /\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url);

// Everything comes from the phone's saved copies, so a code can be made
// with no network: one phone with data can pass it to many without.
export function snapshotInput({ lang, persona, loc }) {
  const warn = cache.read(keys.warnings(loc));
  if (!warn?.data?.verdict) return null;
  const now = cache.read(keys.current(loc));
  const fc = cache.read(keys.forecast(loc));
  const adv = cache.read(keys.advisory(loc, persona, lang));
  const w = warn.data;
  return {
    lang, persona,
    loc: { district: loc.district, state: loc.state, lat: loc.lat, lon: loc.lon },
    savedAt: warn.savedAt,
    verdict: w.verdict,
    current: now?.data?.current || null,
    days: fc?.data?.forecast?.days || [],
    alerts: [...activeAlerts(w.cap_alerts), ...activeAlerts(w.nearby_alerts)],
    advisory: adv?.data?.advisory || '',
  };
}

export default function Share() {
  const app = useApp();
  const { lang, loc } = app;
  const [link, setLink] = useState('');
  const [qr, setQr] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const input = snapshotInput(app);
    if (!input) { setLink(''); setQr(''); return undefined; }
    setSavedAt(input.savedAt);
    (async () => {
      const l = await makeShareLink(publicBase(), input);
      const img = await QRCode.toDataURL(l, { errorCorrectionLevel: 'L', margin: 2, width: 720, color: { dark: '#10151F', light: '#FFFFFF' } });
      if (alive) { setLink(l); setQr(img); }
    })();
    return () => { alive = false; };
  }, [app.lang, app.persona, app.loc.district]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!link) {
    return (
      <div className="screen">
        <div className="empty"><Icon name="qr" size={40} /><p>{t(lang, 'shareEmpty')}</p></div>
      </div>
    );
  }

  const send = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: `WeatherGPT · ${loc.district}`, url: link }); return; }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* user cancelled */ }
  };

  return (
    <div className="screen share">
      <h1 className="share-title"><Icon name="qr" size={28} /> {t(lang, 'shareTitle')}</h1>
      <div className="qr-frame" data-link={link}>
        <img src={qr} alt={`QR · ${loc.district}`} width="300" height="300" />
        <p className="qr-caption"><Icon name="pin" size={16} /> {loc.district} · {fmtDateTime(savedAt, lang)}</p>
      </div>
      <p className="share-hint"><Icon name="info" size={16} /> {t(lang, 'shareHint')}</p>
      {isLocal(link) ? <p className="warn-note">{t(lang, 'shareLocal')}</p> : null}
      <div className="share-actions">
        <button type="button" className="btn-big" onClick={send}>
          <Icon name={copied ? 'check' : 'share'} size={24} /> {t(lang, 'shareSend')}
        </button>
        <a className="btn-big btn-light" href={qr} download={`weathergpt-${loc.district}.png`}>
          <Icon name="download" size={24} /> {t(lang, 'shareSave')}
        </a>
      </div>
    </div>
  );
}
