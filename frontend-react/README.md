# WeatherGPT (React client)

React 19 + Vite 8 PWA. Built for people who may not read: one big colour and
one big picture say the safety state, every block of text has a read-aloud
button, and labels in English, Hindi and Telugu are short helpers.

```bash
cd frontend-react
npm install
npm run dev      # dev server on :5173, proxies /api to the FastAPI backend on :8003
npm run build    # emits dist/ (service worker included: offline works only in builds)
npm run preview  # serves dist/ on :4173 with the same /api proxy
npm test         # node:test unit tests (cache, QR codec, i18n coverage, weather helpers)
npm run lint     # oxlint
```

Environment (build time): `VITE_API_URL` for a separately hosted backend,
`VITE_PUBLIC_URL` for the public address QR share links point to (without it
the links use the current origin, so a localhost build makes local-only codes).

## Screens

| Screen | What it shows |
|---|---|
| Landing (`screens/Landing.jsx`) | First-run opening screen over the video backdrop, live numbers from `/api/stats`. Returning users open on Today; the logo brings it back; `?landing=1` forces it. |
| Setup (`components/Setup.jsx`) | Language, place (GPS or search), role. Nothing is defaulted silently. |
| Today (`screens/Today.jsx`) | Server-owned safety verdict (says which sources were checked), weather now, next 3 days, advice for the chosen role. |
| Ask (`screens/Ask.jsx`) | Big mic (Sarvam STT, browser fallback), picture chips per role, streamed answers read aloud after a spoken question. |
| Alerts (`screens/Alerts.jsx`) | Official alerts still in force, worst first; "Explain" asks the chatbot in the user's language. |
| Map (`screens/MapScreen.jsx`, lazy) | Heatmaps: official alerts in force across India (all 36 SACHET state feeds), rain and heat tomorrow (Open-Meteo grid). Spoken summary with the nearest alert. |
| SOS (`components/Sos.jsx`) | 112, 108, 1077, 1070 through the dialler (works offline) and "send my location" by SMS/share. |
| Settings | Language, place (saved places), role, push alerts, speak on open, sunlight mode, data sources (`components/Sources.jsx`). |
| Share (`screens/Share.jsx`) + `screens/SharePage.jsx` | A QR code whose link carries the snapshot after `#`. Any phone camera opens a light page that shows it with its time, plus the latest status if that phone is online. |

## Phone to phone (P2P)

- Link QR: the snapshot rides inside the link; any camera opens it.
- Text QR: plain words any camera shows with no internet at all.
- Receive: the in-app scanner (`components/Scanner.jsx`, jsQR, all on the
  phone) saves another phone's code; "Pass it on" shows it again with one
  more hop, up to 5 (`lib/relay.js`). Works with both phones offline.

## Offline

- `lib/cache.js` + `lib/useData.js`: every screen's last good answer is kept on
  the phone with its fetch time and shown as "Saved · 5 min ago". Screens with
  nothing saved retry with back-off (cold server starts).
- Questions asked offline are answered from saved data and sent when the
  network returns.
- `lib/voice.js` keeps every spoken clip in Cache Storage, so anything heard
  once can be replayed offline.
- `src/sw.js` precaches the app shell (workbox) and handles push.

## Design

The landing spec's look on every screen: the looping video backdrop
(`components/Backdrop.jsx`, mounted once at the root so it keeps playing from
the landing into the app, with a darker veil inside the app), see-through
cards (blurred glass on desktop only), white pills with soft shadows, glowing
primary buttons, staggered rise-in entrances, dot-matrix numbers and titles.
On desktop the spec header (logo, white nav pill, dark place pill) replaces
the phone's bottom tab bar; both are the same `<nav>`, styled by width.

- Display type: BubbledotICG-FinePos from the OnlineWebFonts CDN, as the spec
  asks (non-blocking link in `index.html`, CC BY 4.0 credit in Settings), then
  Geist Pixel Circle (SIL OFL 1.1, bundled, `public/fonts/GeistPixel-OFL.txt`)
  offline. The spec's tight headline tracking is applied only once Bubbledot
  has loaded (`has-bubbledot`, set in `main.jsx`). Bubbledot ICG is an Image
  Club Graphics (Adobe) typeface and the CC BY licence is OnlineWebFonts'
  claim: before a public launch, licence it or delete the link in
  `index.html` (Geist Pixel then takes over with no other change).
- Text: Inter via `@fontsource/inter` (OFL), Noto Sans Devanagari/Telugu for
  Hindi and Telugu, all bundled so they work offline.
- Video: the spec's CloudFront file (~14 MB, served with a one-year cache),
  skipped on Data Saver, 2G, offline and reduced motion. Host a copy you have
  rights to before production.
- Sunlight mode (Settings): light, high-contrast screens with no video; the
  landing keeps its dark look.

## Rules the code keeps

- Severity comes from the backend verdict (`verdict.level`); the client never
  grades or re-grades a warning. Unknown is grey, never green.
- Saved data always shows its age; nothing saved is passed off as live.
- Every label exists in all three languages (`tests/i18n-weather.test.mjs`).
