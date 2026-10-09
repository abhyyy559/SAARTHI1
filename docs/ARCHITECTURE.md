# WeatherGPT — Architecture (as built, 9 Oct 2026)

WeatherGPT (repo: SAARTHI) answers "what does the weather mean for me?" in
English, Hindi and Telugu, by voice or text, from official and model data,
and keeps working with poor or no internet. It is a React PWA in front of one
FastAPI service.

Rules the code enforces (tests fail if they break):

1. **No number without a source.** The server fetches every fact; the language
   model only phrases them and never computes.
2. **Severity is the server's.** One function (`verdict_service.build_verdict`)
   decides the level; the app only colours it. Unknown is grey, never green.
3. **Absence of data is not safety.** An unreachable warning service gives
   "could not check", never "no warning".
4. **Saved data shows its age.** Nothing saved is shown as live.

---

## 1. System map

```
 Phone / browser (PWA, frontend-react)                 FastAPI (backend/)
 ┌──────────────────────────────────────┐   HTTPS   ┌─────────────────────────────────────────┐
 │ Landing · Setup · Today · Ask ·       │ ───────▶ │ api/  weather · v1 · chat · voice ·     │
 │ Alerts · Map · Share · SOS · Settings │ ◀─────── │       location · advisory · climate ·   │
 │                                       │  JSON /  │       map · push · sources · ack        │
 │ lib/cache + useData: saved copies     │  NDJSON  │ services/  verdict · alert · chat path  │
 │ sw.js: offline shell + push           │          │       llm · validator · advisory · push │
 │ share/relay: snapshot QR, no server   │          │ adapters/  CAP(SACHET) · Open-Meteo ·   │
 └──────────────────────────────────────┘          │       IMD · OWM · marine · Sarvam       │
          ▲  lock-screen push (VAPID)               └───────┬─────────────────────────────────┘
          └──────────────── alert_watcher ◀─────────────────┘
                                                   ▼ outgoing (one shared TLS context, utils/http.py)
      NDMA SACHET (36 state CAP feeds) · Open-Meteo (forecast, nowcast, marine, models, ERA5 archive)
      IMD API (key not yet accepted) · OpenWeatherMap (backup) · Sarvam (STT/TTS) · Groq (LLM)
```

The built app (`frontend-react/dist`) is served by FastAPI at `/`, so one
address serves the app and the API (`scripts/demo-https.ps1`, `Dockerfile`).

## 2. Data sources

| Source | Used for | Labelled as | Notes |
|---|---|---|---|
| NDMA SACHET CAP RSS, all 36 states/UTs | Official alerts, the verdict, the map | Official | Keyless. Per-feed cache 3 min; the state feed is shared by every user in that state. |
| IMD API | Tried first for weather and warnings | Official | Key + whitelisted IP, still rejected by IMD; a circuit breaker skips it for 10 min after a rejection. |
| Open-Meteo forecast / nowcast | Now, next 3 days, next 3 hours | Model forecast | Best-match NWP models for the point. |
| Open-Meteo models | "Do weather models agree?" | Model forecast | GFS, ECMWF IFS, GEM, ICON; rainy day = 2.5 mm (IMD). |
| Open-Meteo marine | Sea card (coast, fishers) | Model, "not an INCOIS/IMD sea warning" | Wave height, gusts. |
| Open-Meteo archive (ERA5) | "20 years at this place", climate questions | Reanalysis | Complete years only; normal = all but the last 5 years. |
| OpenWeatherMap | Backup weather | Backup | Off unless `OWM_API_KEY` is set. |
| GeoNames ADM2 + surveyed TG/AP list | 763 districts, coast flags, search | — | CC BY 4.0. |
| Sarvam | Speech to text (`saarika`), text to speech (`bulbul`) | — | Browser speech is the fallback. |
| Groq | Phrasing answers | "AI explains, never makes up warnings" | `openai/gpt-oss-120b`, spill-over `openai/gpt-oss-20b` on HTTP 429. |

## 3. Main request flows

### Today screen (each card is its own request, saved on the phone)

| Card | Endpoint | Backend |
|---|---|---|
| Safety verdict | `GET /api/v1/warnings` | `alert_service.gather_alerts` (SACHET, matched to the district by name and area) + `imd_service` → `verdict_service.build_verdict` (level, hazard, `checked_sources`, `unchecked_sources`) |
| Now / next days | `GET /api/v1/weather/current`, `/forecast` | `api/weather.py`: IMD → Open-Meteo → OpenWeatherMap → file cache, 5-min front cache |
| Next 3 hours | `GET /api/weather/nowcast` | Open-Meteo |
| Sea | `GET /api/weather/marine` | `adapters/marine_adapter.py` |
| Models | `GET /api/weather/models` | `services/nwp_service.py` |
| For you | `GET /api/v1/advisories`, `GET /api/advisory/cards` | `advisory_service` (role rules from the verdict + weather), `advisory_cards_service` |
| 20 years | `GET /api/climate/trends` | `climate_service` (ERA5), 12-h cache |

