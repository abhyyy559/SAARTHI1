# Mission: SAARTHI Round2 Alert-Resilience Prototype

## Scope lock (Round2, tomorrow morning)
- Alert-first. Demo mode carries the demo; live source modes untouched.
- RULE CHANGE: official alerts are PRE-AUTHORIZED (NDMA-SACHET CAP / IMD). No human-approval gate anywhere in code, docs, or UI. Auto-ingest and auto-notify.
- P0 must work live on stage: Demo/Admin alert panel, full lifecycle, notifications (pre-alert + active + ended), Notification Center, Alert Details, cloud+local cache, offline cached viewing, Advisory personas, ack telemetry + Authority Coverage Dashboard, P2P relay (SIMULATED-labelled), sync on reconnect, source status page.
- Sources: docs/WORKING-PLAN-demo-pass.md (7 demo workstreams), README.md. Confidence: HIGH.

## File manifest (files to touch)
| Action | File | Purpose |
|--------|------|---------|
| MODIFY | weathergpt/backend/services/alert_service.py | lifecycle states UPCOMING / PRE-ALERT / ACTIVE / UPDATED / EXTENDED / ENDED |
| CREATE | weathergpt/backend/services/demo_alert_store.py | demo alert CRUD + schedule + state machine |
| CREATE | weathergpt/backend/api/demo_alerts.py | Demo/Admin panel API |
| MODIFY | weathergpt/backend/main.py | mount demo_alerts + ack routers |
| MODIFY | weathergpt/backend/services/alert_watcher.py | watch demo store + CAP; emit pre-alert/active/ended |
| MODIFY | weathergpt/backend/services/push_service.py | ack/delivery telemetry fields |
| CREATE | weathergpt/backend/api/ack.py | ack + telemetry ingest + coverage aggregate |
| MODIFY | weathergpt/backend/services/cache_service.py | harden cloud cache (alert snapshot, TTL, hit counters) |
| MODIFY | weathergpt/backend/services/advisory_service.py | weather-grounded rule layer + 7-persona matrix |
| CREATE | weathergpt/frontend-react/src/components/AdminPanel.jsx | Demo/Admin alert panel UI |
| CREATE | weathergpt/frontend-react/src/components/NotificationCenter.jsx | Notification Center UI |
| CREATE | weathergpt/frontend-react/src/components/AlertDetails.jsx | Alert Details UI |
| MODIFY | weathergpt/frontend-react/src/components/AlertCenter.jsx | render lifecycle states, never re-derive severity |
| MODIFY | weathergpt/frontend-react/src/notify.js | pre-alert/active/ended OS notifications |
| MODIFY | weathergpt/frontend-react/src/alertWatch.js | lifecycle transition watcher |
| MODIFY | weathergpt/frontend-react/src/offline.js | cached viewing + CACHED chip |
| MODIFY | weathergpt/frontend-react/src/store.jsx | wire setSimOffline toggle + connection pill |
| MODIFY | weathergpt/frontend-react/src/api.js | demo/ack/coverage client + offline cut |
| CREATE | weathergpt/frontend-react/src/components/Advisor.jsx | Advisor view (7 personas) |
| MODIFY | weathergpt/frontend-react/src/components/P2PDemo.jsx | visible A→B→C relay, SIMULATED badge |
| CREATE | weathergpt/frontend-react/src/components/CoverageDashboard.jsx | Authority Coverage Dashboard |
| CREATE | weathergpt/frontend-react/src/components/SourceStatus.jsx | data source status page |
| MODIFY | HUMAN_INTERVENTION.md | remove approval-gate language |

