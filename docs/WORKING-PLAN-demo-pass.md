# WORKING PLAN — demo-mode feature pass

Scope agreed with the user: **everything below lands in demo mode first.**
Nothing here changes the live source modes.

Written after inspecting the actual code, not from assumptions. Every "what I
found" line below was verified against the running app.

---

## What I found (evidence, before planning)

| Area | Reality today |
|---|---|
| **Offline mode** | Genuinely built — `offline.js` snapshots the last verified warning + observation, queues queries (cap 20), pre-caches emergency guidance, and `answerOffline()` refuses to invent new warnings. **But there is no way to trigger or see it.** `setSimOffline` exists in the store and is used by *nothing* in the UI. |
| **P2P** | Genuinely built — real Fernet seal/open, HMAC integrity, dedup, replay window, hop limit, store-and-forward outbox, `P2PTransport` interface with `LocalRelayTransport` and a `SimulatedTransport` that labels itself `SIMULATED`. **The UI exposes one button ("Demo relay")** — nothing shows the A→B→C hop story. |
| **Push notifications** | **Nothing exists.** No `Notification` usage anywhere. `vite-plugin-pwa` generates the service worker at build time and the config says *"Never hand-write the SW."* |
| **Advice mechanism** | `advisory_for()` is a **fixed template per persona**. It never reads the weather report — no rain, wind or temperature appears in the advice. That is the "not working" the user means: the advice is canned, not derived. |
| **LLM responses** | `SYSTEM_RULES` is ~30 lines of instruction and `max_tokens: 700`. The prompt actively invites long output and filler. |
| **NDMA alerts** | **They are arriving.** The feed returns 20 alerts; at 10:55 UTC **12 were still valid**, including RED and ORANGE. Telangana coverage is intermittent — one valid ORANGE named Rangareddy / Yadadri Bhuvanagiri / Nalgonda, and the rest covered other states. The earlier "no alerts" symptom was our matching, not the feed. |
| **GIS** | `haversine_km` does real work. `point_in_polygon` / `parse_circle` are correct but **inert** — 0 of 20 live alerts carry geometry. |
| **WIS 2.0** | `wis2_adapter.py` exists as a documented stub; `WIS2_BROKER` is never read from config, so it always reports UNCONFIGURED. |
| **Frontend** | Text-heavy in places (mode banner, source strip, evidence lines). Icons already exist in `icons.jsx`. |

---

## Workstream 1 — Push notifications (critical → safe)

**Goal:** a real OS notification when a warning starts for the user's district,
and a second one when it ends. Demo-driven, no push server.

**Why no server:** real Web Push needs a VAPID key pair, a subscription store and
a push service. That is not a demo-mode feature and would be dishonest to fake.
Instead we use the **Notifications API with a live in-app watcher**, which
produces a *genuine* operating-system notification.

**Changes**
1. `frontend-react/src/notify.js` (new) — permission handling, `notify(title, body, tag)`,
   de-duplication by `tag` so a 30s poll cannot spam, and a persisted "already
   told you" set in `localStorage`.
2. `frontend-react/src/useAlertWatcher.js` (new) — watches the verdict the app
   already fetches; fires **start** on transition into confirmed
   MODERATE/HIGH/CRITICAL, and **clear** on transition out of it.
3. A visible **bell toggle** in the top bar: off / on, with the OS permission
   state shown honestly ("blocked — enable in browser settings").
4. **Demo trigger** in demo mode: "Simulate RED alert" / "Simulate all-clear"
   buttons so the whole start→clear cycle can be shown without waiting for NDMA.
5. Strings in `en/hi/te` via the existing `strings/areas/` pattern.

**Verified by:** a headless browser run that grants notification permission,
fires both transitions, and asserts two distinct notifications were raised.

---

## Workstream 2 — Offline mode, made visible

**Goal:** a user can see offline mode work, and understand it without reading.

**Changes**
1. **Offline toggle** in the top bar (wires the already-existing `setSimOffline`).
   Turning it on must genuinely cut the network path — `api.js` already throws
   `OFFLINE (simulated)` when set, so this is real, not cosmetic.
2. **Offline banner** already exists; add an **icon-led status pill** (cloud-slash)
   instead of the current sentence.
3. **Cached-data cards**: when offline, each card shows a small clock + "saved
   2h ago" chip instead of a paragraph, and expired cached warnings grey out.
4. **Offline answer**: the chat already falls back to `answerOffline()`; make the
   reply render with a `CACHED` chip so it cannot be mistaken for live.
5. Strings for `en/hi/te`.

**Verified by:** browser run — toggle offline, confirm the warning still renders
with a stale chip, confirm a new-warning question returns "cannot verify offline".

---

## Workstream 3 — P2P demo, made visible

**Goal:** show the store-and-forward story, honestly labelled.

