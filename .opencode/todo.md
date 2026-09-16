# Mission: SAARTHI / WeatherGPT — full-stack build + E2E verification

## M1: Discovery | status: completed
### T1.1: Environment discovery | agent:Planner
- [x] S1.1.1: Map project layout (empty workspace confirmed) | size:S
- [x] S1.1.2: Document context.md | size:S

## M2: Mission-definition readiness | status: completed
### T2.1: Draft SAARTHI mission proposal (no code) | agent:Planner
- [x] S2.1.1: Write .opencode/mission-proposal.md capturing: empty-workspace facts, name-origin hypothesis (SAARTHI=guide/charioteer, clearly labeled HYPOTHESIS), 2-3 concrete project-type options with pros/cons, and explicit questions for the user. No source code, no implementation tasks. | size:S
- [x] S2.1.2: Update status.md progress line to reflect new structure | size:S

## M3: WeatherGPT full build + E2E retry | status: completed (2026-09-15, fresh verification)
### T3.1: Backend verification
- [x] S3.1.1: Compile all 19 backend modules — COMPILE OK
- [x] S3.1.2: Fixtures valid (5 JSON, IMD-like schema) — OK
### T3.2: API endpoints (live, port 8003, demo mode)
- [x] S3.2.1: /api/health → ok/demo — OK
- [x] S3.2.2: /api/weather/current → 28°C Cloudy — OK
- [x] S3.2.3: /api/weather/forecast → 7 days — OK
- [x] S3.2.4: /api/weather/warnings → YELLOW Thunderstorm, all validation PASS — OK
- [x] S3.2.5: /api/chat rain query → grounded + MODERATE/WEATHERGPT + YELLOW/IMD — OK
- [x] S3.2.6: /api/chat red-alert probe → stays YELLOW, refuses escalation — OK
- [x] S3.2.7: /api/location/resolve + /api/risk — OK
### T3.3: Test suites (20/20 pass)
- [x] S3.3.1: test_imd_adapter.py — 4/4 PASS
- [x] S3.3.2: test_validation.py — 6/6 PASS
- [x] S3.3.3: test_risk.py — 5/5 PASS
- [x] S3.3.4: tests/safety/test_safety.py — 5/5 PASS (§50 GREEN)
### T3.4: Frontend verification
- [x] S3.4.1: / → 200, contains WeatherGPT/chat/map/DEMO — OK
- [x] S3.4.2: app.js + styles.css + i18n.js → 200 — OK
- [x] S3.4.3: demo/preview.html exists (17KB, forecast/Leaflet/persona/evidence) — OK
### T3.5: Live browser demo
- [x] S3.5.1: Brave launched visible at http://localhost:8003/, process alive — OK
### T3.6: Mission files sync
- [x] S3.6.1: todo.md/status.md/context.md updated to WeatherGPT reality — OK