## M1: Alert lifecycle + Demo control | status:in_progress
### T1.1: Backend demo alert API + lifecycle states | agent:Worker | parallel-group:1
- [x] S1.1.1: MODIFY `weathergpt/backend/services/alert_service.py` — lifecycle states UPCOMING→PRE-ALERT→ACTIVE→UPDATED/EXTENDED→ENDED (+CANCELLED terminal), VALID_TRANSITIONS + set_lifecycle() pure fn | file:weathergpt/backend/services/alert_service.py | size:M
- [x] S1.1.2: CREATE `weathergpt/backend/services/demo_alert_store.py` — JSON-file CRUD + schedule fields (title/hazard/severity/district/instruction/pre_alert_at/starts_at/ends_at/state/history[]) | file:weathergpt/backend/services/demo_alert_store.py | size:M
- [x] S1.1.3: CREATE `weathergpt/backend/api/demo_alerts.py` — demo-guarded router: POST/GET /api/demo/alerts, GET /api/demo/alerts/{id}, POST /api/demo/alerts/{id}/{action} (pre-alert|activate|update|extend|cancel|end) | file:weathergpt/backend/api/demo_alerts.py | size:M
- [x] S1.1.4: MODIFY `weathergpt/backend/main.py` — mount demo_alerts (+ack) routers | file:weathergpt/backend/main.py | size:S
- [x] S1.1.5: MODIFY `weathergpt/backend/services/alert_watcher.py` — watch demo store, broadcast pre-alert/active/ended via push_service immediately on explicit demo action | file:weathergpt/backend/services/alert_watcher.py | size:M

### T1.2: Frontend Admin panel + Notification Center + Alert Details | agent:Worker | depends:T1.1 | parallel-group:2
- [x] S1.2.1: CREATE `weathergpt/frontend-react/src/components/AdminPanel.jsx` — create/schedule/pre-alert/active/update/extend/cancel/end buttons wired to demo API contract | file:weathergpt/frontend-react/src/components/AdminPanel.jsx | size:M
- [x] S1.2.2: CREATE `weathergpt/frontend-react/src/components/NotificationCenter.jsx` — list pre-alert/active/ended, unread counts, EN/HI/TE strings | file:weathergpt/frontend-react/src/components/NotificationCenter.jsx | size:M
- [x] S1.2.3: CREATE `weathergpt/frontend-react/src/components/AlertDetails.jsx` — single-alert view (severity, instruction, validity, history timeline) | file:weathergpt/frontend-react/src/components/AlertDetails.jsx | size:M
- [x] S1.2.4: MODIFY `weathergpt/frontend-react/src/components/AlertCenter.jsx` — render lifecycle states, never re-derive severity | file:weathergpt/frontend-react/src/components/AlertCenter.jsx | size:S
- [ ] S1.2.5: MODIFY `weathergpt/frontend-react/src/api.js` + `notify.js` + `alertWatch.js` — demo/ack client, OS notify for 3 kinds, transition watcher | file:weathergpt/frontend-react/src/api.js | size:M
  - [ ] Add notificationsApi and offline mutation queue to api.js

### T1.3: Remove human-approval gate | agent:Worker | parallel-group:1
- [x] S1.3.1: MODIFY `HUMAN_INTERVENTION.md` — delete/replace approval-gate language with "Official alerts are pre-authorized (NDMA-SACHET CAP / IMD auto-ingest, no human gate)" | file:HUMAN_INTERVENTION.md | size:S
- [x] S1.3.2: Grep + clean docs/ + backend + frontend src for approval/authorize/pending-approval gates (keep honest UNCONFIGURED labels + auth==authentication) | size:S
- [x] S1.3.3: Verify no code path blocks alert publish behind approval; leave "official alerts pre-authorized" comment | size:S

