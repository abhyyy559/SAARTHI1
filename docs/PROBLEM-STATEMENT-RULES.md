# PROBLEM-STATEMENT-RULES.md

**The alignment gate for this project.**
Every change must be checked against this file before it ships. If a change does
not serve one of the eight Key Features or six Evaluation Parameters below, it does
not belong in this build.

---

## 1. The problem statement (verbatim, PS 26068)

| Field | Value |
|---|---|
| Problem Statement ID | 26068 |
| Title | WeatherGPT: Conversational AI for Weather Forecasting, Alerts, and Climate Information |
| Organization | Ministry of Earth Sciences (MoES) |
| Department | India Meteorological Department (IMD) |
| Category | Software |
| Theme | Disaster Management |

### Background (verbatim)
> Weather information is often distributed through multiple portals, bulletins,
> satellite products, and forecast systems, making it difficult for common users,
> researchers, disaster managers, and government agencies to quickly obtain
> actionable insights. There is a need for an intelligent conversational platform
> that can provide real-time weather information, forecasts, warnings, climate
> analysis, and decision support in natural language.

### Objective (verbatim)
> Develop an AI-powered chatbot platform named WeatherGPT that integrates
> meteorological datasets, forecasting models, and disaster warning systems to
> provide accurate, contextual, and multilingual weather intelligence through
> conversational interfaces.

### Key Features (verbatim — these are the acceptance criteria)
1. Real-time weather information retrieval.
2. Natural language querying for weather forecasts.
3. Integration with numerical weather prediction (NWP) models such as GFS/WRF.
4. Extreme weather alerts and early warning dissemination.
5. Location-based forecasting and advisory generation.
6. Multilingual support for Indian languages.
7. Climate trend and historical weather analysis.
8. Voice-enabled interaction for rural accessibility.

### Expected Solution (verbatim)
- A **mobile-based** conversational AI platform.
- Backend integration with meteorological databases, website and APIs.
- AI/LLM-based query understanding engine.
- Scalable architecture supporting real-time data ingestion.

### Suggested Technology Stack (verbatim)
Python / FastAPI / Node.js · MQTT / WIS2.0 / WebSocket · LLMs (OpenAI, Llama,
Gemini, etc.) · GIS tools and weather APIs · PostgreSQL / MongoDB · Docker / Kubernetes

### Expected Outcomes (verbatim)
- Faster dissemination of weather information.
- Improved public accessibility to forecasts.
- Better disaster preparedness and response.
- Intelligent weather decision-support system for agriculture, aviation, marine,
  and urban planning.

### Possible Use Cases (verbatim)
Farmers seeking crop-weather advisories · Aviation weather briefing ·
Flood/cyclone warning dissemination · Smart city weather monitoring ·
Climate analytics for researchers

### Evaluation Parameters (verbatim — the jury scores on these six)
1. Accuracy and relevance.
2. Response latency.
3. Multilingual capability.
4. User interface and accessibility.
5. Scalability and innovation.
6. Integration with real-time meteorological systems.

---

## 2. Scope guard — what this build is and is NOT

This is a **prototype demonstrating PS 26068**. It must not drift.

**In scope:** the eight Key Features, expressed for farmers, drivers and fisherfolk
through a conversational, voice-first, multilingual interface.

**Out of scope — do not build:**
- Any feature that is not traceable to a Key Feature or an Evaluation Parameter.
- A general-purpose weather app (temperature dashboards, hourly graphs, radar maps
  for their own sake). The PS asks for *conversational intelligence*, not a weather
  viewer.
- Additional personas beyond those the PS use cases justify
  (farmer / driver / fisherman / researcher / disaster manager).
- New external services that need a paid key or a registration the team cannot
  obtain before the event.
- Feature work after the 48-hour feature freeze.

**Non-negotiable product constraints (already established, keep them):**
- The LLM is never the source of weather truth. It phrases, translates and explains
  verified data only.
