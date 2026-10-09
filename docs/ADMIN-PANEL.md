# Admin panel — retired

The demo console that lived at `?view=admin` (one-tap seeded cyclone /
thunderstorm scenarios, a simulated phone-to-phone relay, a demo mode) belonged
to the previous frontend and no longer exists. The app now runs only on live
data, so there is nothing to seed and nothing to reset. Do not show or mention
it in the demo.

What replaced it:

| Need | Now |
|---|---|
| Show an alert on stage | Use a district that has a real official alert today (Map → Alerts). See `docs/DEMO-SCRIPT.md`, step 0. |
| Prove push works | In the app: Alerts → *Alerts on this phone* → *Send a test alert* (sends to that phone only). A test to every subscriber of a district needs `PUSH_ADMIN_TOKEN` (see `.env.example`). |
| Check the sources | In the app: Settings (gear) → *Data sources*. API: `GET /api/sources`. |
| Push / watcher status | `GET /api/push/status`; force a pass: `POST /api/push/check`. |
| Delivery and acknowledgement counts | `GET /api/coverage` (no screen yet). |

Stage steps: `docs/DEMO-SCRIPT.md`. Pre-demo checklist: `docs/DEMO-READY.md`.
