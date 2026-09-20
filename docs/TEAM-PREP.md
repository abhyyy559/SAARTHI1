# SAARTHI / WeatherGPT — Team Prep: Know Everything

**Team Parallax · SIH 2026 · Problem Statement 26068 · Disaster Management**

Read this once and you can explain every word in the PPT, every screen in the
prototype, and answer any jury question. Nothing here is bluff — if a line
says "ask Abhiram/agent", don't improvise it on stage.

---

## 1. The one-line pitch

**WeatherGPT (SAARTHI) is a conversational weather-safety assistant that
grounds every answer in official data, refuses to guess, and keeps delivering
alerts even when the internet dies.**

## 2. The secret sauce (your Round 1 hook — open with this)

While researching this project, the team discovered a **current warning telling
fishermen not to go to sea** — and the team itself was unaware of it. The
warning existed on an official portal, yet the people it was meant for may
never have seen it. There is no cyclone today — but *what if there were?*
SAARTHI exists for that gap: the warning must **reach** the person, in their
language, on their phone, even offline — not sit on a website.

Why it worked in Round 1: it's **real and checkable** (not "imagine
if…"), and it reframes the problem from *forecasting* to *last-mile delivery*.
Use it to open the PPT and the demo.

## 3. Every PPT slide, explained

### Slide 1 — Title
Facts only: PS 26068, "WeatherGPT: Conversational AI for Weather Forecasting,
Alerts, and Climate Information", theme Disaster Management, software category,
Team Parallax. Jury question bait: none — keep it clean.

### Slide 2 — Problem (Fragmented / Not Actionable / Not Conversational)
- **Fragmented:** IMD bulletins, portals, satellite products, models all live
  apart. A fisherman checks 4 places before deciding to sail.
