# WeatherGPT — Technical Deep Dive

Stack, architecture, every module, difficulties faced, and pending items.
Companion docs: [project-overview.md](project-overview.md) (plain
language), [jury-questions.md](jury-questions.md) (defense script).

## 1. Stack

- **Backend:** Python 3.11, FastAPI, Pydantic v2, httpx, cryptography
  (Fernet), python-dotenv. No database (JSON-file stores), no Redis.
- **Frontend:** Vite 8 + React 19, no component library (custom CSS
  tokens, `ui.jsx` primitives), `vite-plugin-pwa` (generateSW),
  Leaflet (installed, currently unused — map views deleted).
- **AI/Voice:** Groq (OpenAI-compatible chat completions) for grounded
  answers; Sarvam AI for STT (`saarika:v2.5`) and TTS (`bulbul:v3`);
  browser SpeechRecognition/SpeechSynthesis as offline-capable fallback.
- **Deploy:** Render (backend, `render.yaml`), Vercel or FastAPI-served
  `dist/` (frontend). Local: backend `:8003`, frontend `:5173`
  (Vite proxy for `/api`, `/ws`). Boot with `start-saarthi.bat`.

## 2. Data sources and priority chains

| Fact type | Chain (first hit wins) | Auth |
|---|---|---|
| Current/forecast | IMD-live → Open-Meteo → OWM → file cache | IMD blocked (see §6) |
| Warnings | IMD-live → SACHET CAP (TG+AP+national, RSS link-following) | None needed |
| Nowcast | IMD-live → Open-Meteo | — |
| Cross-check | OWM | Key |
| NWP spread | Open-Meteo model selector (GFS/ECMWF-IFS/GEM/ICON) | None |
| Climate trends | ERA5 via Open-Meteo archive | None |

Every hop reports provenance (`LIVE`/`CACHED`/`DEMO`/`UNAVAILABLE`) through
`adapters/registry.py`. Nothing upstream ever sees raw source JSON —
only normalized Pydantic models.

## 3. Request pipeline (`api/chat.py` → services)

`ChatRequest{message, latitude, longitude, language, user_type}` →
`LocationService.resolve` (haversine gazetteer + coastal flags) →
parallel-ish retrieval (`_retrieve_live`: current, forecast, IMD
warning, CAP alerts) → `ValidationService` (source/freshness/location/
validity/completeness) → `RiskService` (severity×exposure table; RED
always CRITICAL, ORANGE minimum HIGH) → `advisory_for` + mandatory
`caveat_for` (farmer/fisherman/driver) → `build_evidence_package`
(source-correct: Open-Meteo vs SACHET/IMD) → `LLMService.generate`
(format-constrained system prompt) → `response_validator` (severity
guard, number grounding) → `ChatResponse` + advisory appended.

LLM-down path returns `structured_fallback: true` with raw verified
data; the system keeps working.

## 4. Module inventory

**Adapters** (`backend/adapters/`): `openmeteo_adapter` (current,
forecast, nowcast, NWP feed), `cap_adapter` (CAP parse + RSS
FetchXMLFile link-following + 30-min labelled CACHED fallback +
multi-feed merge), `owm_adapter`, `govdata_adapter` (unconfigured —
no keys), `stt_provider`/`tts_provider` (Sarvam), `wis2_adapter`
(UNCONFIGURED stub by design), `registry` (status bus).

**Services** (`backend/services/`): `imd_service` (sole IMD speaker),
`location_service` (gazetteer + haversine + coastal), `validation_
service`, `risk_service`, `advisory_service` (+caveats),
`llm_service`, `response_validator`, `rag_service` (keyword retrieval
over local emergency docs — powers offline Q&A), `report_service`
(community reports: closed vocabulary, required text, 5/hour
rate-limit, permanent COMMUNITY labels), `emergency_service` (Fernet
SOS packets, HMAC, 72-h replay window, 10-hop cap, outbox sync,
LocalRelay + labelled Simulated transports), `nwp_service`,
`climate_service` (ERA5 trends), `impact_service` (A→B route risk,
never "safe"), `cache_service` (JSON file + TTLs), `gis_service`
(haversine, polygons, relevance matcher).

