# SAARTHI — Complete Architecture & Working Guide

> **SAARTHI** (built on the WeatherGPT prototype) is a **public-safety weather
> verification layer** for India. It sits between official meteorological data
> (IMD, NDMA-SACHET CAP alerts, global models) and people — validating,
> locating, and explaining warnings, never inventing them.

---

## 1. The working analogy — how it all fits together

Think of SAARTHI as a **newsroom with a strict fact-checking desk**, built for
weather emergencies:

| Newsroom role | SAARTHI equivalent | What it does |
|---|---|---|
| Wire services | **Adapters** (`backend/adapters/`) | Fetch raw data from IMD, SACHET-CAP, Open-Meteo, data.gov.in, OpenWeatherMap. Each adapter speaks one source's protocol and normalizes it. |
| Assignment desk | **Alert service** (`backend/services/alert_service.py`) | Decides which alerts matter for *your district* by matching alert geography against the district gazetteer. |
| Fact-check desk | **Verdict service** (`backend/services/verdict_service.py`) | Produces the single official safety verdict. **Severity is server-owned**: the frontend is forbidden from deriving or recolouring it (enforced by tests). |
| Standards editor | **Response validator** (`backend/services/response_validator.py`) + LLM rules | The AI may only explain; it may never invent a warning, change a severity, or give advice in chat. Advice lives only in the Advisory section. |
| Printing press | **Delivery service** (`backend/services/delivery_service.py`) + **Push service** (`backend/services/push_service.py`) | Fan-out: in-app notifications, notification log, delivery ledger, and Web Push (VAPID) even when the app is closed. |
| Stringers in the field | **P2P / community layer** | Phones relay alerts to each other (Bluetooth-style demo via `P2PDemo`), so warnings survive network loss. Community observations are always labelled COMMUNITY, never official. |
| The front page | **Frontend** (`frontend-react/`) | Eight views: Home (situation), Ask (verified Q&A), Alerts, Notifications, Advisory (guidance), Admin (demo console), Trust (sources & how-it-works). |
| The archive | **Cache + stores** (`backend/services/cache_service.py`, `demo_alert_store.py`, `store_bridge.py`) | Every adapter result is cached with a timestamp; stale data is labelled CACHED/STALE, never presented as fresh. |

**The golden rule, end to end:** *absence of data is never rendered as safety.*
If a source is unreachable, the UI says "cannot confirm" — it never says "all clear."

---

## 2. System map

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + Vite)                   │
│  Home · Ask · Alerts · Notifications · Advisory · Admin · Trust   │
│  store.jsx (view/lang/persona/location/mode) · i18n (en/hi/te)    │
│  Voice: mic → STT → answer → TTS replay · PWA + service worker   │
└───────────────▲───────────────────────────────▲─────────────────┘
                │ REST + WebSocket              │ Web Push (VAPID)