### Ask (`POST /api/chat/stream`, NDJSON: `meta`, `token`…, `final?`, `done`)

1. `place_parser.asked_place`: a district named in the question ("in Patna",
   "patna mein", Telugu/Hindi city names) or in the previous question for a
   short follow-up; exact names only. Otherwise the saved place.
2. Parallel fetch: current, forecast, IMD warning, SACHET alerts → verdict.
3. Evidence: facts with units, IMD rain category per day, the place asked
   about, earlier questions (context only), and for climate questions the ERA5
   block.
4. Answer cache: same question + place + data within 10 min → reuse.
5. LLM (Groq) phrases the evidence; on 429 the second model; on failure the
   grounded template (`llm_service._template_answer`, all three languages).
6. Checks: `response_validator.validate` (severity escalation, invented
   percentages, unverified warnings, false all-clear), language script check,
   rain lead (IMD categories), inland-sea lead, no yes/no on safety questions.

### Alerts, map, share

- **Alerts** reuses `/api/v1/warnings`: your district's alerts, then the rest
  of the state, in force only, worst first. *Explain* sends the alert to Ask.
- **Map**: `GET /api/map/alerts` (all 36 feeds, placed on the districts each
  alert names, or the state centre marked approximate; 15-min cache) and
  `GET /api/map/grid` (Open-Meteo multi-point rain/heat for tomorrow; 1-h
  cache). Leaflet + OpenStreetMap tiles.
- **Share** never calls the server: the snapshot is compressed into the link
  after `#` (`lib/share.js`), which browsers never send to a server. A text
  QR carries plain words. `lib/relay.js` stores codes scanned in the app and
  passes them on, up to 5 hops.

### Push alerts

`POST /api/push/subscribe` stores the push endpoint with district, state,
language and role (no coordinates, no identity). `services/alert_watcher.py`
runs every 5 minutes per subscribed district + state, computes the same
verdict, and on start / escalate / update / end sends one push per phone in
its own language (`push_service.broadcast`), logs it
(`notification_service`) and records delivery (`delivery_service`).
`/api/ack` and `/api/coverage` hold acknowledgement counts (no screen yet).

### Background tasks (started in `main.py`)

Alert watcher; SACHET warm-up every 150 s; map warm-up every 10 min; demo
places (`WARM_DISTRICTS`) warm-up every 4 min.

## 4. Frontend (`frontend-react/`)

| Screen | File |
|---|---|
| Landing (video backdrop, live numbers from `/api/stats`) | `screens/Landing.jsx` |
| Setup: language, place, role (pictures) | `components/Setup.jsx` |
| Today | `screens/Today.jsx` |
| Ask (mic, chips, streamed answers, guardrail line) | `screens/Ask.jsx` |
| Alerts | `screens/Alerts.jsx` |
| Map | `screens/MapScreen.jsx` (lazy) |
| Share / Receive / Pass it on | `screens/Share.jsx`, `components/Scanner.jsx` |
| Page for a scanned QR (no app needed) | `screens/SharePage.jsx` |
| SOS | `components/Sos.jsx` |
| Settings: language, place, role, alerts, speak on open, sunlight mode, data sources | `App.jsx`, `components/Toggles.jsx`, `components/Sources.jsx` |

Libraries: `lib/cache.js` + `lib/useData.js` (saved copy first, live refresh,
retry back-off; keys include district and state), `lib/voice.js` (Sarvam/
browser speech, clips cached for offline, units in the listener's language),
`lib/i18n.js` (all labels in en/hi/te, hazard names, sky conditions),
`lib/push.js`, `sw.js` (precached shell, offline navigation, push display).

## 5. Configuration (`.env`, never committed; see `.env.example`)

`LLM_API_KEY`, `LLM_MODEL`, `LLM_FALLBACK_MODEL`, `SARVAM_API_KEY`,
`IMD_API_KEY`, `OWM_API_KEY`, `CAP_FEED_URLS` (default: SACHET),
`WARM_DISTRICTS`, `PUSH_ADMIN_TOKEN`, `VAPID_*`, `FRONTEND_ORIGINS`,
`DATABASE_URL` (optional Postgres; JSON files otherwise, under `store/`, not
in git). Frontend build: `VITE_API_URL` (separate backend), `VITE_PUBLIC_URL`
(share links when not opened from the public address).

## 6. Tests

- Backend: `python -m pytest` — 393 tests (verdict, validator, chat place and
  rain rules, push language/state, rate-limit spill-over, offline-safe
  defaults, data adapters with fakes; no network).
- Frontend: `npm test` — 23 node tests (cache, QR codec, relay, i18n coverage,
  hazard names); `npm run lint`; `npm run build`.

## 7. Running it

- Laptop: `start-saarthi.bat` (backend :8003 + Vite :5173).
- Phones / demo: `scripts\demo-https.ps1` (HTTPS address + QR).
- Permanent: `render.yaml` + `Dockerfile` (one service), or `vercel.json` for
  the frontend alone. Details: `docs/DEMO-READY.md`.