## M2: Advisory fix | status:completed
### T2.1: Weather-grounded rule layer + 7-persona matrix (backend) | agent:Worker | parallel-group:1
- [x] S2.1.1: MODIFY `weathergpt/backend/services/advisory_service.py` — add weather_advisories(current, forecast, persona) rule layer (rain mm / wind kph / temp C thresholds, conservative, commented, never softens advisory_for) | file:weathergpt/backend/services/advisory_service.py | size:M
- [x] S2.1.2: Extend persona matrix to farmer/driver/fisherman/commuter/employee/general/outdoor-worker (+ keep researcher/disaster_manager), EN/HI/TE for every string | file:weathergpt/backend/services/advisory_service.py | size:M
- [x] S2.1.3: Wire rule layer into chat/advisory/v1 entry points (minimal diff, append results) + tests (rainy-vs-dry differs, floor never softened, persona×lang coverage) | size:S

### T2.2: Advisor view (frontend) | agent:Worker | depends:T2.1 | parallel-group:2
- [x] S2.2.1: CREATE `weathergpt/frontend-react/src/components/Advisor.jsx` — persona picker + grounded advice cards with source facts | file:weathergpt/frontend-react/src/components/Advisor.jsx | size:M
- [x] S2.2.2: Wire Advisor into App nav + store (persona state) + EN/HI/TE strings | file:weathergpt/frontend-react/src/store.jsx | size:S

## M3: Resilience | status:completed
### T3.1: Cloud cache + offline + sync | agent:Worker | parallel-group:1
- [x] S3.1.1: MODIFY `weathergpt/backend/services/cache_service.py` — alert-snapshot set/get with TTL (6h warnings pattern) + real hits/misses counters | file:weathergpt/backend/services/cache_service.py | size:M
- [x] S3.1.2: MODIFY `weathergpt/frontend-react/src/offline.js` — cached viewing, CACHED chip, stale/expired grey-out | file:weathergpt/frontend-react/src/offline.js | size:S
- [x] S3.1.3: MODIFY `weathergpt/frontend-react/src/store.jsx` — wire setSimOffline toggle + connection pill + sync-on-reconnect queue flush | file:weathergpt/frontend-react/src/store.jsx | size:S

### T3.2: P2P SIMULATED visible relay | agent:Worker | parallel-group:1
- [x] S3.2.1: MODIFY `weathergpt/frontend-react/src/components/P2PDemo.jsx` — visible A→B→C hop story, store-and-forward outbox, mandatory SIMULATED badge | file:weathergpt/frontend-react/src/components/P2PDemo.jsx | size:M

### T3.3: Ack telemetry + Coverage Dashboard + source status | agent:Worker | depends:T1.1 | parallel-group:2
- [x] S3.3.1: MODIFY `weathergpt/backend/services/push_service.py` — telemetry store (delivered/opened/acked/pending/offline/unreachable/P2P-relayed), never-raise discipline | file:weathergpt/backend/services/push_service.py | size:M
- [x] S3.3.2: CREATE `weathergpt/backend/api/ack.py` — POST /api/ack + GET /api/coverage?district= aggregate | file:weathergpt/backend/api/ack.py | size:M
- [x] S3.3.3: CREATE `weathergpt/frontend-react/src/components/CoverageDashboard.jsx` — counts + zone map | file:weathergpt/frontend-react/src/components/CoverageDashboard.jsx | size:M
- [x] S3.3.4: CREATE `weathergpt/frontend-react/src/components/SourceStatus.jsx` — SACHET/Open-Meteo/WIS2/IMD status page (honest UNCONFIGURED labels kept) | file:weathergpt/frontend-react/src/components/SourceStatus.jsx | size:S

## M4: Verification | status:pending
### T4.1: pytest + build + E2E | agent:Reviewer | depends:M1,M2,M3
- [x] S4.1.1: Run pytest weathergpt -q green (57+ new demo/ack/advisory tests) | size:S
- [x] S4.1.2: Run vite build + frontend tests green | size:S
- [x] S4.1.3: Browser E2E — Admin create→pre-alert→active→end shows 3 notifications; offline toggle shows cached card; P2P SIMULATED hops visible; coverage counts update | size:M
- [ ] S4.1.4: Mark verified leaves [x] + propagate parents only when ALL children verified | size:XS
