// Install prompt: engagement-heuristic bottom sheet, iOS hint variant.
// Never on first load, never twice a session, 7-day dismissal respect.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';

const DISMISS_KEY = 'wgpt-install-dismissed';
const WEEK_MS = 7 * 24 * 3600 * 1000;

export default function InstallPrompt() {
  const { lang } = useApp();
  const [visible, setVisible] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [ios] = useState(() => /iPad|iPhone|iPod/.test(navigator.userAgent || '') && !window.MSStream);
  const deferred = useRef(null);
  const shown = useRef(false);

  useEffect(() => {
    let dead = false;
    try {
      const d = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (d && Date.now() - d < WEEK_MS) return undefined;
    } catch { /* ignore */ }
    const onBIP = (e) => {
      e.preventDefault();
      deferred.current = e;
      if (!dead) setCanInstall(true);
      maybeShow();
    };
    const maybeShow = () => {
      if (dead || shown.current) return;
      shown.current = true;
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onBIP);
    // Engagement heuristic: 3 answered queries or 60s of interaction.
    const t0 = Date.now();
    const id = setInterval(() => {
      if (dead) return;
      let n = 0;
      try { n = Number(localStorage.getItem('wgpt-queries') || 0); } catch { /* ignore */ }
      if (n >= 3 || Date.now() - t0 > 60000) {
        clearInterval(id);
        maybeShow();
      }
    }, 5000);
    return () => { dead = true; clearInterval(id); window.removeEventListener('beforeinstallprompt', onBIP); };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setVisible(false);
  };
  const install = async () => {
    if (deferred.current) {
      try { await deferred.current.prompt(); } catch { /* ignore */ }
      dismiss();
    }
  };

  return (
    <div role="dialog" aria-label={t(lang, 'installTitle')} style={{
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-2)', color: 'var(--ink)', border: '1px solid var(--line)',
      borderRadius: 16, padding: '14px 16px', zIndex: 300, boxShadow: 'var(--shadow)',
      maxWidth: 'min(420px, calc(100vw - 32px))',
    }}>
      <div style={{ fontWeight: 800, marginBottom: 4 }}>{t(lang, 'installTitle')}</div>
      <div className="sub" style={{ marginBottom: 6 }}>
        {ios && !canInstall ? t(lang, 'iosHint') : t(lang, 'installBody')}
      </div>
      <div className="row" style={{ display: 'flex', gap: 8 }}>
        {canInstall && !ios && (
          <button type="button" className="btn" onClick={install}>{t(lang, 'installGo')}</button>
        )}
        <button type="button" className="btn ghost" onClick={dismiss}>{t(lang, 'installLater')}</button>
      </div>
    </div>
  );
}
