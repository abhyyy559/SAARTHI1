# Source Mode — IMD-first (single mode)

One mode, no switch. Since 2026-09-27 WeatherGPT runs in exactly one mode:
WeatherGPT is IMD-first. Demo mode and hybrid mode were removed; there is no mode switcher
in the UI and no `POST /api/mode` endpoint.

## The one weather chain

Current weather, forecast, and nowcast all follow the same chain:

```
IMD → Open-Meteo → OpenWeatherMap → file cache → UNAVAILABLE
```

Each source is tried in order. A source is skipped only when it fails or
returns nothing. The first source that answers wins, and its provenance is
reported honestly:

- IMD data is labelled `IMD` (LIVE when the key is configured and reachable).
- Open-Meteo data is labelled `Open-Meteo` — never presented as IMD.
- OpenWeatherMap data is labelled `OpenWeatherMap`.
- File-cache data is labelled `CACHED` with a `stale_note`
  ("Showing last retrieved information; may be outdated.").
- When every source fails and there is no cache, the endpoint reports
  `UNAVAILABLE` — never a fabricated number.

## The one warning chain

Warnings follow:

```
IMD → SACHET/CAP (+ commercial chain: InTouch → WeatherAPI → GDACS)
```

- IMD district warnings are tried first.
- SACHET/CAP (NDMA) is the official alert feed; it works without any key.
- The commercial chain (InTouch, WeatherAPI, GDACS) supplements where
  configured.
- A warning-source failure is **not** an all-clear: the verdict reports
  `UNKNOWN` / `confirmed: false` with "cannot confirm" language. Expired
  warnings never appear as active.

## Backend contract

- `config.current_source_mode()` always returns `"imd"`.
- `GET /api/mode` is read-only and always reports `mode: "imd"`,
  `demo_mode: false`, plus the `weather_chain` and `warning_chain`.
- `POST /api/mode` does not exist.
- `config.DEMO_MODE` defaults to `false` (env `DEMO_MODE`). When `true`, the
  chat answers from labelled fixtures, for offline rehearsals only. It used to
  be hardcoded `true`, which made chat report a fixture "IMD YELLOW
  Thunderstorm" that no source had issued.
- SACHET is on by default (`config.DEFAULT_CAP_FEED_URLS`). When IMD is not
  reachable but SACHET answered live with nothing for the district, the
  verdict is `LOW` and names what was checked: `checked_sources:
  ["NDMA-SACHET"]`, `unchecked_sources: ["IMD"]`. Only when no source
  answered is it `UNKNOWN`.

## Provenance honesty

- `LIVE`, `CACHED`, `UNCONFIGURED`, `UNKNOWN`, and "cannot verify" are the
  only source states. A source that was not reached is never labelled `LIVE`.
- IMD is `UNCONFIGURED` when `IMD_API_KEY` is absent (the key is IP-bound to
  the developer's machine). An unconfigured IMD is not an outage.
- Open-Meteo needs no key. OpenWeatherMap needs `OWM_API_KEY`.
- SACHET/CAP needs no key.
