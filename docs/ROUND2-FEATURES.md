# SAARTHI — Round 2 Prototype: Feature Description

**Positioning (say this to the jury, exactly):**
> SAARTHI doesn't replace India's authorized warning systems. It is an intelligent
> last-mile resilience layer that turns official alerts into personalized actions
> and tracks how effectively those warnings reach affected communities — even when
> connectivity becomes unreliable.

**Why no human-authorization layer:** every alert SAARTHI consumes is *already
authorized* — it was issued by IMD / NDMA-SACHET / an official state cell before
we ever saw it. SAARTHI ingests, interprets, personalizes, delivers and *tracks*
alerts. It does not re-approve them. The only human actions in the system are
issuing (upstream, official) and acknowledging (downstream, the citizen).

---

## 1. The core pipeline

```
DATA SOURCES
   Weather APIs (Open-Meteo chain)   Official alerts (SACHET/CAP when granted)   Demo/Admin panel
              └──────────────────────────┬──────────────────────────┘
                                       ↓
                              DATA INGESTION (adapters)
                                       ↓
                       VALIDATION + NORMALIZATION (provenance kept)
                                       ↓
                                  CLOUD CACHE
                                       ↓
                          ALERT ENGINE + STATE MACHINE
                        UPCOMING → PRE-ALERT → ACTIVE →
                             UPDATED/EXTENDED → ENDED
                                       ↓
                          IMPACT + RISK ANALYSIS (verdict)
                                       ↓
              ADVISORY ENGINE (one event → advice per user type)
                                       ↓
      DELIVERY MANAGER ──► PUSH (Web Push, closed app) ──► P2P RELAY (resilience)
                                       ↓
        NOTIFICATION LOG (lifecycle trail) + DELIVERY LEDGER (per device)
                                       ↓
                       AUTHORITY COVERAGE DASHBOARD
```

Both operating modes feed the **same** downstream pipeline — a demo alert and a
CAP alert are indistinguishable after ingestion except by their `source` label:

- **LIVE mode** — Open-Meteo weather chain + SACHET/CAP official alerts (the
  connector is built and waiting on `CAP_FEED_URL`; IMD joins as one more
  connector when API access arrives — no architecture change).
- **DEMO mode** — the Admin panel creates realistic alerts with the full
  lifecycle. Every button drives the real pipeline: state machine → push →
  notification log → delivery ledger.

---

## 2. Feature list (what is actually implemented)

### Citizen side

| # | Feature | What it does | Where it lives |
|---|---|---|---|
| 1 | **Home / Dashboard** | Current weather, active alert verdict, quick advisory, connection state, last sync. | `components/Home.jsx` |
| 2 | **Alert system with full lifecycle** | Pre-alert → Active → Updated/Extended → Ended notifications. Location-filtered, severity-aware, pushed while the app is closed (Web Push + VAPID), and auto-advanced by the scheduler. | `services/alert_watcher.py`, `services/alert_service.py` (state machine), `services/push_service.py` |
| 3 | **Notification Center** | Durable trail of everything SAARTHI sent — per-kind icons, read/unread per device, acknowledge button, listen aloud. | `components/NotificationCenter.jsx`, `services/notification_service.py`, `api/notifications.py` |
| 4 | **Alert Details / Alerts page** | Every official + demo alert with severity, validity window, instruction, source, community reports, SOS network. | `components/AlertCenter.jsx`, `components/Emergency.jsx` |
| 5 | **Advisor (functional)** | One weather event → different advice per user type: general, farmer, driver, fisherman, commuter, employee, outdoor worker, student, researcher, disaster manager. Grounded in the official verdict — never an LLM guess. Voice replay + "ask about this" per card. | `components/Advisor.jsx`, `services/advisory_service.py` |
| 6 | **Conversational Assistant** | Text + STT + TTS, grounded in the same alert/weather database as every other view. | `components/ChatPanel.jsx`, `api/chat.py` |
| 7 | **Voice interaction** | Speak → STT → grounded answer → TTS, EN/HI/TE. | `useVoiceInput.js`, `api/voice.py` |
| 8 | **Offline mode** | Visible Online/Cached/Offline state, cached alerts + advisories remain readable, "last synchronized" timestamp, sync-on-reconnect. The offline toggle CUTS the network path — the demo is real. | `offline.js`, `store.jsx`, `sw.js` (workbox precache) |
| 9 | **Local cache** | Alerts, validity windows, advisories, guidance and last-sync survive full offline. | `services/cache_service.py` + SW precache |
| 10 | **Cloud cache** | If an upstream API fails, the backend serves the last valid data and reports `CACHED` provenance instead of failing. | `services/cache_service.py` |

### System / authority side

