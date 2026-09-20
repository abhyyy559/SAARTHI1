import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Phase 1 PWA: precache app shell (bucket 1) + bundled i18n (bucket 5).
    // Buckets 2-4 live in the localStorage layer; no SW runtime caching
    // for API responses — the app must never serve a stale API response
    // that the UI didn't explicitly tag.
    //
    // `injectManifest` (not the default `generateSW`) because a push
    // notification has to arrive while the app is closed, and only a service
    // worker can receive one — it needs a `push` handler, which generated
    // workers do not have. Caching is STILL entirely workbox's job:
    // src/sw.js calls precacheAndRoute(self.__WB_MANIFEST) and decides nothing
    // about what to cache. The old "never hand-write the SW" rule is about
    // caching, and that rule is intact.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  // Dev-server preview: /api and /ws are proxied to the FastAPI backend.
  // (The production build is served by FastAPI itself - no proxy needed there.)
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8003',
      '/ws': { target: 'ws://127.0.0.1:8003', ws: true },
    },
  },
})
