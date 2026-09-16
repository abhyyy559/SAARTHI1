# 🌦 WeatherGPT — Trust Console (SIH 2026 · Problem 26068 · MoES/IMD)

> **Not a weather app.** A verification layer between authoritative meteorological
> data and humans: multi-source ingest → validation → GIS → risk → grounded
> conversation → multilingual voice + map. The LLM never predicts weather.

Live: `http://localhost:8003/` (React trust console, served by FastAPI).
Jury run-through: `demo/jury-script.md`. Design spec: `docs/superpowers/specs/2026-09-15-trust-console-design.md`.

> **Core promise:** Authoritative weather information → verified location-aware intelligence → actionable human communication. The LLM is the conversational layer, never the meteorological authority.

---

## 1. Overview

WeatherGPT retrieves weather observations, forecasts, warnings and nowcasts from IMD, validates them, determines relevance to the user's location and context, and presents grounded results through:

- Natural-language chat
- Dashboard with current weather, warnings, 7-day forecast, risk interpretation
- Map visualization (Leaflet + OpenStreetMap)
- English / हिंदी / తెలుగు
- Voice input/output (Web Speech API)
- Evidence / source transparency ("Why this answer?")
- Low-connectivity cached resilience

## 2. Architecture

```
Authoritative Data (IMD)
      ↓
Data Normalization
      ↓
Validation (source · freshness · location · validity · completeness)
      ↓
Risk Analysis (rule-based, labelled "WeatherGPT Risk", never reuses IMD colours)
      ↓
User-specific Advisory (general / farmer / driver / fisherman)
      ↓
Grounded Conversational AI (verified context only)
      ↓
Multilingual / Voice Delivery
```

## 3. Features

| Area | What it does |
|---|---|
| Current weather | Temp, humidity, wind, rainfall, condition from IMD |
| Forecast | 7-day city forecast (temp ranges + rainfall) |
| Warnings | District-level alerts with validity window; expired ⇣ non-active |
| Validation | Source trust · freshness · location match · time window · completeness |
| Risk | Rule-based LOW/MODERATE/HIGH/CRITICAL — clearly separated from official colour |
| Advisory | Persona-specific guidance without unsupported agricultural/medical claims |
| Chat | NL queries → intent/location/time → verified data → grounded answer |
| Evidence | Every answer exposes source, data type, issued/valid timestamps |
| Languages | English, Hindi, Telugu (severity stays machine-readable) |
| Voice | Browser Web Speech STT + TTS fallback |
| Map | User marker + warning polygon + severity-coloured overlay |
| Offline | Last-known verified data + timestamp + "Limited Connectivity" banner |

## 4. Tech Stack

- **Backend:** Python 3.11 · FastAPI · Pydantic v2 · httpx · WebSocket warnings
- **Frontend:** React 18 + Vite (multi-file: GapHero, Pipeline, Chat, Voice, Models, Climate, Map, Safety) served as static build by FastAPI
- **Live data (no keys):** Open-Meteo forecast + GFS/ECMWF/GEM/ICON multi-model + ERA5 20-yr archive
- **Key-gated:** data.gov.in · OpenWeatherMap x-check · NDMA-Sachet CAP feed · Sarvam STT/TTS (all report UNCONFIGURED until keys land — never faked)
- **Cache:** In-memory + JSON file (Postgres/PostGIS path documented for production)

## 5. Environment Variables (see `.env.example`)

| Key | Unlocks | Required? |
|---|---|---|
| `DEMO_MODE` | `false` = live chain (default now: live) | No |
| `OWM_API_KEY` | second-opinion disagree panel | Optional |
| `DATAGOV_API_KEY` + `DATAGOV_RESOURCE_ID` | official records cross-check | Optional |
| `CAP_FEED_URL` | live emergency alerts → GIS intersection | Optional |
| `SARVAM_API_KEY` | server STT/TTS (else browser voice + badge) | Optional |
| `WIS2_BROKER` | real-time ingestion layer (conceptual until set) | Optional |

## 6. Local Setup

```bash
cd weathergpt
pip install -r backend/requirements.txt
# React console (rebuild after frontend changes):
cd frontend-react && npm install && npm run build && cd ..
# LIVE (default): real Open-Meteo + ERA5 + NWP, honest labels elsewhere
set DEMO_MODE=false && python -m uvicorn backend.main:app --port 8003
# DEMO (fixtures, labelled): set DEMO_MODE=true
# open http://localhost:8003
```

## 7. API Endpoints

```
GET  /api/health, /api/sources (per-source LIVE/CACHED/DEMO status)
GET  /api/weather/current|forecast|warnings|nowcast|models (GFS/ECMWF/GEM/ICON/WRF)
GET  /api/climate/trends (ERA5, 20y) · GET /api/advisory · GET /api/risk
POST /api/chat + POST /api/chat/query (spec alias)
POST /api/voice/transcribe|synthesize · GET /api/voice/status
GET  /api/location/resolve|search · WS /ws/warnings
```

### Chat contract

```json
POST /api/chat
{
  "message": "Will it rain tomorrow?",
  "latitude": 17.385,
  "longitude": 78.4867,
  "language": "en",
  "user_type": "general"
}
```

Response includes `answer`, `location`, `risk` (source `WEATHERGPT`), `warning` (official, source `IMD`), `evidence[]`, `structured_fallback`.

## 8. Demo Instructions

Run with `DEMO_MODE=true` (default):

1. **Scenario A — General:** Ask *"Will it rain tomorrow?"*
2. **Scenario B — Severe weather:** Ask *"Is there any dangerous weather near me?"*
3. **Scenario C — Telugu voice:** Tap 🎙, speak *"రేపు హైదరాబాద్‌లో వర్షం పడుతుందా?"*

The amber **DEMO MODE** banner is always visible when demo data is shown.

## 9. Safety Architecture

> **The LLM is never the source of emergency weather truth.**

- Warnings, severity, forecasts come **only** from validated IMD data.
- Official severity (GREEN/YELLOW/ORANGE/RED) is never modified.
- `WeatherGPT Risk` is a separate interpretation, explicitly labelled.
- Expired warnings are never presented as active.
- IMD/LLM outages degrade gracefully — never hallucinate replacement weather.
- All five **mandatory §50 safety tests** are enforced by `tests/safety/test_safety.py`.

```
LLM failure ↓ Weather system continues working
LLM unavailable ≠ Weather system unavailable
```

## 10. Data Sources

- IMD API platform (`current_wx`, `cityforecastloc`, `districtwarning`, `districtnowcast`) via `backend/services/imd_service.py` — the **only** module that touches IMD; everything else consumes normalized Pydantic models.
- Demo fixtures under `demo/fixtures/*.json` (IMD-like schema, time-relative so warnings stay active for demos).

## 11. Known Limitations

- Live IMD endpoints/parameters must be confirmed against current IMD docs (adapter isolates any changes).
- MVP uses a small local gazetteer; production needs a full district/pincode resolver.
- Voice falls back to browser Web Speech API; backend STT/TTS stubs exist for keyed providers.
- No persistence DB yet — JSON-file cache only (covers offline/demo).

## 12. Future Improvements

- Full WIS2/IMD integration, satellite/radar/NWP layers
- PostGIS spatial models, flood/river/road/elevation layers
- Impact-based forecasting, route-aware travel risk, personalized alerting
- Multi-channel emergency delivery (SMS, IVR, broadcast)

---

**Definition of Done — see `docs/PRD.md` for the full spec (§61).** The MVP checklist is satisfied when all functional features, safety tests, and demo scenarios operate end-to-end.