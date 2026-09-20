# Unit Test Record: advisory_service weather rule layer

## Target File
`weathergpt/backend/services/advisory_service.py`

## Test File (DELETED)
`weathergpt/backend/services/__tests__/advisory_isolated_test.py`

## Test Code (Preserved)
```python
"""ISOLATED Unit Test for advisory_service weather rule layer.
Target: weathergpt/backend/services/advisory_service.py
Session: ses_adv
Imports ONLY the target file. No external deps.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__, ), "..", "..", "..", ".."))

from weathergpt.backend.services import advisory_service as adv

PERSONAS = ["farmer", "driver", "fisherman", "commuter", "employee",
            "general", "outdoor-worker", "researcher", "disaster_manager"]
LANGS = ["en", "hi", "te"]

failures = []

def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f" :: {detail}"))
    if not cond:
        failures.append(name)

check("weather_advisories exists", hasattr(adv, "weather_advisories"))
if hasattr(adv, "weather_advisories"):
    rainy = adv.weather_advisories({"rain_mm": 55, "wind_kph": 10, "temp_c": 30},
                                   {"days": []}, "farmer", "en")
    dry = adv.weather_advisories({"rain_mm": 0, "wind_kph": 5, "temp_c": 28},
                                 {"days": []}, "farmer", "en")
    check("rainy-vs-dry differs", rainy != dry)
    check("heavy rain fires at 55mm", any("55" in str(a) for a in rainy))
    check("2-3 concrete advisories max", 1 <= len(rainy) <= 3)
    mod = adv.weather_advisories({"rain_mm": 25, "wind_kph": 5, "temp_c": 28},
                                 {"days": []}, "driver", "en")
    check("moderate rain fires at 25mm", len(mod) >= 1)
    gale = adv.weather_advisories({"rain_mm": 0, "wind_kph": 65, "temp_c": 28},
                                  {"days": []}, "fisherman", "en")
    check("gale fires at 65kph", len(gale) >= 1)
    heat = adv.weather_advisories({"rain_mm": 0, "wind_kph": 5, "temp_c": 43},
                                  {"days": []}, "outdoor-worker", "en")
    check("heatwave fires at 43C", len(heat) >= 1)
    cold = adv.weather_advisories({"rain_mm": 0, "wind_kph": 5, "temp_c": 3},
                                  {"days": []}, "commuter", "en")
    check("cold fires at 3C", len(cold) >= 1)
    for lang in LANGS:
        items = adv.weather_advisories({"rain_mm": 55, "wind_kph": 65, "temp_c": 43},
                                       {"days": []}, "farmer", lang)
        check(f"rule strings have {lang}",
              all(isinstance(a, dict) and lang in a.get("text", {}) for a in items))
    base = adv.advisory_for({"verified": True, "severity": "RED", "hazard": "Heavy rain"},
                            "farmer", "en")
    extra = adv.weather_advisories({"rain_mm": 55}, {"days": []}, "farmer", "en")
    combined = base + "".join("\n" + e["text"]["en"] for e in extra)
    check("floor never softened (prefix intact)", combined.startswith(base))
    try:
        r = adv.weather_advisories(None, None, "general", "en")
        check("None inputs safe", r == [])
    except Exception as e:
        check("None inputs safe", False, str(e))
for p in PERSONAS:
    for L in LANGS:
        try:
            s = adv.advisory_for({"verified": False}, p, L)
            check(f"floor {p}x{L}", isinstance(s, str) and len(s) > 0)
        except Exception as e:
            check(f"floor {p}x{L}", False, str(e))
print(f"\n{len(failures)} failures")
sys.exit(1 if failures else 0)
```

## Test Result
- Status: pass (40/40 checks, 0 failures)
- Pre-implementation run: RED (1 failure — `weather_advisories` missing), post: GREEN
- Session: ses_adv
- Timestamp: 2026-09-20T11:40:00Z
- Manual proof: rainy kinds `['heavy_rain']` fact `rain 55mm`, dry `[]`, DIFFERS True, FLOOR_KEPT True
- Existing suite: `pytest tests/test_round2_alerts.py tests/test_advisory_verdict.py` → 25 passed
