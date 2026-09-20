# Work Log

## Active Sessions
- [ ] ses_telem (Worker): `weathergpt/backend/services/cache_service.py` + `push_service.py` + `api/ack.py` - in_progress
- [ ] ses_gate (Worker): `HUMAN_INTERVENTION.md` - done
- [x] ses_adv (Worker): `weathergpt/backend/services/advisory_service.py` - done
- [ ] ses_cov (Worker): `weathergpt/frontend-react/src/components/CoverageDashboard.jsx` + `SourceStatus.jsx` - in_progress (T3.3 S3.3.3-S3.3.4)
- [x] ses_ack32 (Worker): `weathergpt/backend/services/push_service.py` + `weathergpt/backend/api/ack.py` - done (T3.3 S3.3.1-S3.3.2)
- [ ] ses_resil (Worker): `weathergpt/backend/services/cache_service.py` + `offline.js` + `store.jsx` + `P2PDemo.jsx` - in_progress (T3.1+T3.2)
- [ ] ses_cov_check (Worker): CoverageDashboard gap check - done
- [ ] ses_t11 (Worker): T1.1 S1.1.1-S1.1.5 backend lifecycle + demo API - done
- [ ] ses_t11 (Worker): `weathergpt/backend/services/alert_service.py` + `demo_alert_store.py` + `api/demo_alerts.py` + `main.py` + `alert_watcher.py` - in_progress (T1.1 S1.1.1-S1.1.5 + T1.3 S1.3.1-S1.3.3)
- [x] ses_main (Worker): weathergpt/backend/main.py - done
- [ ] ses_t12 (Worker): T1.2 S1.2.1-S1.2.5 + T3.3 S3.3.1-S3.3.4 frontend wiring + ack telemetry - in_progress
- [x] ses_tts (Worker): `weathergpt/backend/utils/speak_sanitize.py` + `tts_provider.py` + `voice.py` + `ChatPanel.jsx` + `llm_service.py` + `chat.py` + `models/chat.py` - done

## File Status
| File | Action | Status | Session | Unit Test | Timestamp | Issue |
|------|--------|--------|---------|-----------|-----------|-------|
| weathergpt/backend/services/alert_service.py | MODIFY | done | ses_t11 | pass | 2026-09-20T12:00:00 | - |
| weathergpt/backend/services/demo_alert_store.py | CREATE | done | ses_t11 | pass | 2026-09-20T12:00:00 | - |
| weathergpt/backend/api/demo_alerts.py | CREATE | done | ses_t11 | pass | 2026-09-20T12:00:00 | - |
| weathergpt/backend/main.py | MODIFY | done | ses_t11 | pass | 2026-09-20T12:00:00 | - |
| weathergpt/backend/services/alert_watcher.py | MODIFY | done | ses_t11 | pass | 2026-09-20T12:00:00 | - |
| weathergpt/backend/services/push_service.py | MODIFY | pending | - | - | - | - |
| weathergpt/backend/api/ack.py | CREATE | pending | - | - | - | - |
| weathergpt/backend/services/cache_service.py | MODIFY | done | ses_resil | pass | 2026-09-20T06:28:00 | - |
| weathergpt/backend/services/advisory_service.py | MODIFY | done | ses_adv | pass | 2026-09-20T12:10:00 | - |
| weathergpt/backend/api/advisory.py | MODIFY | done | ses_adv | pass | 2026-09-20T12:10:00 | - |
| weathergpt/backend/api/chat.py | MODIFY | done | ses_adv | pass | 2026-09-20T12:10:00 | - |
| weathergpt/frontend-react/src/components/AdminPanel.jsx | CREATE | pending | - | - | - | - |
| weathergpt/frontend-react/src/components/NotificationCenter.jsx | CREATE | pending | - | - | - | - |
| weathergpt/frontend-react/src/components/AlertDetails.jsx | CREATE | pending | - | - | - | - |
| weathergpt/frontend-react/src/components/AlertCenter.jsx | MODIFY | pending | - | - | - | - |
| weathergpt/frontend-react/src/components/P2PDemo.jsx | MODIFY | done | ses_resil | pass | 2026-09-20T06:28:00 | - |
| weathergpt/frontend-react/src/notify.js | MODIFY | pending | - | - | - | - |
| weathergpt/frontend-react/src/alertWatch.js | MODIFY | pending | - | - | - | - |
| weathergpt/frontend-react/src/offline.js | MODIFY | done | ses_resil | pass | 2026-09-20T06:28:00 | - |
| weathergpt/frontend-react/src/store.jsx | MODIFY | done | ses_resil | pass | 2026-09-20T06:28:00 | - |
| weathergpt/frontend-react/src/api.js | MODIFY | pending | - | - | - | - |
| weathergpt/frontend-react/src/components/Advisor.jsx | CREATE | pending | - | - | - | - |
| weathergpt/frontend-react/src/components/CoverageDashboard.jsx | CREATE | pending | - | - | - | - |
| weathergpt/frontend-react/src/components/SourceStatus.jsx | CREATE | pending | - | - | - | - |
| HUMAN_INTERVENTION.md | MODIFY | done | ses_gate | pass | 2026-09-20T06:15:00 | - |
| weathergpt/backend/api/v1.py | FIX | done | ses_v1fix | pass | 2026-09-20T06:29:00 | - |
| weathergpt/backend/utils/speak_sanitize.py | CREATE | done | ses_tts | pass | 2026-09-20T12:32:00 | - |
| weathergpt/backend/adapters/tts_provider.py | MODIFY | done | ses_tts | pass | 2026-09-20T12:34:00 | - |
| weathergpt/backend/api/voice.py | MODIFY | done | ses_tts | pass | 2026-09-20T12:36:00 | - |
| weathergpt/frontend-react/src/components/ChatPanel.jsx | MODIFY | done | ses_tts | pass | 2026-09-20T12:48:00 | - |
| weathergpt/backend/services/llm_service.py | MODIFY | done | ses_tts | pass | 2026-09-20T12:37:00 | - |
| weathergpt/backend/models/chat.py | MODIFY | done | ses_tts | pass | 2026-09-20T12:39:00 | - |
| weathergpt/frontend-react/src/components/HowItWorks.jsx | CREATE | done | ses_tts | pass | 2026-09-20T13:00:00 | - |
| docs/project-qa.md | MODIFY | done | ses_tts | pass | 2026-09-20T13:15:00 | - |

