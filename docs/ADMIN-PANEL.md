# Admin Panel — Demo Control Console

**Path:** `?view=admin` (also in the sidebar nav). Works only in **demo mode** —
the backend returns **403** on all `/api/demo/*` routes in any other mode.

The console is not a mock: every button drives the real alert pipeline
(demo store → notifications → push → delivery ledger). If a button moved state
without a notification, the Notifications page would visibly miss it.

## Sections

### 1. Demo control panel (scenario seeding)
One-tap scenarios that run themselves hands-free for the pitch:
| Scenario | District | Severity |
|---|---|---|
| ⛈ Thunderstorm | Hyderabad | ORANGE |
| 🔥 Heat wave | Warangal | YELLOW |
| 🌧 Heavy rain | Visakhapatnam | ORANGE |
| 🌀 Cyclone | Kakinada | RED |

A scenario schedules its own lifecycle: the **pre-alert** notification fires in
seconds, the alert **activates** ~40s later, and the **ended** notification
closes the loop (~3 minutes total).

### 2. Alerts in play (lifecycle control)
Every seeded alert appears as a console row with its severity edge, state chip,
and history. Move any alert through its lifecycle manually:

```
UPCOMING → PRE-ALERT → ACTIVE → UPDATED ─┬─→ EXTENDED ─→ ENDED
                                         └──────────────→ CANCELLED
```

Available actions per state:
- **UPCOMING** → pre-alert / activate / cancel
- **PRE-ALERT** → activate / cancel
- **ACTIVE** → update / extend / end
- **UPDATED** → extend / end
- **EXTENDED** → update / end

Per-alert extras:
- **🔔 Resend notification** — re-fires the push + notification log entry.
- **📡 P2P relay** — relays the live alert phone-to-phone (the offline story).
- **🕘 History** — expands the full transition timeline (who/when each action fired).
- **Reset demo** — clears all demo alerts and starts clean.

### 3. Authority dashboard
Shows which authority issued what (demo authority in demo mode), per-alert
provenance and acknowledgement counts.

### 4. Coverage dashboard
District coverage view — which districts have active/demo coverage, used to
show the "last-mile reach" story on stage.

## Creating notifications (three ways)
1. **Drive the lifecycle** — every transition (pre-alert, activate, update,
   extend, end, cancel) automatically creates a notification + push.
2. **Resend** — the 🔔 button on any live alert row re-sends immediately.
3. **Seed a scenario** — the auto-running scenario fires its own notifications
   with no further clicks.

Notifications land in `?view=notifications` (with unread badges on Home and
the nav) and, if push is subscribed, as system notifications via Web Push.