**API** (`backend/api/`): `chat`, `weather` (current/forecast/
nowcast/warnings/models), `v1` (versioned chat, advisories with
nearby-alert tier, emergency send/inbox/sync/simulate, reports,
system status), `voice`, `location`, `sources`, `climate`,
`advisory`.

**Frontend** (`frontend-react/src/`): `App` (shell + banners + toast
+ tour + install prompt), `store` (location lifecycle, net state
machine live/reconnecting/offline + 30-s heartbeat, TTS singleton,
syncTick refetch), `components/`: `HeroCard` (verdict-first hero,
freshness ticker, expiry countdown, single-instance display —
controls live in TopBar), `LiveVoice` (full-screen voice mode:
listen→think→speak loop with barge-in), `ChatPanel` (bubbles,
evidence panel, typing indicator, latency stamps, per-message
speaker, dictate-then-send mic, offline fallback card + capped
queue + replay), `AlertCenter` (verified + nearby + community +
reports with error states), `Emergency` (SOS + sync + simulated
relay), `OnboardingTour` (spotlight coachmarks), `InstallPrompt`,
`LocationPrompt` (compact permission row), `ProfileAdvice`,
`VoicePanel`, `Shell` (TopBar/Sidebar/MobileNav/StatusBanner),
`RichText` (safe markdown-lite renderer), `format` (heroState,
countdown/expiry/age pure fns), `offline` (snapshots, guidance
cache, capped query queue), `useVoiceInput` (recorder + browser-SR
paths, timer, offline gating), `i18n` (EN/HI/TE strings).

## 5. Difficulties faced and how each was resolved

1. **IMD API blocked (401 IP-whitelist on all 5 endpoints).**
   Resolved by multi-source architecture + IMD-first chains that take
   over automatically if credentials ever exist.
2. **SACHET RSS hides alerts behind links.** Parser returned 0 while
   10 real alerts existed. Fixed with FetchXMLFile link-following.
3. **Single-state feed** missed AP users. Fixed with 3-feed merge
   (TG+AP+national) + state-level "nearby" tier that never promotes
   to verified warnings.
4. **Flapping feeds.** 30-minute labelled CACHED fallback in the
   adapter; UI tags every cached fact.
5. **Demo-mode 500s** (`IMD_ADAPTER=live` + fixtures). Fixed with
   adapter overrides at the two demo call sites.
6. **Advisories stuck on "unreachable".** `v1.py` read a provenance
   key the live branch never sets; fixed with all-source precedence.
7. **District-locked demo fixtures.** Fixtures now retarget (with
   correct state names) while staying DEMO-labelled.
8. **Servers dying between sessions** (agent-scoped tasks + Windows
   TIME_WAIT bind conflicts). Mitigated with `start-saarthi.bat`
   and 30–60 s restart backoff. Still the #1 operational pain.
9. **Blind frontend work** (no screenshot tooling): icon and layout
   misses fixed after user reports. Needs a visual QA pass.
10. **Voice felt dead:** added staged UI (timer, thinking dots,
    latency stamps) and a full LiveVoice mode; mic-permission blocks
    now explain themselves.

## 6. Known limitations (do not promise otherwise)

- No IMD credentials; govdata keys empty; WIS2 stubbed (brief-
  compliant); no native app; no Postgres (JSON stores);
- `disaster_manager` persona hidden per brief; map/GIS views deleted
  as dead code; Leaflet dependency remains but unused;
- CAP feeds flap; IMD marine bulletins and agromet advisories are
  not machine-readable to us — future sources, not current claims;
- PWA install + real-device offline pass unverified (needs a phone);
- Prototype crypto uses a pre-shared key (documented in jury Q&A).

## 7. Verification commands

```powershell
cd weathergpt
python -m pytest tests/ -q            # 70 backend tests
cd frontend-react
node --test tests/*.test.mjs          # 15 frontend tests (run per-file)
npm run lint; npm run build           # oxlint clean + PWA SW in dist/
```

Live checks: `/api/health`, `/api/v1/system/status`,
`/api/v1/advisories?district=Hyderabad&user_type=fisherman`,
*"Is there a red alert?"* → refusal with real severity.
