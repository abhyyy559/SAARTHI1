# WeatherGPT - Trust Console (React client)

React 19 + Vite 8 app served as a static build by FastAPI (`backend/main.py`
mounts `frontend-react/dist`). Default route is the Situation view; everything else
is one tap away in the sidebar (desktop) or bottom tab bar (mobile).

```bash
cd weathergpt/frontend-react
npm install
npm run dev      # local dev server (targets the FastAPI backend on :8003)
npm run build    # emits dist/ - rebuild after any frontend change
npm run lint     # oxlint, 104 rules, must be 0 warnings / 0 errors
```

## Structure

| Path | What lives there |
|---|---|
| `src/App.jsx` | Shell wiring, view routing, `React.lazy` map boundary, error boundary |
| `src/store.jsx` | Single app store (`useApp`): lang, persona, theme, connection, pipeline, last answer, global `ask()` |
| `src/views.jsx` + `src/MapView.jsx` | The 7 views. `MapView` is a separate module so Leaflet ships in its own chunk |
| `src/components/Shell.jsx` | Sidebar, top status bar, mobile tab bar, DEMO/LIVE banner |
| `src/components/ui.jsx` | Shared primitives (Card, Sev, Prov, Stat, KV, Empty, Skeleton, Loading) |
| `src/components/EvidencePanel.jsx` | Dedicated provenance inspector (new in v2) |
| `src/components/*` | Feature components: Situation, GapHero, Pipeline, ChatPanel, VoicePanel, AlertCenter, Emergency, RouteCheck, MapPanel, DataPanels, SafetyPanel, Manager, SourceStrip, ViewHead, icons |
| `src/i18n.js` | EN/HI/TE chrome strings (severity codes stay machine-readable) |
| `src/api.js`, `src/offline.js` | Backend client + offline cache helpers |
| `src/styles.css` | Design system v2 (light/dark/auto themes) |

## Conventions (enforced by review, not just lint)

- The active view owns the single `<h1>`; everything else renders `<h2>`.
- Severity colours appear only in official-warning contexts, always with the code.
- Provenance badges (`LIVE`/`CACHED`/`DEMO`) accompany every fact.
- New views go through `ViewHead` + the `NAV` array in `src/i18n.js`.
- Chat is the only writer of answers; everything else is read-only rendering.
