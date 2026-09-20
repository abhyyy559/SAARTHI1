# WeatherGPT — Project Q&A

Everything about the project, in question form. For jury prep, see
[jury-questions.md](jury-questions.md).

## What is WeatherGPT?

A conversational verification-and-reasoning layer between authoritative
weather sources and Indian users. Not a weather app, not a ChatGPT
wrapper. Its proof-of-work is the evidence trail on every answer.

## Who is it for?

Farmers (crop advisories), fishermen (marine warnings), drivers (travel
risk), general public, and non-literate rural users (voice-first,
EN/HI/TE).

## Where does each answer come from?

1. **Forecast facts** (temp, rain, wind, condition) — Open-Meteo live,
   OWM cross-check, IMD first if credentials ever work. File cache last.
2. **Warnings** — SACHET NDMA CAP feeds (Telangana + Andhra + national),
   IMD district warnings attempted. Nothing else can create a warning.
3. **Advice** — deterministic rule templates per persona × language
   (`advisory_service.py`), plus a mandatory caveat for occupational
   personas. The LLM phrases and translates; it adds zero facts.
4. **Risk** — rule table (severity × exposure), labelled WEATHERGPT.

## Where do persona advisories come from — IMD/ICA bulletins?

No. Our advisories are **our own deterministic rules** grounded in
verified warnings + forecasts. We do not scrape IMD's agromet (AAS/AMFU)
bulletins today. Say this explicitly if asked — claiming otherwise
would be fabrication. Wiring agromet bulletins as a fifth source is
listed future work.

## What does the LLM receive?

Only the evidence-package JSON: user question, persona, language,
verified location/current/forecast/warning, risk, advisory,
available/missing fields, source names. No URLs, no fetching, no
recall. `response_validator.py` re-checks its output before delivery.
LLM down → structured fallback; the system keeps working.

## How does location work?

Browser GPS permission → backend GIS resolve (haversine gazetteer) →
district + coastal flag + actual coords kept for weather. Manual
district picker exists for testing. No silent defaults: ungated views
wait for `locStatus === 'ready'`.

## How do alerts reach the user?

Home hero verdict, Alerts tab (verified + state-level-nearby +
community + SOS), chat answers, voice replies. Offline: last verified
warning persists on-device with CACHED label and live expiry
countdown; expired renders greyed-out historical.

## How does P2P emergency messaging work?

SOS → Fernet-encrypted packet + HMAC signature → local relay store →
inbox shows peers → sync flushes outbox on reconnect. Relays see
ciphertext only. Simulated A→B→C relay exists for stage demo,
labelled SIMULATED. True phone-to-phone mesh is future work; the
crypto and protocol are real today.

## How are fake community reports handled?

Closed report-type vocabulary, required text, 5/hour per-reporter rate
limit, permanent COMMUNITY/USER-REPORT labels, never auto-promoted to
warnings. We bound harm; we do not claim to verify truth.

## What is the PWA story?

Vite PWA: installable, app-shell + i18n precached, buckets 2–4 in a
localStorage layer with TTLs and per-item expiry checks. No hand-written
service worker, no API runtime caching the UI didn't tag.

## How do I run it?

`start-saarthi.bat` (backend :8003 + frontend :5173), or manually per
README. `weathergpt/.env` holds keys (gitignored). `DEMO_MODE=true`
runs labelled fixtures.

## How do I verify it works?

Backend: `pytest tests/` (57 tests). Frontend: `npm run lint`,
`node --test tests/*.test.mjs`, `npm run build`. Live: `/api/health`,
then the money-shots — red-alert refusal, persona flip, Telugu voice,
expired-warning-greyed.

## Evaluation Parameters (Jury Mapping)

| Parameter | Implementation |
|---|---|
| **Accuracy & Relevance** | Single-source-of-truth `verdict_service`; provenance per fact (LIVE/CACHED/DEMO/UNAVAILABLE); response_validator re-checks LLM output against evidence. |
| **Response Latency** | `X-Resp-Ms` header on `/api/chat`; `max_tokens=400`; streaming TTS (Sarvam + browser fallback); offline cached answers instant. |
| **Multilingual Capability** | EN/HI/TE in advisory, chat answers, TTS (Sarvam `saarika:v2.5` STT / `bulbul:v3` TTS); language enforced server-side via `LANG_DIRECTIVE`. |
| **UI & Accessibility** | ARIA labels on all interactive elements; focus order preserved; colour-blind-safe severity palette (GREEN/YELLOW/ORANGE/RED); offline cached viewing with CACHED chip + stale/expired grey-out; text resizing respected. |
| **Scalability & Innovation** | Demo alert state machine (UPCOMING→PRE-ALERT→ACTIVE→UPDATED/EXTENDED→ENDED); P2P SIMULATED relay with store-and-forward + hop-limit; delivery ledger (DELIVERED/OPENED/ACKNOWLEDGED/PENDING/OFFLINE/UNREACHABLE/P2P_RELAYED); Authority Coverage Dashboard with zone map. |
| **Real-Time Meteorological Integration** | Open-Meteo live forecast/observations; SACHET NDMA CAP official alerts (Telangana/Andhra/National feeds); WIS 2.0 MQTT ingestion stub (UNCONFIGURED, architecture documented); IMD adapter attempted live, reports UNAVAILABLE honestly when down. |
| **Voice-Enabled Interaction for Rural Accessibility** | Server STT/TTS (Sarvam) + browser Web Speech API fallback; mic button on Home & Ask views; dictation mode fills input, user hits Send; answers auto-spoken in selected language; works on basic phones via browser speech. |
