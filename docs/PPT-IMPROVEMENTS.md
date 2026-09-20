# PPT Content Improvements — SIH 2026 Idea Submission (Team Parallax)

**Rule followed:** format untouched. Only the written content changes.
Slide 3's architectural *diagram* change is a **proposal — needs your approval**
before anyone redraws it.

The single biggest content shift: the deck now says explicitly that the
**proposed solution (production)** uses the IMD API, while the **prototype**
runs on demo fixtures + Open-Meteo + SACHET CAP sample feed — **no IMD key
needed** (no Sunday access). This turns your constraint into a strength:
*"the architecture degrades honestly instead of pretending."*

---

## Slide 2 — PROBLEM (keep 3 blocks, sharper)

**Fragmented** *(keep, tighten)*
> Weather information is scattered across disconnected portals, bulletins,
> satellite products and forecast models. A fisherman must check four places
> before deciding whether to go to sea.

**Not Actionable** *(keep, add the hook)*
> Raw meteorological data doesn't translate into a decision. Last season an
> IMD "do not go to sea" alert existed — and the fishermen it was for never
> saw it. The warning existed. The people didn't.

**Not Conversational** *(keep)*
> Getting an answer means manually searching and cross-checking multiple
> sources — not simply asking a question in plain language, in your own language.

## Slide 3 — INNOVATION / UNIQUENESS (keep 3 blocks, sharpen)

**Trust-First AI** *(keep, tighten)*
> Every answer is grounded in a deterministic grounding layer with citations.
> The LLM explains the evidence — it never invents numbers, never changes a
> severity, never issues a warning on its own.

**Refuses Instead of Guessing** *(keep — this is your moat)*
> When data is stale or conflicting, WeatherGPT says so instead of guessing —
> the one thing most weather chatbots won't do. Absence of data is never shown
> as safety.

**Never Goes Silent** *(extend to P2P — your differentiator)*
> Falls back through a degradation ladder — cloud → cache → on-device rules →
> **phone-to-phone relay** — when connectivity drops. Severe weather knocks out
> networks exactly when warnings matter most; the alert still hops device to
> device with no internet.

## Slide 4 — TECHNICAL APPROACH

### Proposed architectural diagram (APPROVAL NEEDED before redrawing)

Current: `User input → Grounding Layer → Data Arbiter → LLM → Output translation`

Proposed:
```
User (text/voice) ──▶ Language layer (STT/TTS, Sarvam)
        │
        ▼
Data Arbiter ──▶ IMD API · Open-Meteo · WIS 2.0 · NDMA/SACHET CAP
 (freshness +      (production sources; prototype: demo fixtures
  authority)        + Open-Meteo + SACHET CAP sample — no IMD key needed)
        │
        ▼
Grounding layer (deterministic rules — NOT AI; owns every severity/verdict)
        │
        ▼
LLM — phrasing only, cited (never computes, never warns on its own)
        │
        ▼
Outputs: Text · Voice · Push · SMS · P2P relay
        │
        ▼
Offline ladder: cloud → cache → on-device rules → P2P → sync
```

### Tech stack (9 items — only items 5 and 7 change meaningfully)

1. **User interface** — PWA (Vite + React) — *unchanged*
2. **Backend & API layer** — Python + FastAPI — *unchanged*
3. **Language / voice** — Sarvam (STT + TTS)
4. **Arbiter & grounding layer** — Deterministic rules — not AI — *unchanged*
5. **Data & integration** — **Production:** IMD API + Open-Meteo + WIS 2.0 + NDMA CAP.
   **Prototype:** IMD-grade demo fixtures + Open-Meteo + SACHET CAP sample feed
   (IMD key unavailable — the adapter labels itself DEMO instead of pretending).
6. **LLM layer** — One adapter — phrasing only, cited — *unchanged*
7. **Data storage** — JSON (zero-infra demo) → PostgreSQL (`DATABASE_URL` set) —
   *reworded: we actually built the JSON→Postgres switch, not SQLite*
8. **Real-time delivery** — WebSocket + Web Push (VAPID) + P2P relay — *added P2P*
9. **Output channels** — Text | Voice | Push | SMS — *unchanged*

## Slide 5 — FEASIBILITY AND VIABILITY

**Feasibility** — keep the four, tighten wording:
- **Existing data infrastructure:** IMD, Open-Meteo, WIS 2.0, NDMA CAP and
  historical datasets provide every input — nothing needs building from scratch.
- **Offline-first design:** local cache + deterministic rules keep essential
  functions alive during connectivity loss.
- **Fallback-first build:** every risky piece (IMD key, WIS 2.0, voice, push)
  already has a labelled fallback decided in advance — one failed integration
  never stalls the build. *(This is literally what we did on Sunday.)*
- **Scalable architecture:** the JSON store runs the zero-infra demo; the API
  is stateless, so PostgreSQL and district-scale rollout is a config change
  (`DATABASE_URL`), not a redesign.

**Challenges → Strategies** — keep the four pairs, sharpen the strategy lines:
- Data reliability → *Multi-source validation by authority + freshness; refuses
  instead of guessing when evidence is bad.*
- Multilingual → *Regional-language text + TTS/voice for low-literacy users.*
- Trust in AI alerts → *Every number traces to a source; the LLM never owns one.*
- Unreliable connectivity → *Degradation ladder: cloud → cache → on-device
  rules → P2P relay → sync.*

## Slide 6 — IMPACT AND BENEFITS

Keep the table, add one row at the end:

| Metric | Existing | WeatherGPT | Improvement |
|---|---|---|---|
| *(existing 4 rows unchanged)* | | | |
| Offline resilience | Dead without network | Cached verdicts + P2P relay, honestly labelled | Warnings survive the disaster that causes them |

**National / Economic / Technical impact** — keep, add one line under Technical:
- *"Proven fallback-first: the prototype ran its full demo with zero IMD
  access — the architecture, not the API key, carries the trust."*

## Slide 7 — RESEARCH AND REFERENCES
Unchanged. (If the jury asks: MAUSAM paper grounds the agromet advisory need;
RAG paper grounds the cited-LLM pattern; Open-Meteo/WIS 2.0/NDMA are the live
feeds the arbiter normalizes.)
