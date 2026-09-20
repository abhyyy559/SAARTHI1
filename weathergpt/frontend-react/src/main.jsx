import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'

// Apply the saved theme before first paint so there is no flash of the wrong scheme.
try {
  const saved = localStorage.getItem('wgpt.theme')
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved)
  }
} catch {
  /* storage unavailable - fall back to the OS preference via CSS */
}

// Service worker (PWA shell): registered only in production builds.
// In `vite dev` this is a no-op by design — never demo the PWA from dev.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
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
