# HUMAN INTERVENTION REQUIRED — what only you can do

Verified: 2026-09-16. Everything below is checked against the live code and live API tests.
Nothing here can be faked by the app — by design it reports UNCONFIGURED instead of inventing data.

## 1. Official emergency alert feed — `CAP_FEED_URL` ❗ needs a phone call / email

| | |
|---|---|
| Status | `UNCONFIGURED` — Alerts page shows the resilient network + community reports, but **no official CAP warnings** |
| Who to contact | NDMA (Sachet portal ops), your State Disaster Management Authority (e.g. APSDMA / TGSPDCL cell), or IMD WIS2 contact |
| What to ask for | A URL that returns **CAP 1.x XML or JSON** (Common Alerting Protocol feed) |
| What to give me | Just the URL. Put it in `weathergpt/.env` as `CAP_FEED_URL=https://...` and restart — the adapter, GIS intersection and Alert page are already built and waiting |
| Fallback if nobody grants access | The app stays honest: official section says "no official feed connected". Community reports + SOS still work |

## 2. Government rainfall records — `DATAGOV_API_KEY` + `DATAGOV_RESOURCE_ID` ❗ 5 minutes, self-serve (you were mid-way)

| | |
|---|---|
| Status | `UNCONFIGURED` |
| Steps | 1. https://data.gov.in → Register/Login. 2. **My Account → API** → generate key. 3. Open the dataset **"Daily District-wise Rainfall Data"** (Dept. of Water Resources, Jal Shakti — the one with 51,000+ API hits, updated 31/12/2025). 4. On its **API tab**, copy the `resource_id` from the sample URL (`…/resource/<THIS-PART>`) |
| Where it goes | `weathergpt/.env`: `DATAGOV_API_KEY=...` and `DATAGOV_RESOURCE_ID=...` |
| Verify | Restart → `GET /api/sources` → govdata flips `UNCONFIGURED → READY → LIVE` |

## 3. IMD official district warnings — no open machine-readable feed exists ❗ needs a decision

| | |
|---|---|
| Status | `IMD_BASE_URL` points at `mausam.imd.gov.in/api/v1`, which is **not a documented public API** — live calls fail and the app honestly reports the warning service as unavailable/limited |
| The reality | IMD still publishes district warnings as **PDFs / web bulletins, not a standard API** |
| Your options | **(a)** Use the SIH/government route to request IMD data access (best). **(b)** Subscribe to an authorised aggregator (RIMES, Skymet enterprise, Weather Route) and give me the endpoint + key. **(c)** Accept current behaviour: real observations/forecasts already work via Open-Meteo (LIVE); the official-warning layer stays honest-but-unavailable until (a)/(b) |
| Important | The fake "YELLOW Thunderstorm" demo warning was **removed** in this build. A warning now appears only when a real upstream source returns one |

## 4. Second-opinion panel — `OWM_API_KEY` ⏱ optional, 5 minutes

| | |
|---|---|
| Status | `READY` (adapter configured) but no key → disagree panel idle |
| Steps | https://openweathermap.org → Sign up → confirm email → **API keys** tab → copy default key (free: 60 calls/min) |
| Where it goes | `weathergpt/.env`: `OWM_API_KEY=...` |

## 5. Mic permission on user phones 📱 operational, not code

Server voice (Sarvam STT/TTS) is now wired into the website and verified. Browsers only allow the
microphone on **HTTPS** (or localhost). Before any real user trial on a VPS: put Caddy/nginx in front
for TLS. No key needed — this is just deployment config.

---

## Already resolved — nothing for you to do

| Item | Resolution |
|---|---|
| LLM never actually used | Fixed. Real calls now go to Groq. Your key was tested live — note Groq **retired `llama-3.3-70b`**; the app now uses **`qwen/qwen3.8-27b`** (tested OK with your key). Override anytime via `LLM_MODEL` in `.env` |
| Sarvam STT/TTS not used by the site | Fixed. Mic audio is now uploaded to the server endpoint (Sarvam `saarika:v2.5`), answers auto-speak via Sarvam `bulbul:v3` in your selected language. Round-trip verified: TTS→STT returned the exact test sentence |
| Language switch (EN/HI/TE) | Enforced server-side now — the LLM must answer in the selected language (verified in tests below) |
| Persona not affecting advisor | Fixed — fisherman/farmer/etc. now change the advisory text (and chat advice), with Telugu/Hindi versions |
| Dummy/duplicate alerts | Demo fixture path removed from the live pipeline; local stores cleaned; alerts page now shows only what real sources return |
