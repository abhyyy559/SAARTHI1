# WeatherGPT — Production & API-Key Guide

## 0. Persistent storage (DATABASE_URL) — Round 2

Every store that must survive a deploy or restart now goes through one layer
(`weathergpt/backend/services/db.py`):

| Store | Survives a redeploy? |
|---|---|
| Demo alerts (Admin panel) | with DATABASE_URL: yes |
| Notification log (Notification Center) | yes |
| Delivery ledger + coverage | yes |
| Push subscriptions | yes |
| Watcher state (notify-exactly-once) | yes |
| VAPID keys | file/env — pin `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY` for multi-instance |

- **`DATABASE_URL` unset** (today's default) -> JSON files beside the cache.
  Fine for a laptop demo; **wiped on Render/Vercel redeploy**.
- **`DATABASE_URL` set** -> PostgreSQL via `asyncpg`. Tables (`saarthi_kv`,
  `saarthi_docs`, `saarthi_log`) auto-create on first use — no migration step.
  If Postgres is unreachable at runtime, stores degrade to JSON with a one-time
  warning; the API never 500s because of the database.
- **Render free tier:** create a PostgreSQL instance, copy the *Internal
  Database URL* into the service env as `DATABASE_URL`, redeploy. Verify via
  `GET /api/v1/system/status` -> `"database": {"backend": "postgres", ...}`.
- The P2P relay store (`emergency_store.json`) stays file-based on purpose: it
  models device-local storage.

## 1. API keys: where they live, where to get them

All keys live in **`weathergpt/.env`** (server-side only — never commit, never ship
to the frontend). After adding a key, restart the server and check
`GET /api/sources`: the adapter flips from `UNCONFIGURED` to `LIVE`.

| Env var | Get it here | Steps | Unlocks |
|---|---|---|---|
| `OWM_API_KEY` | https://openweathermap.org → **Sign Up** (free) | Confirm email → **API keys** tab → copy default key (free tier: 60 calls/min) | Second-opinion disagree panel |
| `LLM_API_KEY` | https://console.groq.com → **API Keys** → Create key | Paste into `.env` (model defaults to `qwen/qwen3.8-27b`; override with `LLM_MODEL`) | Real conversational answers in EN/HI/TE — without it the app uses the rule-based template |
| `DATAGOV_API_KEY` | https://data.gov.in → **Register/Login** | **My Account → API** → Generate token | Official records |
| `DATAGOV_RESOURCE_ID` | same site | Search dataset (e.g. “IMD rainfall district”) → open it → **API** tab → copy the `resource_id` from the sample URL (`…/resource/<id>`) | Pairs with the key above |
| `SARVAM_API_KEY` | https://dashboard.sarvam.ai → **Sign up** | **API Keys** → create subscription key (check current free credits on the site) | Server Telugu/Hindi/English STT (`saarika`) + TTS (`bulbul`); without it the app uses browser voice + shows the fallback badge |
| `CAP_FEED_URL` | NDMA-Sachet ops centre / state emergency cell / IMD WIS2 discovery | Paste the CAP XML/JSON feed URL when issued | Live emergency alerts → GIS intersection |
| `EMERGENCY_KEY` | **already generated** in `.env` | Rotate anytime: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` | E2E encryption of emergency packets |

No key today? Everything real still works keyless (Open-Meteo, ERA5, NWP models, map).

## 2. Run production locally

```bash
# single container (builds React + FastAPI together)
docker compose up --build
# open http://localhost:8000  →  /api/sources should show LIVE where keys exist
# host already busy on 8000? pick another: WGPT_PORT=8010 docker compose up -d
```

## 3. Deploy (pick one)

- **VPS (simplest):** install Docker → copy repo + `.env` → `docker compose up -d --build` →
  reverse-proxy (nginx/Caddy) for HTTPS → `https://your-domain` to the published host port
  (`${WGPT_PORT:-8000}` → container 8000).
- **Render/Railway/Fly:** connect repo, set Dockerfile deploy, add env vars from `.env`
  in the dashboard (never commit them), expose container port 8000.
- **Cloud Run:** `gcloud run deploy --source .` with env vars set via `--set-env-vars`
  (container listens on `$PORT`).

HTTPS is mandatory in production (voice mic, geolocation and service workers
require secure contexts).

## 4. Production checklist

- [ ] `.env` filled, `DEMO_MODE=false`, file permissions `600`, never in git
      (`git check-ignore weathergpt/.env` must print the path)
- [ ] `/api/health` → 200, `/api/sources` honest, `/api/v1/system/status` → LIVE/LIMITED
- [ ] Logs show request IDs; errors return honest UNAVAILABLE, never stack traces
- [ ] `wgpt-data` volume backed up (cache JSON, emergency inbox, community reports)
- [ ] CORS tightened in `backend/main.py` if frontend is hosted separately
- [ ] Postgres+PostGIS migration applied from `migrations/001_init.sql` when traffic grows
- [ ] Jury path rehearsed from `demo/jury-script.md` on the deployed URL

## 5. Scaling notes

Stateless except three JSON stores (cache, emergency inbox, reports) — all keyed,
deduplicated and timestamped, so they migrate cleanly to Postgres (schema ready).
WebSocket + polling both supported; prefer polling behind cheap hosting.
