import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'

// Single light theme: no saved-theme restore needed.

// Service worker (PWA shell): registered only in production builds.
// In `vite dev` this is a no-op by design — never demo the PWA from dev.
// Not in the Android app: its files already ship inside the APK, and a worker
// there would only keep serving the previous version's files after an update.
const insideAndroidApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if ('serviceWorker' in navigator && import.meta.env.PROD && !insideAndroidApp) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline-first is best-effort; the app works without it */
    });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
