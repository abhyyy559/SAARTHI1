// "SOS nearby" popup: shown the moment an SOS from another phone reaches this
// one while the app is open. (When the app is closed, the Android
// notification does the same job.) A modal card with a scrim, so it never
// sits on top of something the person is still trying to tap.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import { ago, bearingDeg, compass8, formatDistance, haversineKm, parsePayload, VERY_CLOSE_KM } from '../mesh/meshLogic';
import { clearIncoming, currentPosition, useMesh } from '../mesh/meshClient';
import { needIcon, needWord } from './Nearby';

export default function IncomingSos() {
  const { lang, setView } = useApp();
  const { incoming } = useMesh();
  const [where, setWhere] = useState('');
  const viewRef = useRef(null);
  const m = incoming && incoming.message;
  const isSos = !!m && m.t === 'sos';
  const p = isSos ? parsePayload(m) : null;

  useEffect(() => {
    if (!isSos) return undefined;
    let alive = true;
    const frame = requestAnimationFrame(() => viewRef.current && viewRef.current.focus());
    if (typeof p.lat === 'number' && typeof p.lon === 'number') {
      currentPosition(4000).then((here) => {
        if (!alive || !here) return;
        const km = haversineKm(here, p);
        const dir = km >= VERY_CLOSE_KM ? compass8(bearingDeg(here, p)) : null;
        setWhere(`${formatDistance(km)}${dir ? ` ${dir}` : ''}`);
      });
    }
    try { if (navigator.vibrate) navigator.vibrate([400, 200, 400]); } catch { /* no vibration */ }
    const onKey = (e) => { if (e.key === 'Escape') clearIncoming(); };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; cancelAnimationFrame(frame); window.removeEventListener('keydown', onKey); setWhere(''); };
    // One popup per arriving message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m && m.id]);

  if (!isSos) return null;
  const hops = Number(m.h) || 0;
  return (
    <>
      <button type="button" className="sos-pop-scrim" aria-label={t(lang, 'meshDismiss')} onClick={clearIncoming} />
      <section className="sos-pop" role="alertdialog" aria-modal="true" aria-labelledby="sos-pop-title">
        <div className="sos-pop-head">
          <Icon name={needIcon(p.need)} size={28} />
          <h2 id="sos-pop-title">{t(lang, 'meshIncomingTitle')}</h2>
        </div>
        <div className="sos-pop-body">
          <b>{needWord(lang, p.need)}{p.name ? ` · ${String(p.name).slice(0, 40)}` : ''}</b>
          {p.note && <span>{String(p.note).slice(0, 140)}</span>}
          <span className="sub">
            {[where, ago(m.ts, lang), hops <= 1 ? t(lang, 'meshDirect') : t(lang, 'meshVia').replace('{n}', String(hops))]
              .filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="sos-pop-actions">
          <button
            ref={viewRef}
            type="button"
            className="btn btn-signal"
            onClick={() => { clearIncoming(); setView('nearby'); }}
          >
            <Icon name="navigate" size={16} /> {t(lang, 'meshView')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={clearIncoming}>{t(lang, 'meshDismiss')}</button>
        </div>
      </section>
    </>
  );
}
