# Codebase audit — WeatherGPT / SAARTHI

Date: 2026-09-17
Scope: `weathergpt/backend` (FastAPI) + `weathergpt/frontend-react` (React 19 PWA)

## Verified health

| Check | Result |
|---|---|
| `pytest -q` (backend) | **76 passed** |
| `oxlint` (frontend) | **0 warnings, 0 errors** on 30 files |
| `node --test tests/*.test.mjs` | **15 passed** — but not wired to any npm script |
| `.env` in git | Not tracked (correctly ignored) |
| Runtime stores in git | Not tracked (correctly ignored) |

Live configuration in `.env`: `DEMO_MODE=false`, `IMD_ADAPTER=live`, three SACHET CAP
feeds configured, `IMD_API_KEY` empty. Consequence: IMD always raises
`AdapterUnavailable`, weather falls through to Open-Meteo, and **all warnings come
from SACHET CAP only**. Every bug below is reachable in exactly this configuration.

---

## CRITICAL

### 1. Home shows "All clear" while official alerts are active
`HeroCard.jsx:92-99`, `:133-136`

`HeroCard` derives its state only from `warn.warning` (the IMD warning) and never
looks at `warn.cap_alerts`. Live `/api/v1/warnings` returns **no `status` field**
whenever CAP alerts exist (`weather.py:257-267`), so:

- `unavailable` evaluates to `false` (no `status`, no `warning`)
- `w = warn.warning` is `null` → `state = 'LOW'` → green band, verdict "All clear"
- `tag` renders `'NO ACTIVE WARNING'`

Meanwhile `AlertCenter.jsx:69` lists the same alerts at full severity.
**Reproduced end-to-end** with a probe: payload `{warning: null, cap_alerts: [ORANGE]}`
→ hero `LOW` / "NO ACTIVE WARNING", Alerts page → ORANGE "Danger" card.

### 2. "No active official warning" printed while the tag reads UNVERIFIED
`HeroCard.jsx:136`

```js
const hazardText = w ? `${w.hazard}…` : t(lang, 'homeNoWarning');
```

When the warning service is unreachable, `w` is `null`, so the hero prints
*"No active official warning for your district right now"* — directly contradicting
its own `UNVERIFIED` tag and "Checking" verdict. The correct string,
`homeUnavailable`, exists in all three languages and is never used here.
This also fires on first paint before `locReady`, so the default text for a
Hyderabad placeholder is an all-clear claim.

### 3. Unvalidated warnings rendered at full severity
`AlertCenter.jsx:70`

```js
if (warn?.warning) alerts.unshift({ ...warn.warning, headline: warn.warning.message, ... });
```

No check of `warn.verified.verified`. A warning the backend failed to validate
(stale, location mismatch, incomplete) still renders as an active "Danger" card,
while `HeroCard` correctly greys the same warning to `UNKNOWN`.

### 4. Chat's total-failure branch emits a false all-clear
`chat.py:157`

```js
advisory_for({"verified": False}, req.user_type, req.language)
```

The honest state is `{"verified": False, "warning_service": "unavailable"}`.
Verified by diffing both calls:

- what it passes → *"No active official warning was found for your area. Keep following regular weather updates."*
- what it should pass → *"The official warning service is unreachable right now — we cannot confirm whether a warning is active."*

The main answer in this branch correctly says no data could be retrieved, then the
advisory appended directly beneath it claims there is no warning.

---

## HIGH

| # | Location | Issue |
|---|---|---|
| 5 | `AlertCenter.jsx:62` | `useState(() => Date.now())` never updates. Expiry checks and countdowns freeze at mount; the component does not remount on `syncTick`. An expired alert keeps rendering as active. |
| 6 | `store.jsx:227-232` | `setDisaster(true)` with no `else setDisaster(false)` → DISASTER MODE banner is sticky for the session after a severe warning clears. |
| 7 | `store.jsx:304-305` | `conn = offline ? 'OFFLINE' : backendState` ignores `netState === 'reconnecting'`, so the top bar shows LIVE during a backend outage while the banner says "Reconnecting…". |
| 8 | `store.jsx:48, 91-93` | `demoMode` initialises `false` and `api.mode()`'s catch is empty → a demo or unreachable backend is permanently presented as "LIVE MODE — real sources". |
| 9 | `store.jsx:263-267` | `district: resolved.district \|\| 'Hyderabad'` with `source: 'gps'` — an invented district labelled as GPS-derived. |
| 10 | `ChatPanel.jsx:77-93` | Queue replay runs in a `[netState]`-only effect that captures a stale `ask` with `busy === false`; the `if (!busy) return` guard can never fire, so replayed queries race `setBusy`/`setLog`. |
| 11 | `views.jsx:44-57` + `App.jsx:9-13` | `TrustView` is exported but never imported, and `?view=trust` is accepted by `store.jsx:40` with no matching entry in `VIEWS` → silently renders Home with no nav item highlighted. |

