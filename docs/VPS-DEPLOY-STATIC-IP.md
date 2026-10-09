# SAARTHI — Deploy on a VPS with a static IP (IMD whitelist path)

> Correction (verified 2026-09-24): `rawhq` has NO free-forever tier.
> `npm view rawhq` says CPU from $9/mo, GPU from $304/mo. `npx rawhq types`
> shows cheapest raw-5/raw-2 at $9/mo with footer "Add a card, then deploy.
> Charged before the server starts." `raw deploy --help` has no raw-free
> type. `rawhq.io` lists $9/mo minimum. `raw billing` opens Stripe.
> Do NOT run `raw deploy --type raw-free` (does not exist). Do not submit an
> IMD form with an IP you do not own yet. Steps below work on ANY VPS with a
> dedicated static IPv4. No host is endorsed as free-no-card; none verified.

## 0. Why a VPS solves the IMD problem

IMD binds credentials to a static egress IPv4. Render/Railway/Fly free tiers
egress from shared rotating IPs, so a whitelist entry never sticks. A VPS has
one dedicated public IPv4: what you put in the IMD form is the egress IP.

```text
IMD API (whitelisted to YOUR_VPS_STATIC_IP)
    ^
VPS (this repo: FastAPI serves React dist, one container)
    ^
Users (PWA / browser, anywhere)
```

Bonus: a VPS does not sleep (no Render cold start).

## 1. What SAARTHI actually runs (not server.js + pm2)

| Layer | Reality in this repo |
|---|---|
| Backend | Python FastAPI backend/main.py, entry run.py (uvicorn backend.main:app) |
| Frontend | React Vite frontend-react/, dist served BY FastAPI (Dockerfile multi-stage) |
| Single container | Dockerfile builds React + FastAPI; compose runs ${WGPT_PORT:-8000}:8000 |
| Frontend API base | src/api.js reads VITE_API_URL baked at BUILD time; empty = same-origin |
| CORS | backend/main.py _cors_origins() = localhost + FRONTEND_ORIGINS env |
| IMD wiring | backend/config.py (IMD_API_KEY, IMD_BASE_URL, IMD_PATH_*, IMD_ADAPTER) |

So deploy with Docker Compose, NOT pm2 start server.js.

## 2. Provision the VPS (any provider)

1. One VM: 2 vCPU / 4 GB / 40 GB is plenty; Ubuntu 24.04 LTS.
2. Note its public IPv4 from dashboard, then confirm on-box in step 6.
3. Keep Render/Vercel live until VPS health passes.

## 3. First boot

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git ufw
sudo systemctl enable --now docker
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
git clone <your-repo-url> saarthi
cd saarthi
```

## 4. Configure env (server-side only, never committed)

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Minimum for IMD day:

```ini
DEMO_MODE=false
SOURCE_MODE=hybrid
IMD_ADAPTER=live
IMD_API_KEY=<hex portal key>
IMD_JWT=<portal access_token — gateway needs BOTH key (x-api-key) and JWT (Bearer)>
IMD_BASE_URL=https://api.imd.gov.in/api/v1
IMD_PATH_CURRENT=current_wx
IMD_PATH_FORECAST=cityforecastloc
IMD_PATH_WARNING=districtwarning
IMD_PATH_NOWCAST=districtnowcast
FRONTEND_ORIGINS=https://<your-frontend-host>
```

Key rows are IP-bound: the backend must egress from the exact IP on the key
row (e.g. 43.225.25.133). Verify on-box with `curl -4 -s ifconfig.me` — if it
doesn't match the portal row, IMD rejects even with a valid JWT. Dev laptops
on other IPs can never pass; run IMD calls from this box only.

Same-origin needs no FRONTEND_ORIGINS. See docs/IMD-KEY-ONBOARDING.md.

## 5. Run (one container serves API + PWA)

Do NOT set WGPT_PORT: the app must stay on the default host port 8000 and
Caddy owns 80/443 (it needs 80 free for the ACME challenge; proxying to
:8000 while the app binds :80 is a guaranteed 502).

```bash
docker compose up -d --build
for i in {1..60}; do
  if curl -sf http://localhost:8000/api/health >/dev/null; then
    echo "UP after ${i}0s"; break
  fi
  sleep 10
done
curl -s http://localhost:8000/api/sources | head -c 600; echo
```

Expect /api/health 200 ok. For HTTPS (mic/geo/PWA need secure context)
use Caddy `reverse_proxy 127.0.0.1:8000`.

## 6. Capture the static egress IP (this is the IMD field)

```bash
curl -4 -s ifconfig.me; echo
curl -4 -s ipinfo.io/ip; echo
```

Both must agree. That IPv4 goes in the IMD form.

## 7. Fill the IMD form (once, with the real IP)

Environment=Development, Server Name=SAARTHI-Backend-VPS,
Server OS=Linux Ubuntu 24.04, Public IP=<step 6 output>.
If the VM is ever replaced, re-run step 6 and re-submit.

## 8. If the frontend stays separate (Vercel/Render)

VITE_API_URL is build-time baked. Rebuild with
VITE_API_URL=https://<domain> then set FRONTEND_ORIGINS to the
frontend host and restart compose. Prefer same-origin container
build so CORS and mixed-content vanish. Never ship PWA on
http://<ip>:8000 long-term (insecure origin blocks mic/geo).

## 9. Flip to live IMD when the key arrives (no code change)

In .env on VPS: IMD_API_KEY=<key>, IMD_ADAPTER=live,
then docker compose up -d. Check /api/sources imd READY.
On 400/401 adjust IMD_PATH_* / IMD_AUTH_SCHEME in .env, restart.

## 10. Honest alternatives (no endorsement)

- Stay on Render + no key: Open-Meteo + SACHET CAP already run keyless;
  IMD stays UNCONFIGURED at /api/sources. Best zero-spend demo.
- Shared free proxies: rotating shared IPs, IMD may reject. Throwaway only.
- Tiny unknown free-VPS sites: wipe/oversell risk, no status page. Do not
  bet a jury demo on them; pay $9/mo for one month anywhere established
  or stay on Render.

## Checklist

- [ ] <backend>/api/health 200 ok
- [ ] /api/sources IMD UNCONFIGURED (no key) or READY (key set)
- [ ] ifconfig.me on VPS == IP submitted to IMD
- [ ] PWA over HTTPS; jury path from demo/jury-script.md rehearsed
- [ ] .env 600, never committed

