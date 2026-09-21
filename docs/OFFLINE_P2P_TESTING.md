# Offline + P2P testing procedure

How to prove, on your own phone, that (a) the app loads with no network and
(b) the phone-to-phone relay demo works across two tabs. Takes ~10 minutes.

> Honesty rules for every step below: cached data always wears a **CACHED**
> (or STALE/EXPIRED) chip with a timestamp; data that could not be checked
> says **"Not checked yet"**; the relay always wears the **SIMULATED** stamp.
> If any screen shows a live-looking answer with no label, that is a bug —
> report it, do not demo past it.

## Setup (do once)

1. Open the app in your browser (production build — the service worker only
   registers there, never in `vite dev`).
2. Go to **Admin** → **Demo mode** → switch to **Demo**. (The relay endpoint
   is demo-gated; outside demo mode it answers 403.)
3. Still in Admin, tap a one-button scenario — **"Severe Thunderstorm
   Warning"** is the best one (it goes pre-alert → active → ended live).
4. Visit **Home**, **Alerts**, **Advisory** once each so the phone snapshots
   the data. Open **More → Offline & nearby** once too, so the service worker
   precaches the shell and the relay picker loads the demo alert.

## (a) DevTools offline test — does the shell load with no network?

1. Open DevTools → **Network** tab → set throttling to **Offline**.
2. Hard-reload the page (`Ctrl/Cmd+Shift+R`).
3. **Expect:** the app shell paints (nav, Home content) — NOT a browser
   "no internet" error page. The connection pill reads **Offline**.
4. Navigate to `/?view=offline` (type it in the address bar, Enter).
   **Expect:** the Offline & nearby panel renders from the precached shell.
5. **Expect honest labels:** every data card shows a **CACHED … checked Xm
   ago** chip, or **"Nothing saved yet"** where nothing was snapshotted.
   Alerts older than 60 min dim (STALE); older than 6 h grey out (EXPIRED).
   Nowhere — not even the verdict card — may show a fake all-clear.
6. Turn throttling back to **No throttling** and reload. The pill returns to
   **Online** and queued questions replay.

## (b) Built-in offline simulator — no DevTools needed

1. Online, go to **More → Offline & nearby**.
2. Tick **"Simulate offline"**. This cuts the network path *inside the app*
   (every API call throws) — your phone's Wi-Fi stays on.
3. **Expect:** the panel flips to its offline states — connectivity chip says
   Offline, queue replay disables, alert transitions evaluate "from saved
   data — could not re-check".
4. Ask a question from Home while simulated offline → it lands in **Waiting
   questions** with a **Queued** chip. Untick the simulator → it sends on
   reconnect and you get a **"Sent {n}"** note.

## (c) Two-tab P2P relay test — send in one tab, watch it arrive in the other

1. Stay in **demo mode**, network **on** (the demo relay goes through the
   backend's demo endpoint; it simulates the phone-to-phone hop).
2. Open the app in **two tabs** (same browser, same district), both on
   **More → Offline & nearby**.
3. In **Tab A**: pick the thunderstorm demo alert → **Relay alert**.
   **Expect:** hop animation idle → Relaying… → **Relayed**, and the
   **SIMULATED** stamp stays visible the whole time.
4. In **Tab B**: without touching anything, **expect** a *"Relay arrived
   from another tab."* note plus a new **SIMULATED relay delivered** entry
   in the **Relay log** (instant via cross-tab channel; the log also polls
   every 10 s as a fallback).
5. Tick **"Simulate a failed hop"** in Tab A and relay again.
   **Expect:** the hop animation stops at hop 2 with **Failed** — reported
   as a failure, never as a delivery that happened.
6. **Two devices (optional):** open the app on a second phone on the same
   Wi-Fi, same district, demo mode, Offline & nearby panel open. Relay from
   phone 1 → **expect** the entry in phone 2's Relay log within ~10 s
   (server-side log polling).

## (d) Expected honest states, at a glance

| Situation | What you must see |
|---|---|
| First-ever visit, no network | Shell still paints (precached); data areas say **"Nothing saved yet"**, never an all-clear |
| Cached alert < 60 min old | **CACHED · checked Xm ago** chip, normal colours |
| Cached alert 60 min – 6 h old | **STALE** chip, card dimmed |
| Cached alert > 6 h old | **EXPIRED**, card greyed out — never shown as active |
| Offline question asked | **Queued** chip; sends on reconnect with **"Sent {n}"** |
| Relay fired | **SIMULATED** stamp always on; hop states idle → sending → relayed/failed |
| New warning while offline | Explicit **"cannot check now"** wording — never an invented answer |

## Troubleshooting

- **Relay button missing / "Switch to demo mode":** the backend is not in
  demo mode. Admin → Demo mode → Demo (sets `DEMO_MODE` on the backend).
- **"No alerts to relay yet":** no demo alert exists. Admin → launch the
  thunderstorm scenario, then revisit the Offline & nearby panel once
  (it fetches + snapshots demo alerts when online).
- **Shell does not paint offline:** the service worker never took control —
  open the app once online, reload once, and check the panel's shell chip
  reads **"App shell saved for offline"**. In `vite dev` this never works
  (worker registers in production builds only).
- **Tab B sees nothing:** both tabs must be the same origin and the same
  district; the relay log polls every 10 s, so wait a beat before concluding.
