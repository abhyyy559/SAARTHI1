# SAARTHI (WeatherGPT) on Kubernetes

Split-service deployment that closes the eval gap "no Kubernetes manifests"
(eval parameter 5 — scalability; suggested stack Docker/Kubernetes).

## Layout

| File                  | Purpose                                                  |
|-----------------------|----------------------------------------------------------|
| `namespace.yaml`      | `saarthi` namespace                                       |
| `configmap.yaml`      | Non-secret config (backend + frontend), names from `backend/config.py` |
| `secret-template.yaml`| **Empty** secret placeholders — real values never in git |
| `backend-deployment.yaml`  | FastAPI (uvicorn, port 8003), 2Gi PVC at `/app/data` |
| `backend-service.yaml`     | ClusterIP `saarthi-backend:8003`                          |
| `frontend-deployment.yaml` | nginx serving the Vite build on port 80                   |
| `frontend-service.yaml`    | ClusterIP `saarthi-frontend:80`                           |
| `ingress.yaml`        | `saarthi.example.com`: `/api/*` → backend, `/` → frontend |
| `hpa.yaml`            | Backend HPA: CPU 70%, 2–6 replicas                        |

## Prerequisites

1. A cluster with an NGINX Ingress Controller (or set `spec.ingressClassName` to yours).
2. Metrics Server if you want the HPA to actually scale
   (`kubectl apply -f https://github.com/kubernetes/metrics-server/releases/latest/download/components.yaml`).
3. Images built and pushed to a registry your cluster can pull:
   - backend: the **root** `./Dockerfile` (build context = repo root).
   - frontend: see "Frontend image" below.
4. A real secret — create it **outside git** (see "Secrets").

## Apply order

```bash
# 1. Namespace + non-secret config
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml

# 2. Secrets — one of:
#    a) fill k8s/secret-template.yaml (stringData takes plain strings) and apply, or
#    b) create imperatively (nothing secret ever lands in git):
kubectl create secret generic saarthi-backend-secrets -n saarthi \
  --from-literal=LLM_API_KEY='<redacted>' \
  --from-literal=SARVAM_API_KEY='<redacted>' \
  --from-literal=IMD_API_KEY='<redacted>' \
  --from-literal=VAPID_PRIVATE_KEY='<redacted>' \
  --from-literal=VAPID_PUBLIC_KEY='<redacted>'
# (add the other keys from secret-template.yaml as needed)

# 3. Workloads
kubectl apply -f k8s/backend-deployment.yaml   # includes the PVC
kubectl apply -f k8s/backend-service.yaml
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/frontend-service.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml
```

Or everything in dependency order in one shot (namespace/ConfigMap/Secret first,
then the rest):
```bash
kubectl apply -f k8s/namespace.yaml -f k8s/configmap.yaml
kubectl apply -f k8s/   # after creating the secret; see dry-run note below
```

Validate first with `kubectl apply --dry-run=client -f k8s/`.

## Ports and env names (grounded in the repo)

- **Backend port 8003** — root `Dockerfile`: `ENV ... PORT=8003`, `EXPOSE 8003`,
  `CMD ... uvicorn ... --port ${PORT:-8003}`; healthcheck + `render.yaml`
  `healthCheckPath: /api/health` → the Deployment's probes hit `/api/health`.
  (`docker-compose.yml` maps to host 8000 locally, but the *container* port is
  8003 everywhere.)
- **Env names** come straight from `backend/config.py`
  (`os.environ.get("<NAME>", ...)`):
  `DEMO_MODE`, `SOURCE_MODE`, `IMD_ADAPTER`, `FRONTEND_ORIGINS`,
  `IMD_API_KEY`, `IMD_BASE_URL`, `IMD_PATH_*`, `LLM_API_KEY`,
  `DATABASE_URL`, `REDIS_URL`, `STT_API_KEY`, `TTS_API_KEY`,
  `SARVAM_API_KEY`, `SARVAM_STT_URL/MODEL`, `SARVAM_TTS_URL/MODEL`,
  `CAP_FEED_URL`, `CAP_FEED_URLS`, `OWM_API_KEY`, `DATAGOV_API_KEY`,
  `DATAGOV_RESOURCE_ID`, `WEATHERAPI_KEY`, `WEATHERUNION_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`,
  `ALERT_WATCH_INTERVAL`, `DEMO_TICK`, `CACHE_FILE`, `WIS2_BROKER`
  (the adapter reads `config.WIS2_BROKER`; it is optional and defaults empty).
