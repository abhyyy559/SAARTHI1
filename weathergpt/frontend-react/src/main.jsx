import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import 'leaflet/dist/leaflet.css'
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
