import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { payloadFromHash } from './lib/share';

// A scanned QR code opens /#s=<snapshot>. That page loads on its own, without
// the app, so a phone that never installed WeatherGPT gets it fast.
const App = lazy(() => import('./App.jsx'));
const SharePage = lazy(() => import('./screens/SharePage.jsx'));

// Sunlight mode before first paint, so a light screen never flashes dark.
try {
  if (JSON.parse(localStorage.getItem('wgpt2.pref.theme')) === 'light') document.documentElement.dataset.theme = 'light';
} catch { /* storage blocked */ }

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* app still works online */ });
  });
}

function Root() {
  const payload = payloadFromHash(window.location.hash);
  return (
    <Suspense fallback={<div className="boot" />}>
      {payload ? <SharePage payload={payload} /> : <App />}
    </Suspense>
  );
}

window.addEventListener('hashchange', () => window.location.reload());

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