**Changes**
1. A **step diagram** (icons, minimal words): `You → Relay A → Relay B → Out`
   with the hop count lighting up as the simulated relay runs.
2. Wire the existing `POST /api/v1/emergency/simulate` to that diagram, showing
   the returned `simulated_hops: ["A","B","C"]`.
3. **A "SIMULATED" badge stays on the diagram at all times** — this is the
   honesty rule the backend already enforces, and the UI must not lose it.
4. Show the real properties that make it work, as icon chips: sealed (lock),
   tamper-proof (shield), hop limit (counter), queued offline (tray).
5. Collapse the existing emergency message-type grid behind a disclosure so this
   screen does not become a wall of buttons.

**Verified by:** browser run clicking through the relay and asserting the
SIMULATED label is present.

---

## Workstream 4 — Advice that reads the actual weather

**Goal:** fix "the advice mechanism is not working".

**Changes**
1. `advisory_service` gains a **rule-based, weather-grounded** layer that reads
   `current` + `forecast` (rainfall, wind, temperature) and the persona, and
   emits 2–3 concrete advisories. This runs whether or not the LLM is available.
2. Each advisory carries the **fact it came from** (e.g. "11.9 mm rain forecast")
   so it is checkable, not just asserted.
3. Keep `advisory_for()` as the safety floor — the weather layer adds to it and
   may never soften it.
4. Frontend: advisories become **icon + short line + optional detail**, matching
   the "understand it without reading" requirement.

**Verified by:** unit tests asserting advice changes when the forecast changes.

---

## Workstream 5 — Shorter LLM answers, no filler

**Changes**
1. Rewrite `SYSTEM_RULES`: cut it to the safety-critical constraints only. The
   long prose currently *causes* long answers.
2. Add explicit brevity: **lead sentence ≤ 20 words; ≤ 3 bullets; no preamble,
   no restating the question, no "here is what you should know".**
3. Lower `max_tokens` for chat, and add a post-check that trims on sentence
   boundaries if the model overshoots.
4. Ban the specific filler openers by name.

**Verified by:** compare answer lengths before/after on the same questions.

---

## Workstream 6 — Frontend: less text, more signal

**Changes**
1. **Top bar / mode banner**: replace the two long source sentences with icon +
   short label; full detail moves behind a tap.
2. **Evidence strip**: icons with values, not `SRC ... · LIVE` prose.
3. **Alerts cards**: severity as a large icon + colour, headline trimmed to one
   line with expand; "Expired" becomes a clock icon.
4. **Empty states**: icon + one short line.
5. Keep the existing accessibility work (aria labels, focus) intact — icons must
   always carry an `aria-label`, never be the only carrier of meaning.

**Verified by:** screenshots of all three views at phone width.

---

## Workstream 7 — Explain GIS and WIS 2.0 in the product

The user asked what these actually do here. Answer, in plain terms:

**GIS** — three jobs, only two of them real today:
1. **Which district am I in?** `haversine_km` picks the nearest district to a GPS
   fix. *Real and in use.*
2. **Does this warning cover me?** `point_in_polygon` / `parse_circle` test the
   user's coordinates against CAP geometry. *Correct but currently idle — no live
   alert carries geometry.*
3. **How far is the hazard?** used by the route-impact analysis. *Real and in use.*

The honest framing: today GIS is mostly **"where am I"**, not **"am I inside the
warning polygon"**, because the feed does not send polygons. District-name
matching is doing that work instead.

**WIS 2.0** — the WMO Information System 2.0 is the *publish/subscribe* layer for
official meteorological data (MQTT topics). Its role here is the **real-time push
ingestion path**: instead of polling an RSS file every few minutes, a broker
pushes new warnings the moment they are published. That is exactly the mechanism
the push-notification feature wants. Today `wis2_adapter.py` is a documented stub
reporting UNCONFIGURED, so the product polls CAP instead.

**Deliverable:** a short, icon-led "How this works" panel in the app (and a page
in `docs/`) that states plainly which of these are live and which are stubs. No
claim of a capability we do not have.

---

## Order of work

1. Push notifications *(highest user-visible value)*
2. Offline mode demo
3. P2P demo
4. Advice from the weather report
5. LLM brevity
6. Frontend simplification
7. GIS / WIS 2.0 explanation panel

Each workstream is finished — tests, build, and a browser check — before the next
starts. Demo mode throughout, per the instruction.

---

## Notes / decisions I need from you

- **Push notifications only work while the app is open** (a background tab is
  fine). True background push needs a push server and VAPID keys. I am treating
  that as out of scope for demo mode unless you say otherwise.
- **`vite.config.js` says "never hand-write the SW."** For notification clicks I
  would need a small custom service worker via `injectManifest`. I will avoid it
  unless you want click-through, and flag it rather than quietly breaking that rule.
- **IMD still has no API key**, so hybrid mode is CAP + Open-Meteo in practice.
  Unchanged by this plan.
