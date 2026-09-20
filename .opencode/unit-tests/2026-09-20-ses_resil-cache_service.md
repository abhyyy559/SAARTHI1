# Unit Test Record: cache_service.py (T3.1 S3.1.1)

## Target File
`weathergpt/backend/services/cache_service.py`

## Test Method (functional probe, no file created)
```python
from weathergpt.backend.services.cache_service import CacheService, ALERT_TTL
c = CacheService(path=':memory:'); c._data = {}; c._save = lambda: None
c.set_alert('Hyderabad', {'id': 'a1', 'title': 't'})
assert c.get_alert('Hyderabad') == {'id': 'a1', 'title': 't'}
assert c.get_alert('Nowhere') is None
s = c.stats()
assert s['hits'] == 1 and s['misses'] == 1
assert c.hit_rate_num() == '50%'
assert ALERT_TTL.total_seconds() == 6 * 3600
```

## Test Result
- Status: pass
- Output: `CACHE_FUNC_OK {'hits': 1, 'misses': 1, 'total': 2, 'hit_rate': 0.5} 50%`
- Session: ses_resil
- Timestamp: 2026-09-20T06:32:00
- Also: `python -m py_compile weathergpt/backend/services/cache_service.py` → CACHE_PY_OK
- Also: `node --check frontend-react/src/offline.js` → OFFLINE_JS_OK
  (store.jsx / P2PDemo.jsx are .jsx — node --check cannot parse JSX, expected; verified by grep + read instead)
```

## Frontend verification (by read + grep, no isolated test file)
- offline.js lines 43-80: saveAlertSnapshot/readAlertSnapshot/alertAgeMin/alertCacheStatus
  (CACHED chip + STALE >60min + EXPIRED >6h grey-out) — present
- store.jsx: setSimOffline (L93), syncTick (L99), flushQueueOnReconnect + clearQueue (L147-158),
  syncTick bump on reconnect (L177), connectionPill Online/Cached/Offline (L530-531) — present
- P2PDemo.jsx: hop story A→B→C (L38-40), outbox (L77-87), SIMULATED badge data-testid="p2p-simulated" (L44) — present