- Every fact carries provenance: `LIVE` / `CACHED` / `DEMO` / `COMMUNITY` /
  `UNAVAILABLE`. Never present one as another.
- Absence of data is never rendered as safety. "Cannot check" must never read as
  "no warning".
- Official severity is never modified or escalated by WeatherGPT.

---

## 3. Compliance checklist

Status legend: **ALIGNED** (works and is reachable) · **PARTIAL** (exists but
incomplete or unreachable from the UI) · **GAP** (missing) · **BROKEN** (exists but
does not do what it claims).

### Key Features

| # | Feature | Where it lives | Status | Notes |
|---|---|---|---|---|
| 1 | Real-time weather retrieval | `api/weather.py::_live_current` | **ALIGNED** | Chain IMD → Open-Meteo → OWM → cache. Verified LIVE on the running backend. |
| 2 | Natural-language querying | `api/v1.py::v1_chat` + `services/llm_service.py` | **ALIGNED** | Verified: Groq returned a real grounded answer in both LIVE and DEMO. |
| 3 | NWP model integration (GFS/WRF) | `services/nwp_service.py` | **PARTIAL** | GFS, ECMWF-IFS, GEM, ICON via Open-Meteo work. **WRF is not wired** (`None` → UNCONFIGURED). `/api/weather/models` exists but **no UI reaches it**. |
| 4 | Extreme weather alerts + dissemination | `adapters/cap_adapter.py`, `adapters/alert_sources.py`, `api/weather.py::warnings`, `main.py::ws_warnings` | **BROKEN (UI)** | Backend is ALIGNED and verified (20 live CAP alerts fetched). The **Home hero ignores `cap_alerts`/`nearby_alerts`** and shows "All clear" while the Alerts page shows the same alerts. The `/ws/warnings` push exists but **no frontend code connects to it**. |
| 5 | Location-based forecasting + advisories | `services/location_service.py`, `services/advisory_service.py` | **PARTIAL** | Advisory engine is correct and multilingual (verified EN/HI/TE). Gazetteer is only **14 entries** — far too thin for India-wide credibility. |
| 6 | Multilingual support | `i18n.js`, `advisory_service.py`, `llm_service.py` | **PARTIAL** | EN/HI/TE across advisory, LLM and chrome. `viewAlertsSub`/`viewTrustSub` are English-only; several safety surfaces are hardcoded English (`Shell.jsx` mode + disaster banners, `HeroCard` severity tags, all of `Emergency.jsx`). |
| 7 | Climate trend / historical analysis | `services/climate_service.py`, `api/climate.py` | **PARTIAL** | Real ERA5 series + trend maths implemented and working. **No UI reaches it** — `api.climate` is defined in `api.js` but never called. |
| 8 | Voice-enabled interaction | `adapters/stt_provider.py`, `adapters/tts_provider.py`, `useVoiceInput.js` | **ALIGNED (UX risk)** | Sarvam STT/TTS configured. Latency is 10–20 s per turn — see §4. |

### Expected Solution

| Requirement | Status | Notes |
|---|---|---|
| Mobile-based platform | **PARTIAL** | PWA manifest + responsive CSS exist. **Zero real-device testing.** Not yet verified on any Android phone. |
| Backend integration with met databases/websites/APIs | **ALIGNED** | Open-Meteo, SACHET CAP, OWM, GDACS, WeatherAPI/InTouch chain. |
| AI/LLM query-understanding engine | **PARTIAL** | `rules/weather_rules.py::parse` is keyword matching, not an LLM intent engine. Sufficient for a prototype; be honest about it. |
| Scalable real-time ingestion | **PARTIAL** | Async FastAPI + in-process JSON cache. No queue, no worker, single-process state. |

### Suggested Technology Stack