┌───────────────┴───────────────────────────────┴─────────────────┐
│                     BACKEND (FastAPI, :8003)                     │
│  ┌─ API routers ───────────────────────────────────────────┐    │
│  │ /api/weather  /api/chat  /api/voice  /api/advisory        │    │
│  │ /api/v1/* (warnings, system status)  /api/demo/*          │    │
│  │ /api/notifications  /api/push  /api/sources  /ws/warnings │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│  ┌─ Services ────────────────┴──────────────────────────────┐    │
│  │ verdict · alert · advisory · notification · delivery      │    │
│  │ llm (Groq) · rag · risk · impact · gis · climate (ERA5)   │    │
│  │ location · district · emergency (SOS) · cache · demo store│    │
│  └──────────────────────────┬──────────────────────────────┘    │
│  ┌─ Adapters ────────────────┴──────────────────────────────┐    │
│  │ cap (NDMA-SACHET) · imd · open-meteo · govdata · owm      │    │
│  │ wis2 · stt · tts          ▲ each reports LIVE/CACHED/     │    │
│  └──────────────────────────┼──────────────────────────────┘    │
└──────────────────────────────┼──────────────────────────────────┘
                               │ HTTP / CAP-XML / RSS / JSON
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        NDMA-SACHET        IMD / models    data.gov.in …
        (CAP alerts)    (weather, NWP)      (bulletins)
```

---

## 3. The three modes

| Mode | Weather from | Warnings from | Used for |
|---|---|---|---|
| **DEMO** | Scripted fixtures | Scripted fixtures + demo alert store | Stage demos, no internet needed |
| **HYBRID** | Live adapters (Open-Meteo/IMD) | Live SACHET-CAP + demo overlays | Real-data testing |
| **IMD** | Official-only (IMD adapters) | Live SACHET-CAP, reports UNAVAILABLE rather than backfilling | Production with API access |

P2P is **not** a source mode — it is a separate resilience layer (simulated
device-to-device alert relay, labelled "Demo only. Simulated." in the UI) that
rides on top of any mode.

The mode banner names the sources actually carrying the answer — "HYBRID"
alone tells a fisherman nothing. Source mode can be switched live from the UI
(`POST /api/mode`); demo-only routes return **403** outside demo mode.

---

## 4. Alert lifecycle (the Round-2 story)

Demo/official alerts move through a state machine — this is the product's
centrepiece, driven live from the **Admin console** (`?view=admin`):

```
UPCOMING → PRE-ALERT → ACTIVE → UPDATED ─┬─→ EXTENDED ─→ ENDED
                                         └→ (update loop)   ↘
                                                              CANCELLED
```

- Every transition fires the **same pipeline** a real alert would travel:
  demo store → push → notification log → delivery ledger. The Admin panel is
  not a mock — if a button moved state without a notification, the
  notification centre would visibly miss it.
- Each transition is recorded in the alert's **history timeline**, visible on
  the admin row and the alert details view.
- Live alerts (ACTIVE/UPDATED/EXTENDED) can be **relayed over P2P** and
  **re-notified**; ENDED/CANCELLED alerts drop off Home automatically.

---

## 5. Backend deep-dive

### 5.1 API routers (`backend/api/`)
| Router | Prefix | Purpose |
|---|---|---|
| `weather.py` | `/api/weather` | Current weather + forecast (multi-source) |
| `chat.py` | `/api/chat` | Ask endpoint — grounded answers with provenance |
| `voice.py` | `/api/voice` | Speech-to-text in, text-to-speech out (10 MB / 2,000-char limits) |
| `advisory.py` | `/api/advisory` | Persona guidance (farmer/fisher/driver/general) — the ONLY place advice is generated |
| `v1.py` | `/api/v1` | Warnings, warning detail, system status |
| `demo_alerts.py` | `/api/demo` | Demo alert CRUD + lifecycle actions (demo mode only) |
| `notifications.py` | `/api/notifications` | Notification log + unread counts + acknowledgement |
| `push.py` | `/api/push` | Web Push subscriptions (VAPID) |
| `sources.py` | `/api/sources` | Adapter status strip data (LIVE/CACHED/DEMO/ERROR/UNCONFIGURED…) |
| `climate.py` | `/api/climate` | ERA5 20-year trends — context, never a warning |
| `location.py` | `/api/location` | District resolution (GPS → district gazetteer) |
| `ack.py` | `/api` | Alert acknowledgement receipts |

Plus `GET /api/health`, `GET/POST /api/mode`, and `WS /ws/warnings` (live push).

### 5.2 Key services (`backend/services/`)
- **`verdict_service.py`** — owns severity. The single official verdict per
  district; the frontend renders it verbatim.
- **`alert_service.py`** — gathers alerts from adapters, geo-matches to
  districts, applies the honesty policy (unavailable ≠ safe).
- **`advisory_service.py`** — persona-based preparedness guidance. Strictly
  separated from chat: the LLM system prompt forbids advice in chat and
  redirects to Advisory.
- **`llm_service.py`** — Groq (`openai/gpt-oss-120b`); invalid models degrade
  visibly to a grounded fallback instead of HTTP 500.
- **`rag_service.py`** — retrieval grounding for chat answers.
- **`notification_service.py` / `delivery_service.py` / `push_service.py`** —
  the fan-out pipeline + delivery ledger + VAPID web push.
- **`demo_alert_store.py`** — the demo alert state machine + history.
- **`cache_service.py`** — TTL cache; stale reads are labelled, never silent.
- **`risk_service.py`, `impact_service.py`** — risk assessment ("WeatherGPT
  view — not an IMD rating") and impact estimation.
- **`gis_service.py`, `location_service.py`, `district_service.py`** — warning
  geography, GPS→district, Telangana district gazetteer (incl. TGiCCC acronym
  expansion: HYD→Hyderabad, KMR→Karimnagar…).
- **`emergency_service.py`** — SOS flow.
- **`nwp_service.py`, `climate_service.py`** — multi-model comparison, ERA5 trends.
- **`translation_service.py`, `stt/tts providers`** — hi/te + voice.

### 5.3 Adapters (`backend/adapters/`)
Each adapter normalizes one source and reports its own status verbatim to
`/api/sources` (the UI renders it unedited: LIVE, CACHED, DEMO, READY,
UNCONFIGURED, OFFLINE, ERROR):

- **`cap_adapter.py`** — NDMA-SACHET CAP XML/RSS. Parses the CAP §9 field set;
  garbage payloads (login pages, WAF blocks) count as *failed feeds*, never
  "0 active alerts". All feeds failing + no cache → honest ERROR.
- **`imd.py` / `imd_service.py`** — IMD data (needs API key — requested).
- **`openmeteo_adapter.py`, `owm_adapter.py`, `govdata_adapter.py`** — model
  and bulletin sources. **`wis2_adapter.py`** — WMO WIS 2.0 feed.

---

## 6. Frontend deep-dive (`frontend-react/`)

### 6.1 Views (`src/views.jsx`, routed by `store.jsx` `?view=`)
| View | Route | Purpose |
|---|---|---|
| Home | `home` | Situation dashboard: connection strip, safety verdict hero, active alerts, weather strip, action tiles, recent notifications |
| Ask | `ask` | Verified Q&A — facts only, every fact carries provenance |
| Alerts | `alerts` | Official warnings in full + SOS / resilient network |
| Notifications | `notifications` | Alert lifecycle trail + acknowledgement |
| Advisory | `advisory` | Persona guidance (the only place advice appears) |
| Advisor | `advisor` | Legacy advice view (kept for deep links) |
| Admin | `admin` | **Demo console** — seed scenarios, drive the alert lifecycle, relay via P2P, resend notifications, authority & coverage dashboards |
| Trust | `trust` | Source statuses, GIS/WIS 2.0 explainer, safety architecture |
| Details / Sources | `?view=details`, `?view=sources` | Deep-link-only views |

### 6.2 State (`src/store.jsx`)
Single `AppProvider`: `view`, `lang` (en/hi/te), `persona`
(fisherman/farmer/driver/general), `loc` (district/lat/lon), `sourceMode`,
`netState`, `toast`, theme, notification + offline-sim toggles. Deep links via
`?view=` (whitelist must match the `VIEWS` registry in `App.jsx`).

### 6.3 Honesty architecture (enforced, not aspirational)
- Chat is **facts-only**; the LLM system prompt bans advice there.
- Severity comes from `warn.verdict` (backend) — `format.js` contains no
  severity mapping; tests fail the build if one creeps back in.
- Unavailable services render "cannot confirm", never "all clear".
- One broken view can't take the console down (`Boundary` per view, keyed).
- Provenance labels (LIVE/CACHED/DEMO/COMMUNITY/UNAVAILABLE) render verbatim.

---

## 7. Two end-to-end flows

### 7.1 "Is there a red alert for Hyderabad?"
1. Ask view → `POST /api/chat` with district + persona + lang.
2. `alert_service` gathers CAP alerts, geo-matches to Hyderabad.
3. `verdict_service` computes the official verdict (severity server-owned).
4. `llm_service` (Groq) explains **only** — grounded in the retrieved facts;
   `response_validator` rejects invented warnings or advice.
5. UI renders the answer + verdict card + provenance chips (which source,
   when fetched). Voice: TTS replays it.

### 7.2 Demo: cyclone alert lifecycle (the stage story)
1. Admin console (`?view=admin`) → seed **Cyclone** scenario (Kakinada · RED).
2. Alert enters `UPCOMING`; Home shows it with a state chip.
3. Advance: PRE-ALERT → ACTIVE — each step pushes a notification, writes the
   delivery ledger, and appends the history timeline.
4. **Relay via P2P** → the alert hops phone-to-phone (works offline).
5. UPDATE/EXTEND as the story evolves; END when it passes — Home drops it,
   Notifications keeps the full trail for acknowledgement.

---

## 8. Deployment & environments

- **Backend:** Render (or any FastAPI host). `DEMO_MODE=true` for the demo;
  `FRONTEND_ORIGINS` must include the frontend URL (CORS is restricted);
  per-IP rate limiting on public POST; `CAP_FEED_URL` for live SACHET.
- **Frontend:** Vercel. `VITE_API_URL` must point at the deployed backend.
- **Push:** VAPID keys — the committed key was exposed and must be rotated;
  `vapid_keys.json` is git-ignored and never tracked.
- **Modes:** `POST /api/mode` switches demo/imd/hybrid live.

---

## 9. Test map

- **Backend:** `pytest tests/` (272 tests) — adapters, services, alert
  lifecycle, risk assessment, QA safety invariants, source modes.
- **Frontend:** `npm test` (`node:test`, ~40 tests) — source-level contracts:
  verdict ownership, chat identity keys, view registry, i18n fallbacks.
- **Behavioural:** scripted checks (22/22) against the running app.
- **Rule:** reviewer agent + tester agent over every change before any commit;
  no commits without Abhiram's approval.
