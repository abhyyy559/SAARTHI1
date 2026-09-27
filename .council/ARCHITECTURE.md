# Alerts vs Notifications — architecture (main @ 60bd504)

Abhiram's definitions (law):
- NOTIFICATIONS = push messages that must reach the user even when the app/tab is
  closed. Tapping one opens the app to the relevant content.
- ALERTS = emergency alerts displayed inside the app. A notification may carry an alert.

## How alerts flow today
`backend/services/alert_service.py` + `alert_watcher.py` produce per-district
verdicts (pre-alert → active → clear lifecycle) from DEMO fixtures, SACHET CAP, IMD.
Lifecycle state persists in alert_watch_state.json. Frontend Alerts view
(`frontend-react/src/components/AlertCenter.jsx`, `AlertsList.jsx`, `AlertDetails.jsx`)
renders the verdict + official CAP alerts + community reports. AlertDetails shows
validity window, source badge (DEMO vs NDMA-SACHET CAP), instruction, and a timeline —
but lifecycle fields (started / completed-or-expected-end / effects / issuer / reason)
are incomplete.

## How notifications flow today (two channels)
1. IN-APP ONLY (current default): `store.jsx` `toggleNotify()` → `askNotifyPermission()`
   → `notify()` in `frontend-react/src/notify.js` (Notifications API / SW
   showNotification). Fires ONLY while the app is open.
2. WEB PUSH (background, the one that matters): `backend/services/push_service.py`
   (VAPID keys, subscription store via Postgres-or-JSON, pywebpush sender,
   `broadcast()` with 404/410 pruning, per-device telemetry
   delivered/opened/acknowledged) + `backend/api/push.py` (`/api/push/vapid`,
   `/subscribe`, `/unsubscribe`, `/test`, `/check`, `/status`). Service worker
   `frontend-react/src/sw.js` already handles `push` (shows notification, tag per
   district+kind, requireInteraction on RED) and `notificationclick` (focuses or
   opens the app at `payload.url`). Notification log: `backend/services/
   notification_service.py`, per-device read state, served at `/api/notifications/*`;
   frontend `NotificationCenter.jsx` / `NotificationsInbox.jsx` (lives in More sheet).

## A notification carries an alert
Push payloads: {title, body, severity, district, kind, alert_id, url}.
`notification_service.log(kind, title, body, ..., alert_id, push:{targeted,delivered,failed})`.
`data.url` on the SW notification routes the tap to the alert (`?view=alerts`).

## Gaps this council closes
1. The onboarding/topbar "Allow notifications" enable flow appears dead — the bell
   (`Shell.jsx` → `toggleNotify`) asks permission then calls `subscribeToPush`;
   failures (unsupported browser, missing VAPID, SW not ready) are swallowed into a
   toast. Worker 1 finds the root cause and makes the full closed-app path work.
2. Server-side broadcast on real alert lifecycle transitions needs wiring/verification.
3. Alerts page mixes community reports and nearby context with emergency alerts;
   lifecycle detail incomplete. Worker 2.
4. Ask is cramped below HomeHero. Worker 3.
5. Notifications buried in More sheet. Worker 4 builds the side panel.
6. App shell not proven to load offline; P2P demo relay exists but has no test
   procedure. Worker 5.
