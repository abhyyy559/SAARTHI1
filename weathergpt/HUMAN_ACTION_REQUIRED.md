# WeatherGPT — things that NEED A HUMAN (keys / access that I cannot obtain)

> Round2 rule (2026-09-19): **No human-authorization layer exists in SAARTHI.**
> Consumed alerts are already authorized upstream (IMD / NDMA-SACHET). Once a
> feed below is connected, its alerts ingest and notify automatically — nothing
> here is a per-alert approval step, and the demo panel covers every feed we do
> not yet have.

> Last updated: 2026-09-16. Everything not listed here works without any action.
> After completing any item below, restart the server and check `GET /api/sources`.

---

## 1. data.gov.in API key + resource ID — **REQUIRED for official rainfall records**

| | |
|---|---|
| Status today | `govdata` adapter shows **UNCONFIGURED** in `/api/sources` |
| Where to get | https://data.gov.in → **Register/Login** → **My Account → API** → *Request API Key* (self-service, instant) |
| Which dataset | Pick **"Daily District-wise Rainfall Data"** (Dept. of Water Resources, Jal Shakti — the one with 51,000+ API hits). Open it → **API tab** → copy the `resource_id` from the sample URL (`…/resource/<RESOURCE_ID>`) |
| Paste into | `weathergpt/.env` → `DATAGOV_API_KEY=...` and `DATAGOV_RESOURCE_ID=...` |
| Verify | restart → `/api/sources` shows `govdata: READY → LIVE` after first successful call |

## 2. IMD official API credentials — **required for LIVE district warnings**

| | |
|---|---|
| Status today | `imd` adapter shows **OFFLINE** — the app now reports warnings as *unavailable* instead of showing demo alerts (fake YELLOW thunderstorm removed on purpose, per your request) |
| Why | IMD's platform API (`mausam.imd.gov.in/api/v1`) is credential-gated; there is no self-service key. Access comes via IMD data supply scheme / MoES channels |
| Action | Request credentials from IMD (RMC channels) **or** point `IMD_BASE_URL` to any compatible gateway you are given. Once issued: `IMD_API_KEY=...` in `.env` |
| Interim truth | Warnings section says "unavailable — we never guess". Open-Meteo current/forecast keep working (real, LIVE). The chat answers ground on those and clearly say no *official* warning could be retrieved |

## 3. CAP feed URL (NDMA Sachet / state emergency cell) — **required for live CAP alerts**

| | |
|---|---|
| Status today | `cap` adapter shows **UNCONFIGURED**; no fake CAP alerts are served anymore |
| Why | Common Alerting Protocol feeds are issued to authorised integrators by NDMA/state cells |
| Action | Paste the feed URL into `.env` → `CAP_FEED_URL=...` when you obtain it |

## 4. Sarvam AI free credits — **voice (STT/TTS) works now, but watch the quota**

| | |
|---|---|
| Status today | **Working** — verified live on 2026-09-16 (TTS made real audio; STT transcribed a TTS clip perfectly) |
| Action | Log in to https://dashboard.sarvam.ai occasionally and check remaining free credits. If calls start failing with 402/429, top up or wait for the quota window. No config change needed |

## 5. Groq (LLM) — **working; no action unless you want a specific model**

| | |
|---|---|
| Status today | **Working** — key verified live with model `qwen/qwen3.8-27b` (configured in `.env` as `LLM_MODEL`) |
| Notes | `llama-3.3-70b-versatile` no longer exists on Groq (404). `openai/gpt-oss-*` models return empty content on this account; `groq/compound-mini` browses the web — unsafe for a grounded app, deliberately not used |
| If you want another model | change `LLM_MODEL` in `.env` to any id from `GET https://api.groq.com/openai/v1/models` |

## 6. Production HTTPS — **required before real users / phone microphones**

| | |
|---|---|
| Status today | Local runs use `http://localhost` (mic allowed). Any phone/LAN/public host needs **HTTPS** or the browser blocks the microphone entirely |
| Action | Put the container behind nginx/Caddy with a certificate (see DEPLOY.md §3) |

## 7. Windows console rendering — **cosmetic only**

| | |
|---|---|
| Status today | PowerShell shows mojibake (â€”) for non-ASCII text in *console output only* |
| Action | Nothing — browsers render everything correctly. Optionally `chcp 65001` before running commands |

---

### Quick checklist after you add a key

1. Edit `weathergpt/.env`
2. `docker compose up -d` (or restart uvicorn)
3. `GET /api/sources` → the adapter flips UNCONFIGURED → LIVE
4. Ask the app a question in the UI and check the provenance strip
