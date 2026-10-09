// The spec's full-bleed looping video, behind every screen. Mounted once at
// the root so it keeps playing from the landing into the app. Skipped on Data
// Saver, 2G, offline and reduced motion: the black backdrop is the designed
// fallback, so nothing depends on it. The file is ~14 MB and served with a
// one-year immutable cache, so a phone downloads it once.
import { useEffect, useRef, useState } from 'react';

export const VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4';

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export function videoAllowed() {
  try {
    if (!navigator.onLine || prefersReducedMotion()) return false;
    const c = navigator.connection;
    if (c && (c.saveData || /2g$/.test(c.effectiveType || ''))) return false;
  } catch { /* unknown browser: allow */ }
  return true;
}

const isLight = () => {
  try { return document.documentElement.dataset.theme === 'light'; } catch { return false; }
};

// dim: the app screens get a darker veil than the landing, so cards stay
// readable. Sunlight mode is a light, high-contrast screen, so the app drops
// the video there; the landing keeps its dark look in both modes.
export default function Backdrop({ dim = false }) {
  const [allowed, setAllowed] = useState(videoAllowed);
  const [light, setLight] = useState(isLight);
  const video = useRef(null);
  const hidden = light && dim;
  const play = allowed && !hidden;

  useEffect(() => {
    const mo = new MutationObserver(() => setLight(isLight()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // Opened offline: start once the network is back.
    const onOnline = () => setAllowed(videoAllowed());
    window.addEventListener('online', onOnline);
    return () => { mo.disconnect(); window.removeEventListener('online', onOnline); };
  }, []);

  // React sets `muted` as a property, not an attribute; autoplay rules
  // (notably iOS Safari) look for the attribute.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = true;
    v.setAttribute('muted', '');
    const p = v.play();
    if (p && p.catch) p.catch(() => { /* blocked: black backdrop stays */ });
  }, [play]);

  if (hidden) return null;
  return (
    <div className="bg" aria-hidden="true">
      {play ? (
        <video ref={video} className="bg-video" autoPlay muted loop playsInline preload="auto">
          <source src={VIDEO_SRC} type="video/mp4" />
        </video>
      ) : null}
      <div className={`bg-scrim ${dim ? 'dim' : ''}`} />
    </div>
  );
}
