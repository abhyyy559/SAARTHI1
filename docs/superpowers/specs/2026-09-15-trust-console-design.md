# WeatherGPT Trust-Console Redesign — Spec (2026-09-15)

## 1. Problem / Gap
People do not lack weather apps; they lack trustworthy answers. Three apps give
three forecasts, AI chatbots invent red alerts, and official IMD warnings ship as
district codes / severity colours / English-only PDFs that citizens cannot act on.
Evaluators reject "another weather app" — so WeatherGPT is positioned and built as
the **verification layer between official data and humans**, and the frontend must
prove that in the first 30 seconds.

## 2. Goals (jury, 5–10 min live demo)
- G1: First screen communicates the gap, never a temperature hero card.
- G2: Every datum carries provenance: LIVE / CACHED / DEMO + named source.
- G3: Multi-source ingest visible: IMD + data.gov.in + NDMA-Sachet CAP.
- G4: Real STT/TTS provider wiring with automatic browser fallback + provider badge.
- G5: Live red-alert refusal + evidence inspector on stage without staging tricks.
- G6: All 20 existing tests keep passing; new tests for provenance/CAP/voice fallback.

## 3. Non-goals
- No DB/auth/subscriptions (rejected Approach C).
- No reskin-only (rejected Approach B).
- No fabricated "live" claims: fixture fallback is always labelled DEMO.

## 4. Architecture
```
IMD live attempt ─┐
data.gov.in ──────┼─▶ adapters/ ─▶ validation ─▶ risk ─▶ grounded answer + evidence
NDMA-Sachet CAP ──┘      │              (provenance label on every fact)
                         ▼
                   GET /api/sources (per-source LIVE/CACHED/DEMO status)

Voice: mic ─▶ stt_provider (Sarvam-compatible HTTP | browser fallback)
       answer ─▶ tts_provider (Sarvam-compatible HTTP | browser fallback)
```

### 4.1 New modules
- `backend/adapters/__init__.py` + `registry.py`: source registry, status snapshot.
- `backend/adapters/govdata_adapter.py`: data.gov.in keyed client
  (`api.data.gov.in/resource/{id}?api-key=…&format=json`), file cache, DEMO fixture
  `demo/fixtures/govdata_rainfall.json` when key/offline.
- `backend/adapters/cap_adapter.py`: CAP XML/JSON parser → normalized warnings;
  fixture `demo/fixtures/cap_alert.json`; never invents alerts.
- `backend/adapters/stt_provider.py`, `tts_provider.py`: provider interface
  (`transcribe(audio)->text`, `synthesize(text, lang)->audio`) + Sarvam-compatible
  HTTP implementation + `BROWSER_FALLBACK` marker when no key.
- `backend/api/sources.py`: `GET /api/sources` → [{name, status, detail}].
- Chat evidence entries gain `provenance` (source + LIVE/CACHED/DEMO).

### 4.2 Modified
- `backend/services/imd_service.py`: attempt-chain logging (live→gov→fixture),
  status surfaced to registry.
- `backend/api/voice.py`: real transcribe/synthesize via providers; 501-style
  honest fallback payload when unconfigured (frontend then uses Web Speech).
- `backend/api/chat.py`: attach provenance per evidence item.
- `backend/main.py`: mount sources router.

## 5. Frontend — Trust Console (not a weather app)
Sections in order:
1. **Gap hero**: "3 apps. 3 forecasts. 0 accountability." + conflicting-apps proof
   panel + one-line positioning ("the verification layer between official data
   and humans"). Source-status strip (IMD ● / Gov-data ● / CAP ● / STT ● / TTS ●).
2. **Live pipeline visualizer**: source chips → validation checks → risk → answer;
   lights up per query (driven by real API responses).
3. **Ask panel (chat)**: query box + persona + language + evidence inspector with
   per-fact provenance badges + "Why this answer?" toggle.
4. **Voice panel**: mic → visible STT transcript → answer → TTS replay; provider
   badge (e.g. "STT: Sarvam-live" or "STT: browser-fallback").
5. **Safety panel**: 5 × §50 guarantees + "Try: ask for a red alert" refusal demo.
6. Footer: DEMO/LIVE banner logic (amber DEMO MODE unless all sources LIVE).

i18n EN/HI/TE preserved. Dark console aesthetic; severity colours only inside
official-warning contexts, never as decoration.

## 6. Demo script — `demo/jury-script.md` (5 min)
0:00 gap statement · 0:30 conflicting-sources proof · 1:00 Telugu voice query,
watch pipeline · 3:00 evidence inspector + red-alert refusal · 4:00 safety + close.
Includes fallback lines if offline (fixture path) — no dead air.

## 7. Testing
- Keep 20/20 green (no behaviour change to validated paths).
- New: `tests/test_provenance.py` (every chat evidence item has source+label;
  no LIVE label on fixture data), `tests/test_cap.py` (parser incl. malformed +
  empty feed), `tests/test_voice.py` (unconfigured → honest fallback marker;
  configured-mock → provider path).

## 8. Risks / mitigations
- R1 data.gov.in key absent on stage → fixture path labelled DEMO. Mitigated.
- R2 STT/TTS key absent → browser Web Speech fallback + badge. Mitigated.
- R3 Offline venue → full fixture mode, banner honest. Mitigated.
- R4 Over-scope → adapters are thin readers; no DB/auth. Enforced.

## 9. Acceptance
- A1: Evaluator sees gap + provenance within 30 s of load.
- A2: `/api/sources` reflects reality under key-present and key-absent runs.
- A3: Red-alert probe refuses escalation live.
- A4: 20 old + new tests green. A5: jury script rehearsed end-to-end.
