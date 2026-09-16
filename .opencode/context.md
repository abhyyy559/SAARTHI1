# Project Context

## Environment (updated 2026-09-15 — WeatherGPT built)
- Language: Python 3.11.9
- Runtime: uvicorn + FastAPI, Pydantic v2, httpx
- Build: none (interpreted; py_compile verified)
- Test: plain python test scripts (tests/*.py, tests/safety/)
- Package Manager: pip (backend/requirements.txt)

## Project Type
- [x] Application (Web): WeatherGPT — FastAPI backend + vanilla JS/Leaflet frontend
- [ ] Library/Package
- [ ] Microservice
- [ ] Monorepo
- [ ] Other

## Infrastructure
- Container: None
- Orchestration: None
- CI/CD: None
- Cloud: None (local demo, port 8003)

## Structure (updated 2026-09-15)
- Source: weathergpt/backend/ (models, services, api, rules, utils, main.py, config.py)
- Frontend: weathergpt/frontend/ (index.html, app.js, styles.css, i18n.js)
- Tests: weathergpt/tests/ (test_imd_adapter, test_validation, test_risk, safety/test_safety)
- Docs: weathergpt/README.md, .env.example, demo/preview.html, demo/fixtures/*.json
- Entry: python -m uvicorn backend.main:app --port 8003 (from weathergpt/)

## Conventions (OBSERVED from WeatherGPT code, 2026-09-15)
- Naming: snake_case modules/functions, PascalCase Pydantic models
- Imports: relative intra-package (from .. import config, ..models.*)
- Error handling: adapter try/except → demo-fixture fallback; never hallucinate on outage
- Testing: plain python scripts with PASS prints, no pytest dependency
- Safety: IMD severity never mutated; WeatherGPT Risk separate + labelled; LLM never source of warnings

## Discovery Notes
- Root: .opencode/ (mission files), claude-justworker-setup.sh, claude-run.sh, weathergpt/
- weathergpt/: backend/ (19 py modules), frontend/ (4 files), tests/ (4 suites), demo/ (fixtures + preview.html), README.md, .env.example
- Live server: http://localhost:8003/ (demo mode), verified 2026-09-15

## Source
- Direct directory listing + fresh command evidence on 2026-09-15. Confidence: HIGH.
