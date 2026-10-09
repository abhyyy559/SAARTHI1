// In-app QR scanner for phone-to-phone relay. Decodes camera frames on the
// phone itself (jsQR): no internet, no server, works between two phones that
// are both offline.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import jsQR from 'jsqr';
import { t } from '../lib/i18n';
import { Icon } from './Icons';

export default function Scanner({ lang, onResult, onClose }) {
  const video = useRef(null);
  const done = useRef(onResult);
  const [err, setErr] = useState('');

  useEffect(() => { done.current = onResult; });

  useEffect(() => {
    let stream = null;
    let raf = 0;
    let alive = true;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!alive) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play();
        let last = 0;
        const tick = (ts) => {
          if (!alive) return;
          const v = video.current;
          if (v && v.readyState >= 2 && ts - last > 180) {
            last = ts;
            const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
            if (code && code.data) { alive = false; done.current(code.data); return; }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setErr(e && e.name === 'NotAllowedError' ? 'camDenied' : 'noCam');
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return createPortal(
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={t(lang, 'receive')} onClick={onClose}>
      <div className="sheet scanner" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2><Icon name="qr" size={22} /> {t(lang, 'receive')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'close')}><Icon name="close" size={24} /></button>
        </div>
        {err ? <p className="warn-note">{t(lang, err)}</p> : (
          <div className="scan-box">
            <video ref={video} className="scan-video" playsInline muted />
            <div className="scan-frame" aria-hidden="true" />
          </div>
        )}
        <p className="note center"><Icon name="info" size={14} /> {t(lang, 'scanHint')}</p>
      </div>
    </div>,
    document.body,
  );
}
