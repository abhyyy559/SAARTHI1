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
DATA SOURCES (single IMD-first mode — no mode switch)
   IMD → Open-Meteo → OpenWeatherMap → cache (weather) · IMD → SACHET/CAP → cache (warnings)
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

One operating mode feeds the downstream pipeline — IMD-first with multi-source
backfill (see `docs/SOURCE-MODES.md`). There is no demo mode, no mode switch,
and no admin console (all removed 2026-09-27). Every fact carries its `source`
label, and the provenance chip always names the actual source that answered.

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
| 13 | **Alert scheduler (auto-lifecycle)** | Background watcher advances scheduled alerts by the clock and notifies each state exactly once (dedup persists across restarts). An alert whose whole window passed while the server was down is CANCELLED — never fake-activated. | `services/alert_watcher.py::auto_advance_demo` |
| 14 | **P2P relay — QR flow (resilience layer)** | Alert travels device-to-device with no internet: the sender's phone shows rotating QR frames, any nearby phone scans them with its camera — no pairing, no accounts. Hop limits (5, or 10 for RED), fail-closed Official badge, acks queued offline. The server-side simulated relay (`POST /api/demo/relay`) was deleted: it fabricated hop traces and `simulated:false` ledger rows for a delivery that never happened. | `frontend-react/src/p2pqr.js`, `components/QrRelay.jsx` / `QrScan.jsx`, `services/emergency_service.py` (encrypted store-and-forward transports) |
| 15 | **Delivery & acknowledgement ledger** | Per (alert, device) records: DELIVERED (push accepted) / P2P_RELAYED / PENDING / OFFLINE / UNREACHABLE. Engagement (opened / acknowledged) is tracked separately so neither metric hides the other. | `services/delivery_service.py` |
| 16 | **Alert coverage dashboard** | Reached %, per-status counts, per-zone grid showing *which areas have poor alert reach*. Communication visibility — not a safety count. Formerly the authority console's second card; now public in Trust & sources. | `components/CoverageDashboard.jsx`, `api/ack.py::coverage` |
| 17 | **Data source status** | Per-source LIVE/CACHED/UNAVAILABLE/UNCONFIGURED status, single IMD-first mode (IMD → Open-Meteo → OWM → SACHET/CAP → cache). Provenance always names the actual source. | `components/SourceStrip.jsx`, `api/sources.py` |

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
- **Provenance is end-to-end.** Every fact carries its source label
  (`LIVE` / `CACHED` / `UNAVAILABLE` / `UNCONFIGURED` / `COMMUNITY`); nothing is
  silently backfilled, and a backfill source is never labelled as an official
  alert.

---

## 4. The Round-2 killer demo (7 minutes)

| Step | Action | What the jury sees |
|---|---|---|
| 1 | Open Home | Verdict, weather, connection state — grounded, provenance chips on everything |
| 2 | Open **Alerts** | Active warnings with severity, validity window, instruction, source |
| 3 | Open **Notifications** (topbar bell) | The lifecycle trail of everything SAARTHI sent — even while the app was closed |
| 4 | Open **Advisory** → switch user types | Same weather, different advice for farmer / driver / fisherman / commuter |
| 5 | Toggle **offline** (top bar) | Alerts and advisories still readable; banner shows cached state + last sync |
| 6 | Trust & sources → coverage | Delivery/ack counts per district and zone — communication visibility, not a safety count |

Everything above runs on the live single-mode pipeline — no fixtures, no demo
panel. If the stage WiFi dies: offline mode, cached alerts and advisories keep
working on localhost; the provenance chips read CACHED instead of failing.

---

## 5. What is deliberately NOT in this build

- No SMS channel (needs a gateway contract; the architecture has a slot for it).
- No cell-broadcast integration (that is SACHET's infrastructure — we position
  alongside it).
- No real IMD feed yet (connector is ready; without the key the IMD card reads
  UNCONFIGURED and answers ride the backfill chain — see
  `docs/IMD-KEY-ONBOARDING.md`).
- No nationwide claims from a two-device P2P demo.