## Pending Integration
(none yet - starts after PG-A API contract: demo_alerts + ack endpoints)

Planner: todo drafted for Round2

## Cleanup Pass (2026-09-20)
### Deleted (confirmed unreferenced)
| File | Status |
|------|--------|
| weathergpt/frontend-react/src/MapView.jsx | DELETED - no imports/references found |
| weathergpt/frontend-react/src/components/DataPanels.jsx | DELETED - no imports/references found |
| weathergpt/frontend-react/src/components/EvidencePanel.jsx | DELETED - no imports/references found |
| weathergpt/frontend-react/src/components/GapHero.jsx | DELETED - no imports/references found |
| weathergpt/frontend-react/src/components/Manager.jsx | DELETED - no imports/references found |
| weathergpt/frontend-react/src/components/MapPanel.jsx | DELETED - no imports/references found |
| weathergpt/frontend-react/src/components/Pipeline.jsx | DELETED - no imports/references found |
| weathergpt/frontend-react/src/components/RouteCheck.jsx | DELETED - no imports/references found |
| weathergpt/frontend-react/src/components/SafetyPanel.jsx | DELETED - no imports/references found |
| weathergpt/frontend-react/src/components/Situation.jsx | DELETED - no imports/references found |
| weathergpt/frontend-react/src/components/VoicePanel.jsx | DELETED - no imports/references found |
| claude-justworker-setup.sh | DELETED - confirmed in git status |
| claude-run.sh | DELETED - confirmed in git status |

### Kept (with reason)
| File | Reason |
|------|--------|
| .vscode/tasks.json | KEPT - useful dev tasks for backend/frontend startup |
| _gen_districts.py | KEPT - referenced by district generation pipeline |
| _tmp_districts.json | KEPT - 34MB district data file, likely used by services |
| alert_watch_state.json (root) | KEPT - data file used by alert watcher |
| delivery_ledger.json (root) | KEPT - data file used by delivery service |
| notification_log.json (root) | KEPT - data file used by notification service |
| weathergpt/alert_watch_state.json | KEPT - data file used by alert watcher |
| weathergpt/demo_alerts.json | KEPT - demo alert data |
| weathergpt/delivery_ledger.json | KEPT - delivery ledger data |
| weathergpt/notification_log.json | KEPT - notification log data |

### Test Evidence
- pytest weathergpt/tests/test_cap.py weathergpt/tests/test_risk.py weathergpt/tests/test_alert_gather.py: **23 passed**
- python -m py_compile on all 29 backend service/api/adapter files: **OK (no errors)**
- node --check on frontend .js files: **OK (no syntax errors)**
- Frontend unit tests (npm test): **15 passed**
- pytest weathergpt/tests/test_advisory_verdict.py weathergpt/tests/test_unknown_risk.py: **20 passed** (includes X-Resp-Ms verification)
- python -m py_compile weathergpt/backend/utils/speak_sanitize.py weathergpt/backend/adapters/tts_provider.py weathergpt/backend/api/voice.py weathergpt/backend/services/llm_service.py weathergpt/backend/api/chat.py weathergpt/backend/models/chat.py: **OK (no errors)**
- Frontend build (vite build): **OK**
