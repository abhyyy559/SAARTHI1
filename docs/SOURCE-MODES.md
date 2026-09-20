# Source Modes — DEMO / IMD / HYBRID

Three modes, one switch, and the mode is always visible on screen. This file is
the contract between the backend that selects sources and the UI that reports
which one is answering.

## Why three modes exist

The build has to survive a demo room where the official API is not answering.
That is not a hypothetical: `IMD_API_KEY` is credential-gated, so on most runs
IMD is `OFFLINE` while SACHET/CAP is live. Two modes (LIVE / DEMO) forced a
false choice between "pretend everything is official" and "show fixtures". Three
modes let the app say exactly which sources are carrying it.

| Mode | Weather (current / forecast) | Warnings | Use |
|---|---|---|---|
| `demo` | Fixtures, labelled `DEMO` | Fixtures, labelled `DEMO` | Rehearsal and stage fallback. Deterministic, works offline. |
| `imd` | IMD only | IMD + SACHET/CAP | Official-only. Shows the real state of official access, including its absence. |
| `hybrid` | IMD → Open-Meteo → OpenWeatherMap → cache | IMD → SACHET/CAP → InTouch → WeatherAPI → GDACS | Default live operation. Best coverage. |

The distinction that matters: in `imd`, an unreachable IMD is reported as
`UNAVAILABLE`. It is **never** silently backfilled with Open-Meteo, because that
would present a non-official number in a console whose whole claim is provenance.

## Backend contract

`config.SOURCE_MODE` is the single source of truth. `config.DEMO_MODE` remains a
plain boolean kept in sync on every change, because it is read at 15+ call sites
and rewriting them all is not worth the risk.

```
SOURCE_MODE = "demo" | "imd" | "hybrid"
DEMO_MODE   = (SOURCE_MODE == "demo")     # derived, always in sync
```

Environment: `SOURCE_MODE` wins; if unset it derives from the existing
`DEMO_MODE` boolean so old `.env` files keep working.

### `GET /api/mode`

```json
{
  "mode": "hybrid",
  "source_mode": "hybrid",
  "demo_mode": false,
  "weather_source": "IMD → Open-Meteo → OpenWeatherMap",
  "warnings_source": "IMD → SACHET/CAP → InTouch → WeatherAPI → GDACS",
  "available": { "demo": true, "imd": true, "hybrid": true }
}
```

### `POST /api/mode`

Body `{"mode": "demo" | "imd" | "hybrid"}`. `"live"` is accepted as a legacy
alias for `"hybrid"` so an older client cannot break the switch. Any other value
returns `{"ok": false, "error": ...}` with HTTP 200 (the existing shape — the UI
reads `ok`, not the status code).

Response is the same object as `GET /api/mode` plus `ok: true`.

In-memory only; a restart re-reads `.env`. This is a demo control, not persisted
state.

### `GET /api/health`

Adds `"source_mode"` alongside the existing `imd_adapter` and `demo_mode` keys.
Existing keys are not removed — `store.jsx` reads `demo_mode` from here.

## Frontend contract

`store.jsx` holds `sourceMode` (string) and keeps `demoMode` as a derived
boolean for the call sites that already read it. The banner offers three
buttons, not two, and the active one is `aria-pressed`.

The mode label must state which sources are actually carrying the answer, not
just name the mode. "HYBRID · IMD warnings + Open-Meteo weather" is honest;
"HYBRID" alone is a buzzword.

## Rules that do not change with mode

- Absence of data is never rendered as safety.
- Every fact keeps its provenance label (`LIVE` / `CACHED` / `DEMO` / `COMMUNITY`
  / `UNAVAILABLE`).
- Official severity is never recoloured or upgraded by the UI.
- A warning from a different district is context, never this district's verdict.

## Change log

- Created. Three modes specified; `demo_mode` kept as a derived boolean for
  back-compat with 15+ existing read sites.