| # | Feature | What it does | Where it lives |
|---|---|---|---|
| 11 | **Demo / Admin control panel** | Create alerts (type, severity, district, timed window, instruction); lifecycle buttons (Pre-alert / Activate / Update / Extend / Cancel / End); immediate push on every action; reset. | `components/AdminPanel.jsx`, `api/demo_alerts.py` |
| 12 | **One-tap demo scenarios** | Thunderstorm / Heat wave / Heavy rain / Cyclone — each schedules its own pre-alert (~12 s), activation (~40 s) and end (~3 min), so the lifecycle plays hands-free during the pitch. | `api/demo_alerts.py::create_scenario` |
| 13 | **Alert scheduler (auto-lifecycle)** | Background watcher advances scheduled alerts by the clock and notifies each state exactly once (dedup persists across restarts). An alert whose whole window passed while the server was down is CANCELLED — never fake-activated. | `services/alert_watcher.py::auto_advance_demo` |
| 14 | **P2P alert relay (resilience layer)** | Alert travels device-to-device with no internet: `Device A (no net) ← P2P ← Device B (cached)`. Every relay is a ledger event and appears in coverage. Honest labelling: SIMULATED trace; proves the mechanism, not nationwide capability. | `api/demo_alerts.py::simulate_relay`, `services/emergency_service.py` (encrypted store-and-forward transports) |
| 15 | **Delivery & acknowledgement ledger** | Per (alert, device) records: DELIVERED (push accepted) / P2P_RELAYED / PENDING / OFFLINE / UNREACHABLE. Engagement (opened / acknowledged) is tracked separately so neither metric hides the other. | `services/delivery_service.py` |
| 16 | **Authority coverage dashboard** | Reached %, per-status counts, per-zone grid (NW…SE) showing *which areas have poor alert reach*. Real devices and a labelled SIMULATED audience are always reported separately. | `components/AuthorityDashboard.jsx`, `api/demo_alerts.py::coverage` |
| 17 | **Data source status** | Per-source LIVE/CACHED/DEMO/UNCONFIGURED status; the three source modes (DEMO / IMD / HYBRID) switchable at runtime. | `components/SourceStrip.jsx`, `api/sources.py`, `api/mode` |

---

## 3. The wording rules (do not deviate on stage)

- **DELIVERED ≠ OPENED ≠ ACKNOWLEDGED.** The dashboard shows *communication
  coverage*, not a safety count. Never say "80% acknowledged = 80% safe".
- **P2P is a resilience layer, not infrastructure.** "Opportunistic
  device-to-device alert propagation" — it complements SACHET/cell broadcast,
  never replaces them. An ordinary app cannot receive internet alerts with zero
  connectivity; that path is cell broadcast (SACHET), and SAARTHI's offline
  value is *cached* alerts + local rules + P2P relay + sync on reconnect.
- **Weather forecast ≠ official alert.** Open-Meteo data is never labelled as an
  IMD alert. Source and authority travel with every alert.
- **Demo data is labelled.** The simulated audience, simulated relay traces and
  demo alerts carry their SIMULATED/DEMO provenance end to end.

---

## 4. The Round-2 killer demo (7 minutes)

| Step | Action | What the jury sees |
|---|---|---|
| 1 | Open Home | Verdict, weather, connection state — grounded |
| 2 | Open **Demo & Authority** → tap **⛈ Thunderstorm** scenario | Alert created; within seconds the PRE-ALERT notification pops (app minimized!) |
| 3 | ~40 s later | ACTIVE notification arrives on its own — nobody touched the app |
| 4 | Open **Notifications** | The lifecycle trail: Pre-alert → Active, unread badges |
| 5 | Open **Advisor** → switch user types | Same storm, different advice for farmer / driver / fisherman / commuter |
| 6 | Toggle **offline** (top bar) | Alerts and advisories still readable; banner shows cached state + last sync |
| 7 | Admin → **P2P relay** | Ledger records Device B → Device A transfer with no internet; coverage shows P2P_RELAYED |
| 8 | **Seed audience** → open dashboard | Reached %, offline, unreachable, P2P per zone — real and simulated kept apart |
| 9 | Wait for **ends_at** (or press **End alert**) | "Safe now — the warning has ended" notification; final coverage state |

Everything above is triggerable live. If the stage WiFi dies: offline mode,
cached alerts, the demo panel and coverage all run on localhost without any
external API.

---

## 5. What is deliberately NOT in this build

- No SMS channel (needs a gateway contract; the architecture has a slot for it).
- No cell-broadcast integration (that is SACHET's infrastructure — we position
  alongside it).
- No real IMD feed yet (connector is ready; the demo panel stands in).
- No nationwide claims from a two-device P2P demo.
