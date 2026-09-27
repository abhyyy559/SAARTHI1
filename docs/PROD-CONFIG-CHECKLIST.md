# PROD-CONFIG-CHECKLIST.md

**One page: every env key Abhiram must set before the demo.** Exact names verified
against `backend/config.py`, `.env.example`, `render.yaml`, `docker-compose.yml`,
`vercel.json`, and `frontend-react` `VITE_*` usage on 2026-09-20. No real values —
fill the "set?" column, then keep this file for your own reference.

**Where each key goes:** backend keys → Render dashboard (service `saarthi-api`)
or repo-root `.env` for local/docker; frontend keys → Vercel project env
(`frontend-react/`). `render.yaml` has no `envVars` block — everything is set in
the Render dashboard (all `sync:false`, never committed).

| # | Key | Where | What it does | Default if unset | Set? |
|---|-----|-------|--------------|------------------|------|
| 1 | `SARVAM_API_KEY` | backend (Render) | Sarvam STT+TTS. `/api/voice/status` reports `sarvam-live` ONLY when this is set, else honest `browser-fallback`. STT model `saarika:v2.5`, TTS `bulbul:v3`, speaker `priya` | unset → browser fallback | ☐ |
| 2 | `LLM_API_KEY` | backend (Render) | Groq key. LLM stays a phrase/translate-only layer; without it chat runs on the grounded rule-based fallback | unset → fallback | ☐ |
| 3 | `LLM_MODEL` | backend (Render) | Model id. Code-validated against Groq's table; **must be `openai/gpt-oss-120b`** (default) | `openai/gpt-oss-120b` | ☐ |
| 4 | `CAP_FEED_URL` | backend (Render) | Official alerts feed (NDMA-SACHET / IMD CAP). Empty → CAP reports UNCONFIGURED honestly | unset → unconfigured | ☐ |
| 5 | `OWM_API_KEY` | backend (Render) | OpenWeatherMap — second-opinion forecast panel. Empty → that panel stays hidden | unset → hidden | ☐ |
| 6 | `IMD_API_KEY` | backend (Render) | IMD platform key (credential-gated; offices closed Sunday — backup plan) | unset → IMD unconfigured | ☐ |
| 7 | `IMD_BASE_URL` | backend (Render) | IMD API root. Default `https://mausam.imd.gov.in/api/v1` | default shown | ☐ |
| 8 | `IMD_PATH_CURRENT` / `IMD_PATH_FORECAST` / `IMD_PATH_WARNING` / `IMD_PATH_NOWCAST` | backend (Render) | IMD endpoint paths — the ONE unverified part of the IMD integration (defaults `current_wx`, `cityforecastloc`, `districtwarning`, `districtnowcast`) | defaults shown | ☐ |
| 9 | `DATAGOV_API_KEY` / `DATAGOV_RESOURCE_ID` | backend (Render) | data.gov.in source | unset → unconfigured | ☐ |
| 10 | `WEATHERAPI_KEY` / `WEATHERUNION_KEY` | backend (Render) | Free commercial sources in the official alert chain | unset → skipped | ☐ |
| 11 | `WIS2_BROKER` | backend (Render) | MQTT/WIS2 broker URL. The adapter reads this var; without it the layer reports UNCONFIGURED honestly — never simulates live | unset → unconfigured | ☐ |
| 12 | `DATABASE_URL` | backend (Render) | Postgres via asyncpg. Without it the app runs on the JSON-file fallback (hosted state does NOT survive restart) | unset → JSON fallback | ☐ |
| 13 | `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` | backend (Render) | Web Push. **ROTATE** — a VAPID private key is exposed in public git history (`vapid_keys.json`) | unset → push off | ☐ |
| 14 | `EMERGENCY_KEY` | backend (Render) | Fernet-format key for encrypted SOS queue; unset → ephemeral per-process key (documented) | unset → ephemeral | ☐ |
| 15 | `DEMO_MODE` | backend (Render) | Legacy boolean; `SOURCE_MODE` wins when set. `true` = fixture run (DEMO), `false` = live backends. Abhiram's standing ops plan: **`true` on Render** for the rehearsed run | per your call | ☐ |
| 16 | `SOURCE_MODE` / `IMD_ADAPTER` | backend (Render) | Explicit mode: `demo` / `imd` / `hybrid` (IMD-only never touches commercial sources). `SOURCE_MODE` wins over `DEMO_MODE`; unset + `DEMO_MODE=false` → `hybrid` | set explicitly | ☐ |
| 17 | `FRONTEND_ORIGINS` | backend (Render) | CORS allow-list, comma-separated — **must include the Vercel URL** (e.g. `https://saarthi.vercel.app`) | unset → CORS blocks the frontend | ☐ |
| 18 | `VITE_API_URL` | frontend (Vercel) | Backend base URL the app calls (`api.js` prefers this over `VITE_API_BASE`) | unset → relative/same-origin | ☐ |
| 19 | `VITE_ADMIN_PIN` | frontend (Vercel) | Team PIN for `?view=admin` (demo-grade gate, not authentication; default `26068`) | default `26068` | ☐ |

**Keys that exist but you do NOT need to set:** `STT_API_KEY`, `TTS_API_KEY` —
legacy vars in `config.py`, read by nothing; the voice path uses only
`SARVAM_API_KEY`. `REDIS_URL`, `VAPID_SUBJECT`, `DEMO_TICK`,
`ALERT_WATCH_INTERVAL`, `SARVAM_STT_URL/TTS_URL` — safe defaults already.

**Pre-demo sanity (5 minutes):** `GET /api/sources` → `needs_keys` all `false` for
your keys; `/api/voice/status` → `sarvam-live` (only with key 1 set);
`/weather/models` → WRF `UNCONFIGURED` (honest gap, expected); `?view=admin`
behind the PIN; WIS2 unconfigured. Clear `store/emergency_store.json` test SOS
entries before going on stage.