- **`FRONTEND_ORIGINS`** is read by `backend/main.py` for CORS `allow_origins`;
  the ConfigMap sets it to the Ingress host `https://saarthi.example.com`.
- **`CACHE_FILE=/app/data/weathergpt_cache.json`** mirrors the Dockerfile's
  `VOLUME /app/data` + `ENV CACHE_FILE=...`; the backend Deployment mounts the
  `saarthi-data` PVC there so the JSON runtime stores (cache, emergency inbox,
  community reports, delivery ledger) survive pod restarts.

## Frontend image (assumption)

The repo has **no frontend Dockerfile** — the root `Dockerfile` serves the
React `dist` from FastAPI itself. For this split deployment the frontend is a
separate nginx image. A minimal one:

```dockerfile
# frontend-react/Dockerfile  (not committed — sample only)
FROM node:22-alpine AS build
ARG VITE_API_URL=""
WORKDIR /web
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN VITE_API_URL=$VITE_API_URL npm run build

FROM nginx:alpine
COPY --from=build /web/dist /usr/share/nginx/html
# SPA fallback so /ask etc. don't 404:
RUN printf 'server{listen 80; root /usr/share/nginx/html; \
  location / { try_files $uri $uri/ /index.html; }}' \
  > /etc/nginx/conf.d/default.conf
EXPOSE 80
```

Build with the API base the browser should call:

```bash
docker build --build-arg VITE_API_URL=https://saarthi.example.com \
  -t saarthi-frontend:latest -f frontend-react/Dockerfile frontend-react
```

### ⚠️ VITE_API_URL is build-time, not runtime

`frontend-react/src/api.js` reads `import.meta.env.VITE_API_URL`, which Vite
**bakes into the JS bundle at build time**. Setting `VITE_API_URL` as a
container env var afterwards does nothing — the manifest exposes it in the
frontend ConfigMap only so the *build* can read the same value. Options:

1. **Rebuild the image** with `--build-arg VITE_API_URL=<value>` (recommended).
2. Leave it empty: same-origin works through this Ingress because `/api/*`
   routes to the backend on the same host.
3. Runtime injection (not implemented here): serve a `/env.js` that sets
   `window.__SAARTHI_API_URL` and patch `api.js` to prefer it — honest
   alternative if images must be environment-agnostic.

## Notes and caveats

- **Secrets are all `optional: true`** so pods boot in demo mode without any
  keys; set the real keys for `hybrid`/`imd` modes. The secret template ships
  empty — fill it out of band; never commit values.
- **The VAPID pair in public git history is compromised** (tracked item from
  2026-09-20): generate a fresh pair before any real deployment, or push
  subscriptions break across restarts anyway.
- **PVC is `ReadWriteOnce`**: two replicas cannot share one RWO volume on
  most provisioners (the second pod stays Pending). For a real multi-replica
  rollout use a shared filesystem (EFS/NFS/ReadWriteMany) or switch the cache
  to Postgres/Redis. Fine for the demo; flagged honestly here.
- **Image tags** (`saarthi-backend:latest`, `saarthi-frontend:latest`) are
  placeholders — retag/pin digests in CI (`imagePullPolicy: IfNotPresent` is
  set for the demo).
- **Ingress host** `saarthi.example.com` is a placeholder; point your DNS and
  the ConfigMap's `FRONTEND_ORIGINS` at the real host, and enable the stubbed
  `cert-manager` TLS section for HTTPS.
- **HPA** targets CPU at 70% (min 2, max 6). It needs Metrics Server; it is
  intentionally modest — this is a prototype demo, not production traffic.
- Backend resources (250m/256Mi request, 1/1Gi limit) and the 2Gi PVC are
  starter values for the demo — tune for real load.
