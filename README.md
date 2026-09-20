# WeatherGPT — Conversational Weather Intelligence for India

**SIH 2026 · Problem 26068 · MoES / IMD · Disaster Management**

WeatherGPT is a **verification and reasoning layer** between authoritative
meteorological sources and a human being — not a weather app. You ask in your
language (English, Hindi, Telugu; text or voice), it fetches from official
sources, validates every fact, and explains what it means for *you*
(farmer, fisherman, driver, general public) — with proof attached.

**The one rule:** the LLM is never the source of weather truth. It only
phrases, translates, and explains verified data.

## 60-second start

```bat
start-saarthi.bat   :: double-click: backend :8003 + frontend :5173
```

Then open **http://127.0.0.1:5173/**. If the app ever shows "unreachable"
everywhere, the servers died — re-run the bat file, wait 15 seconds,
refresh. Details: [docs/project-qa.md](docs/project-qa.md).

Manual start:

```powershell
cd weathergpt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
cd frontend-react; npm install; npm run dev
```

## How it works (one question)

```
You (text/voice, EN/HI/TE, persona + GPS/district)
 → Location resolution (haversine gazetteer, coastal flags)
 → Parallel fetch: Open-Meteo (forecast) + SACHET CAP (official alerts)
 → Validation (source, freshness, location, validity, completeness)
 → Risk engine (deterministic) → Advisory engine (persona, rule-based)
 → Evidence package (structured JSON — the LLM's ONLY input)
 → Grounded LLM (Groq) + response validator
 → Answer + source attribution + evidence panel
```

## Data sources (all keyless except where noted)

| Source | Role | Access |
|---|---|---|
| Open-Meteo | Primary weather + forecast | No key |
| SACHET NDMA CAP (TG + AP + national feeds) | Official alerts | No key |
| OWM | Cross-check | Key in `.env` |
| Sarvam AI | STT/TTS (IN languages) | Key in `.env` |
| Groq | Grounded LLM | Key in `.env` |
| IMD direct API | Blocked (registration + static IP + hourly JWT) | See jury Q&A |

IMD is tried first in every chain — the day credentials exist, it takes
over automatically with zero code changes. Provenance labels always name
the true source.

## Key safety behaviors

- YELLOW + "is there a red alert?" → *"No verified red alert found."*
- No data ≠ safe: unreachable services say so explicitly, per persona.
- Community reports are labelled COMMUNITY, rate-limited, never promoted.
- Cached facts carry CACHED + age; expired warnings render greyed-out,
  never active. Offline works with honest degradation.
- Severity (official) and risk (WeatherGPT) are visually distinct, always.

## Docs

- [docs/project-qa.md](docs/project-qa.md) — everything about the project, Q&A form
- [docs/jury-questions.md](docs/jury-questions.md) — anticipated jury questions + sharp answers
- [DEPLOY.md](DEPLOY.md) — Render + Vercel deployment

## Repo layout

```
weathergpt/
├── backend/            # FastAPI: api/, services/, adapters/, models/
├── frontend-react/     # Vite + React 19 PWA (no component library)
├── demo/fixtures/      # Labelled DEMO fixtures (DEMO_MODE=true)
└── tests/              # pytest suite (57 tests)
start-saarthi.bat       # local boot: backend :8003 + frontend :5173
```
