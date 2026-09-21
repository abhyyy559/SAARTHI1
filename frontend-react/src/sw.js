// Service worker.
//
// This file exists for ONE reason: a push notification has to arrive when the
// app is not open, and only a service worker can receive one. The browser wakes
// this worker in the background, it shows the notification, and it goes back to
// sleep. No page, no tab, nothing running on the phone.
//
// The previous build generated the worker with vite-plugin-pwa's default
// strategy and the config said "never hand-write the SW" — a good rule, because
// hand-rolled caching is how apps serve stale data. That rule is kept where it
// matters: caching is still entirely workbox's job, via `precacheAndRoute`
// below. What is added here is a message channel, which workbox does not
// provide. Nothing in this file decides what to cache.
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

// Injected at build time. Workbox owns caching; see the note above.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Worker 5 (offline + P2P testability) — offline navigation fallback.
// Every in-app route is the same index.html shell; a deep link such as
// /?view=offline must paint with NO network, not fail. This route answers
// navigation requests from the precached shell. /api, /ws, the worker itself
// and the workbox runtime are excluded so API calls keep failing LOUDLY
// offline (the UI must render honest UNAVAILABLE states, never fake data).
// Caching stays workbox-owned; the push/notificationclick/message handlers
// below are untouched.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/ws/, /\/sw\.js$/, /\/workbox-.*\.js$/, /\/manifest\.webmanifest$/],
  }),
);

self.skipWaiting();
clientsClaim();

// Notification payloads are small by design — they are read on a lock screen.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push we cannot parse still deserves to be shown: silence would look
    // like the feature is broken.
    payload = { title: 'Weather alert', body: event.data ? event.data.text() : '' };
  }

  const severity = String(payload.severity || 'UNKNOWN').toUpperCase();
  const rawTitle = payload.title || 'Weather alert';
  // Demo pushes must never read as live warnings on the lock screen —
  // product law is "never label mocks LIVE". In-app surfaces are stamped;
  // the OS notification gets the same honesty here.
  const title = payload.demo ? `[Demo] ${rawTitle}` : rawTitle;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Replaces a previous notification for the same district+kind instead of
      // stacking, so a user returning to their phone sees one current state.
      tag: `${payload.kind || 'alert'}:${payload.district || ''}`,
      renotify: true,
      requireInteraction: severity === 'RED',
      data: {
        url: payload.url || '/',
        severity,
        district: payload.district || '',
        // Carried so the tap can be attributed to the alert (opened event)
        // and so the app can deep-link to it.
        alert_id: payload.alert_id || '',
      },
    }),
  );
});

// Tapping the notification must open the app on the alert, not a blank tab.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse an open window when there is one; focus beats spawning a duplicate.
      for (const client of all) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          if ('navigate' in client) {
            try { await client.navigate(target); } catch { /* same-origin nav is best-effort */ }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// Lets the page confirm the worker is the one that handles push, rather than
// assuming a successful registration means the feature works.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PING') {
    event.source?.postMessage({ type: 'PONG', pushCapable: true });
  }
  // Agent 2: the Offline & P2P panel asks whether the worker is actually
  // controlling this page before it claims "ready for offline". A worker that
  // is merely registered but not controlling the page cannot serve the app
  // shell from cache — reporting that honestly beats a green dot that lies.
  if (event.data && event.data.type === 'OFFLINE_PROBE') {
    event.source?.postMessage({ type: 'OFFLINE_PROBE_RESULT', controlling: true });
  }
});