| Suggested | Used? | Notes |
|---|---|---|
| Python / FastAPI | Yes | Core backend. |
| Node.js | Yes | Vite/React toolchain only. |
| WebSocket | **Backend only** | `/ws/warnings` implemented; frontend never connects. |
| WIS2.0 | **No** | `wis2_adapter.py` exists but `.env`'s `WIS2_BROKER` is **never read** — `config.py` does not define it, so the adapter always reports UNCONFIGURED. |
| MQTT | No | Not implemented. |
| LLMs | Yes | Groq (`qwen` model) via an OpenAI-compatible endpoint. |
| GIS tools | Yes | Hand-rolled haversine + ray-casting point-in-polygon in `gis_service.py`. |
| Weather APIs | Yes | Open-Meteo, OWM, SACHET, GDACS, WeatherAPI. |
| PostgreSQL / MongoDB | **No** | `DATABASE_URL` is read into config but **never used**; no DB driver installed. `migrations/001_init.sql` is orphaned. State lives in JSON files. |
| Docker | Yes | Two-stage `Dockerfile` + `render.yaml` + `docker-compose.yml`. |
| Kubernetes | No | Not needed for a prototype. |

### Evaluation Parameters — what the jury will score

| Parameter | Current standing | The work that moves it |
|---|---|---|
| Accuracy and relevance | Strong backend (validation + response validator). | Fix the frontend severity contradiction so the UI stops misreporting. |
| Response latency | Chat is fast. **Voice is 10–20 s.** | Never demo voice first; chat first, voice second. Keep spoken answers short. |
| Multilingual capability | Good in EN/HI/TE. | Finish the English-only strings; verify on device. |
| **UI and accessibility** | **Weakest area.** Built blind, never reviewed. | The full frontend redesign: icon-first, 2–3 second comprehension, real design review. |
| Scalability and innovation | Adequate for a prototype. | Don't over-invest here; be honest in the pitch. |
| Integration with real-time systems | Strong. | Keep the three modes honest: DEMO / IMD / HYBRID. |

---

## 4. The six demo risks, in the order they can hurt us

| # | Risk | Mitigation | Owner |
|---|---|---|---|
| 1 | **Demo reliability** — servers, WiFi, feeds, Groq, Sarvam must all work in the same five minutes. No recorded backup. | Screen-record one perfect run this week. If stage WiFi dies, play the video and narrate. | Team |
| 2 | **Nobody with eyes has approved the UI.** | One sitting with someone who has taste before adding more features. | Team |
| 3 | **Warnings story is thin when feeds are empty.** | Rehearse the red-alert refusal (Scenario B) **in DEMO mode** so it fires on demand regardless of live feeds. | Alerts agent |
| 4 | **Voice latency is unjudge-friendly.** | Chat first, voice second. Never lead with voice. | Team |
| 5 | **Mobile/PWA unproven.** | 20 minutes on any Android phone. Non-negotiable. | Team |
| 6 | **No end-to-end safety net.** | Freeze features 48 h out; rehearse only after that. Add the E2E guard below. | Team |

---

## 5. Standing rules for this project

1. **No commits until the user says OK.**
2. **Run backend and frontend and verify in the browser before declaring anything done.**
3. Every change is checked against §3 before it ships. Anything that can't be traced
   to a Key Feature or Evaluation Parameter gets cut.
4. The three data modes stay explicit and honest: **DEMO** (fixtures, labelled),
   **IMD** (official API, credential-gated — report unavailable honestly),
   **HYBRID** (Open-Meteo + OWM live multi-source).
5. The four non-negotiable product constraints in §2 are never traded away for
   convenience, speed, or a nicer-looking screen.
6. **The single regression guard to add:** render `HeroCard` and `AlertCenter` from
   the *same* fixture payload and assert they agree on severity. This is the test
   that would have caught the worst bug in the codebase.

---

## 6. Change log

| Date | Change | Reason |
|---|---|---|
| 2026-09-17 | File created from PS 26068. Compliance baseline established against the running app. | Establish the alignment gate. |
