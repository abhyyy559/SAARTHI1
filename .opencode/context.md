# Project Context

## Environment (updated 2026-09-19 - Round2 alert-resilience reality)
- Language: Python 3.11.9 (backend) + JavaScript/React 19 (frontend)
- Runtime: uvicorn + FastAPI, Pydantic v2, httpx, pywebpush, cryptography (Fernet)
- Frontend: React 19 + Vite 8 + vite-plugin-pwa, Leaflet, oxlint
- Ports: backend :8003, frontend :5173 (start-saarthi.bat launches both)
- Test: pytest weathergpt (57 tests) + node --test tests/*.test.mjs (frontend) + plain python safety scripts
- Package Managers: pip (weathergpt/backend/requirements.txt) + npm (frontend-react/package.json)
- Build: vite build (frontend); backend interpreted, no build step

## Project Type
- [x] Application (Web): SAARTHI / WeatherGPT - FastAPI backend + React Vite PWA frontend
- [ ] Library/Package
- [ ] Microservice
- [ ] Monorepo
- [ ] Other

## Infrastructure
- Container: Dockerfile + docker-compose.yml present (weathergpt:1.0, optional Postgres+PostGIS path)
- Orchestration: None (local demo)
- CI/CD: None
- Cloud: None (local demo); Web Push needs HTTPS in prod (localhost exempt)

## Structure (updated 2026-09-19)
- Source: weathergpt/backend/ (adapters, api incl. v1/push/demo, services incl. alert_service/advisory_service/push_service/cache_service/emergency_service/alert_watcher, models, rules, utils, main.py, config.py)
- Frontend: weathergpt/frontend-react/src/ (App.jsx, store.jsx, api.js, notify.js, alertWatch.js, offline.js, components/AlertCenter/P2PDemo/Home/ChatPanel/Emergency, i18n + strings/areas en-hi-te)
- Tests: weathergpt/tests/ (pytest.ini) + frontend-react/tests/
- Docs: docs/WORKING-PLAN-demo-pass.md (7 demo workstreams), README.md, HUMAN_INTERVENTION.md (approval-gate language TO BE REMOVED per Round2 rule)
- Entry: backend uvicorn backend.main:app --port 8003; frontend vite dev --port 5173

## Conventions (OBSERVED from code)
- Naming: snake_case py modules/functions, PascalCase Pydantic models; camelCase JS, PascalCase React components
- Imports: relative intra-package backend (from .. import config); ES modules frontend
- Error handling: adapter try/except to demo-fixture fallback; push send_one never raises; watcher loop survives anything
- Safety rules: verdict decided once (verdict_service); AlertCenter renders, never re-derives; severity never upgraded; no warning invented offline; P2P SIMULATED badge mandatory; all-clear only on confirmed LOW
- Round2 rule: official alerts PRE-AUTHORIZED (NDMA-SACHET CAP / IMD auto-ingest, no human gate)

## Source
- Direct reads 2026-09-19: todo.md, context.md, WORKING-PLAN-demo-pass.md, cache_service.py, push_service.py, emergency_service.py, alert_watcher.py, AlertCenter.jsx, P2PDemo.jsx, notify.js, alertWatch.js, offline.js, store.jsx, advisory_service.py, package.json. Confidence: HIGH.
