# Source Mode — IMD-first (single mode)

One mode, no switch. The backend answers every weather and warning request
from a fixed IMD-first chain with multi-source backfill:

```
weather:  IMD → Open-Meteo → OpenWeatherMap → cache
warnings: IMD → SACHET/CAP → cache
```

There is no demo mode, no hybrid mode, and no mode switcher in the UI. The
old `GET/POST /api/mode` endpoint is deleted; the frontend never asks which
mode it is in, because there is only one.

## Why one mode

The build used to carry three modes (demo / imd / hybrid) so a demo room could
run without official API access. That machinery is gone: the demo alert
fixtures, the `/api/demo/*` endpoints, the admin console, and the mode switch
were all removed on 2026-09-27. What remains is the honest single pipeline —
if IMD is unreachable, the provenance chip says so (`UNAVAILABLE`), or names
whichever backfill source actually carried the answer.

## Provenance rules (unchanged)

- Provenance always names the actual source that answered
  (`LIVE` / `CACHED` / `UNAVAILABLE` / `UNCONFIGURED` / `COMMUNITY`).
- Absence of data is never rendered as safety.
- A backfill source is never labelled as an official IMD alert: weather
  forecast ≠ official alert, and the source/authority travel with every fact.
- Official severity is never recoloured or upgraded by the UI.
- A warning from a different district is context, never this district's verdict.

## Change log

- 2026-09-27: collapsed to a single IMD-first mode. Removed `demo`, `hybrid`,
  the `/api/mode` endpoint, the `SOURCE_MODE` / `DEMO_MODE` / `IMD_ADAPTER`
  env vars, the admin console, and the mode switcher UI.