- **Not Actionable:** raw data (rain %, °C) ≠ a decision ("don't spray, storm
  at 2 PM"). The unseen fisherman alert is the proof.
- **Not Conversational:** answers require manual search + cross-checking; you
  can't just *ask* in your own language.
- *Why 3 blocks:* the SIH format. Don't add a fourth.

### Slide 3 — Innovation (Trust-First AI / Refuses to Guess / Never Goes Silent)
- **Trust-First AI:** every answer carries citations to its source. The LLM is a
  *translator*, not a *decider*.
- **Refuses Instead of Guessing:** stale/conflicting data → the app says
  "not confirmed" instead of inventing. This is the moat — competitors guess.
- **Never Goes Silent:** degradation ladder cloud → cache → on-device rules →
  **P2P relay**. Disasters kill networks exactly when warnings matter.
- *Jury trap:* "Doesn't refusing make you useless?" → "A wrong alert in disaster
  management does as much harm as no alert. Refusing is the safe default; the
  ladder still delivers *something* (cached/P2P) instead of nothing."

### Slide 4 — Technical Approach
Pipeline: **User (text/voice) → Language layer → Data Arbiter → Grounding
layer → LLM (phrasing only) → Outputs (text/voice/push/SMS/P2P)**.
- **Data Arbiter** = freshness + authority check across sources. It decides
  *which source to believe*, deterministically.
- **Grounding layer** = hard rules, NOT AI. It owns every severity and verdict.
  The frontend is *forbidden* from deriving severity (tests enforce this).
- **LLM (Groq, `openai/gpt-oss-120b`)** = phrasing only. It never computes a
  number, never changes a severity, never issues a warning, never gives advice
  in chat (chat redirects to Advisory).
- **Production vs prototype (say this explicitly):** production uses the IMD
  API + WIS 2.0 + PostgreSQL. The prototype uses IMD-grade demo fixtures +
  Open-Meteo + SACHET CAP sample feed — **no IMD key** (unavailable Sunday).
  The adapter labels itself DEMO honestly. *"Trust is carried by the
  architecture, not the API key."*
- The **architectural diagram redraw** needs Abhiram's approval — don't present
  a new diagram until he signs off.

### Slide 5 — Feasibility
- Inputs already exist (IMD, Open-Meteo, WIS 2.0, NDMA CAP, historical data).
- Offline-first: cache + rules keep essentials alive.
- **Fallback-first:** every risky integration had a labelled fallback *before*
  we built it — the Sunday IMD-key situation is the live proof.
- Stateless API: JSON store (demo) → PostgreSQL is a `DATABASE_URL` config
  change, not a redesign.

### Slide 6 — Impact
Table rows: raw numbers → decision-ready advice; English-only → voice +
regional languages; passive app-open → proactive push/SMS; static lookup →
cited grounding layer; **dead offline → cached + P2P, honestly labelled**.
National: IMD bulletins + ICAR advisories in one conversational platform.
Economic: fewer crop/weather losses via earlier actionable advisories.
Technical: the grounding layer + cited LLM pattern scales pilot → district → state.

### Slide 7 — References
MAUSAM 2025 (agromet advisory evolution — the *need*), RAG/NeurIPS 2020
(cited-LLM pattern — the *method*), Open-Meteo / WIS 2.0 / NDMA CAP (the
*feeds*). If asked "did you read them": the MAUSAM paper documents how
agromet advisories cut crop losses — that's our economic-impact evidence.

---

## 4. The prototype: 4 hero features (demo these, in this order)

### A. Alert lifecycle (Admin → `?view=admin`)
One-tap scenarios (Thunderstorm/Hyderabad/ORANGE, Heatwave/Warangal/YELLOW,
Rain/Visakhapatnam/ORANGE, Cyclone/Kakinada/RED) auto-run:
**pre-alert (seconds) → active (~40s) → ended (~3 min)**. Or drive manually:
UPCOMING → PRE-ALERT → ACTIVE → UPDATED → EXTENDED → ENDED (CANCELLED off any
early state). Every transition fires the real pipeline: store → notify →
push → delivery ledger. **History** shows the timeline; **Reset demo** cleans up.

### B. Notifications (`?view=notifications`)
The whole lifecycle lands here with day-grouped timeline + unread markers +
unread badges on Home/nav. Three ways they get created: lifecycle transitions,
the 🔔 Resend button, auto-running scenarios. Works while the app is closed via
Web Push (VAPID).

### C. Offline survival
**Simulate-offline toggle** (cloud icon, topbar). Cached verdicts + 6h alert
snapshots still render, stamped **CACHED** — never presented as fresh. The
app literally narrates what it *can't* confirm.

### D. P2P relay (Alerts view → Emergency → 📡 P2P relay)
Phone-to-phone alert hop with a visible A→B→C story and a mandatory
**SIMULATED** badge (honesty — the jury respects it). Sealed/tamper-evident
envelope properties are shown as chips.

### Also working (don't demo deeply — they already work)
Conversational Ask (grounded, cited, redirects advice → Advisory), STT/TTS
voice (browser + Sarvam server), multilingual EN/HI/TE, Advisory personas,
Trust page (every source reports its own status verbatim), acknowledgement.

## 5. Database — what is stored, where (Abhiram asked)

**Everything durable goes through `backend/services/db.py` — one interface,
two backends:**
- `DATABASE_URL` **set** → PostgreSQL (survives deploys/restarts/multi-worker;
  tables auto-create).
- `DATABASE_URL` **unset** → JSON files (zero-infra; the hackathon default).

**Stored:** demo alerts + their full history, notification log, delivery
ledger (who got what, when, by which channel), push subscriptions, community
reports, watcher state. **Cached (not durable):** weather (30 min), forecast
(3 h), warnings + alert snapshots (6 h) — memory + JSON file.

So: **yes, everything is stored.** On the demo laptop it's JSON files; on
Render + a Postgres URL it's a real database with zero code changes.

## 6. Tech stack in one breath

**Frontend:** React + Vite PWA (EN/HI/TE, light/dark, mobile-first, service
worker). **Backend:** Python + FastAPI. **AI:** Groq `openai/gpt-oss-120b`,
phrasing-only, cited. **Voice:** browser STT/TTS with Sarvam server fallback.
**Data:** IMD API (production), Open-Meteo (keyless), SACHET/NDMA CAP feeds,
WIS 2.0 (production). **Real-time:** WebSocket + Web Push (VAPID). **Storage:**
JSON → PostgreSQL via `DATABASE_URL`. **P2P:** store-and-forward relay
(simulated badge in prototype).

## 7. Jury Q&A — likely questions, safe answers

**"Why not just use the IMD app?"** → "The IMD app publishes; it doesn't
reach. Our gap is last-mile: conversational, multilingual, proactive push,
offline, P2P. The fisherman story is the proof."

**"What if the LLM hallucinates a warning?"** → "It structurally can't. The
LLM never sees raw authority — the grounding layer computes the verdict and
severity first; the LLM only phrases it with citations. Severity derivation in
the frontend is forbidden and test-enforced. And chat refuses to give advice —
it redirects to Advisory."

**"Your prototype has no IMD key — is it fake?"** → "No. The prototype uses
IMD-grade demo fixtures + Open-Meteo + a SACHET CAP sample, and every adapter
labels itself DEMO. The production design adds the IMD API. We'd rather show
an honest DEMO badge than a fake LIVE one — that's the trust architecture."

**"How does P2P actually work?"** → "Store-and-forward: the alert is a sealed
envelope, phones relay it hop-by-hop with a hop limit, tamper-evident. The
prototype simulates the transport with a mandatory SIMULATED badge; the
protocol design (sealing, hop limit, outbox queue) is real."

**"What about scale — 10 lakh users?"** → "Stateless API behind the cache;
PostgreSQL via config change; push via VAPID/Web Push; CAP is already the
national alert format. District rollout is config, not redesign."

**"Why three languages only?"** → "EN/HI/TE cover the demo districts; the i18n
system requires exact key parity across languages (tests enforce it), so
adding a language is translation, not engineering."

**"What did YOU build vs AI?"** → "We directed every decision: the trust
architecture, the grounding rules, the fallback ladder, the demo choreography.
The agents executed under our review — every commit needed our approval plus
reviewer + tester passes." *(True: no commits without Abhiram's approval.)*

## 8. Glossary (say these right)
- **CAP** — Common Alerting Protocol: the standard XML format for public
  warnings (NDMA/SACHET use it).
- **IMD** — India Meteorological Department: the official warning authority.
- **WIS 2.0** — WMO's global data-sharing system (MQTT-based live feeds).
- **SACHET** — NDMA's alert dissemination portal (CAP source).
- **Grounding layer** — deterministic rules that turn data into verdicts.
- **Data Arbiter** — picks which source to trust (freshness + authority).
- **VAPID** — the key standard that lets servers send Web Push notifications.
- **P2P relay** — phone-to-phone alert forwarding without internet.
- **Degradation ladder** — cloud → cache → on-device rules → P2P → sync.