---

## CONFLICTS AND DEAD CODE

**Dead configuration.** `.env` defines `IMD_CURRENT_WX_URL`, `IMD_DISTRICT_WARNING_URL`,
`IMD_CITY_FORECAST_URL`, `IMD_NOWCAST_URL`, `IMD_DISTRICT_RAINFALL_URL`,
`IMD_CITY_FORECAST_LOC_URL` — **zero references anywhere in `backend/`**.
`imd_service.py` builds every path from `IMD_BASE_URL` plus a hardcoded string.
Someone configured per-endpoint IMD URLs expecting them to take effect.

**Orphaned adapters.** `adapters/govdata_adapter.py` and `adapters/wis2_adapter.py`
are never imported by anything, yet `registry.py` and `/api/sources` surface their
status and `needs_keys` — advertising capabilities that cannot run.

**Persona mismatch.** `i18n.js:200` `PERSONAS` omits `disaster_manager`, while
`PERSONA_LABELS` (`:203`) and `PERSONA_QUESTIONS` (`:190`) include it. It can never
be selected, and a stored value renders a blank `<select>`.

**Orphaned tests.** Five frontend test files exist and pass, but `package.json`
has no `test` script (`dev`/`build`/`lint`/`preview` only). Nothing runs them in CI.
They also only unit-test `format.js` and `api.js` — no component renders — which is
precisely why bugs 1-3 slipped through.

**Brand split.** `t()` checks `EXTRA` before `S` (`i18n.js:198`), so `viewAsk`
resolves to "Ask SAARTHI", while the sidebar, top bar, manifest and docs say
WeatherGPT.

**Untranslated safety surfaces.** `viewAlertsSub` (`i18n.js:29`) and `viewTrustSub`
(`:31`) exist only in English → Hindi/Telugu users get an English subtitle.
`Shell.jsx:165-166,195` (mode + disaster banners), `HeroCard.jsx:134-135` (severity
tags), and all of `Emergency.jsx` are hardcoded English.

**Provenance styling.** `AlertCenter.jsx:125` renders
`<span className="prov DEMO">COMMUNITY</span>` — community data wearing the DEMO
colour, and `.prov.COMMUNITY` is not defined in `styles.css`.

**Dead dependencies and CSS.** `main.jsx:4` imports `leaflet/dist/leaflet.css` and
`leaflet` is still in `package.json`, but no JS uses it (the map view was deleted).
`sw.js` is registered both manually (`main.jsx:19-25`) and by `vite-plugin-pwa`.
Unused CSS remains for `.map`, `.situation-grid`, `.pipe`, `.spark`, `.guarantees`,
`.tabs`, `.stat-grid`, `.sev`.

**Doc drift.** `README.md:82` and `docs/project-qa.md:87` both claim 57 tests;
the suite has 76.

---

## What is genuinely solid

- The backend safety architecture is disciplined: `response_validator.py` gates LLM
  output for invented severity, invented probabilities, unverified warning claims and
  fake government instructions; `validation_service.py` enforces source / freshness /
  location / validity / completeness before anything is called verified.
- The honesty fallbacks are real and multilingual — `_UNREACHABLE` in
  `advisory_service.py` correctly distinguishes "no warning" from "cannot check",
  and `RiskService` returns `UNKNOWN` rather than a guessed calm.
- `alert_sources.py` merges its multi-source chain instead of letting it suppress
  SACHET, and every provider failure is logged rather than faked.
- `report_service.py` bounds harm honestly (closed vocabulary, required text, rate
  limit, never auto-promoted to a warning).
- Secrets and runtime stores are correctly excluded from git and the Docker image.

The failure mode is consistent: **the backend gets honesty right and the frontend
loses it in the last mile.** Bugs 1-4 are all the same shape — a view deciding
severity from a subset of the payload the backend sent it.

---

## Recommended order of work

1. Fix bug 1 — make `HeroCard` derive its state from `cap_alerts` as well as
   `warning`, or have the backend emit an explicit `status` on every branch.
2. Fix bug 2 — branch on `unavailable` before choosing `hazardText`.
3. Fix bug 4 — pass the `warning_service: "unavailable"` dict in `chat.py:157`.
4. Fix bug 3 — gate the `unshift` on `warn.verified?.verified`.
5. Add a `test` script and a component test that renders `HeroCard` and
   `AlertCenter` from the same fixture payload and asserts they agree. This is the
   regression guard that would have caught 1-3.
6. Reconcile the `.env` IMD URL vars and delete or wire the orphaned adapters.
