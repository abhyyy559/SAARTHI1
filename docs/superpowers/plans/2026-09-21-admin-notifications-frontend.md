# Admin Dashboard Redesign + Notification Center Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the AdminPanel into a proper dashboard (stat tiles, severity-colored rows, preset form) and add three notification features (nav unread badge, filters + day grouping, push delivery bar), with light-touch AlertCenter fixes only.

**Architecture:** All pure logic (grouping, filtering, stat derivation) lives in a new `src/notificationUtils.js` so it is testable with `node --test` like `alertWatch.js`. Components render the derived data. The unread badge polls the existing `/api/notifications/unread` endpoint from the store and renders in `Shell.jsx` nav. AdminPanel stats derive from the demo alerts list it already fetches — no new backend routes. Strings go in `strings/areas/round2.js` (EN/HI/TE).

**Tech Stack:** React 19, Vite, plain CSS (existing `Round2.css` / `AlertCenter.css` conventions), `node --test` isolated component tests (assert against source, per `CoverageDashboard.isolated.test.mjs` pattern), oxlint.

## Global Constraints

- Backend API contract is FIXED: no backend changes in this plan. `/api/notifications`, `/api/notifications/unread`, `/api/demo/alerts` are used as-is.
- Every user-facing string goes through `t(lang, key)`; add keys to `round2.js` for **all three languages** (en, hi, te).
- Severity codes (RED/ORANGE/YELLOW/GREEN) and state codes are never translated (repo rule, see `round2.js` header).
- No new npm dependencies.
- Test command: `npm test` in `weathergpt/frontend-react` (runs `node --test tests/*.test.mjs`). New tests go in `weathergpt/frontend-react/tests/` (root tests dir is what package.json globs — existing isolated tests live in `src/components/__tests__/` and are NOT run by `npm test`; put new tests in `tests/` so they actually run).
- Lint: `npm run lint` (oxlint) must pass; build: `npm run build`.
- Honest-data rule (repo-wide): never invent data to fill a screen; counts derive from what the server actually returned; SIMULATED stays labelled.
- Demo-only data (admin tiles) is derived from the demo alerts list fetched while in demo mode only — the panel already 403-gates.

---

### Task 1: Pure notification utilities + unit tests

**Files:**
- Create: `weathergpt/frontend-react/src/notificationUtils.js`
- Test: `weathergpt/frontend-react/tests/notificationUtils.test.mjs`

**Interfaces:**
- Consumes: nothing (pure module, mirrors `alertWatch.js` style).
- Produces (used by Tasks 2–4):
  - `groupNotificationsByDay(items, lang)` → `[{ key: 'today'|'yesterday'|'earlier', label: string, items: [...] }]`, preserving input order within groups; returns `[]` for empty/null input.
  - `filterNotifications(items, filter)` → array. `filter` in `'all' | 'unread' | 'alerts'`; `'alerts'` keeps items whose `kind` is in `ALERT_KINDS`.
  - `ALERT_KINDS` — Set: `{'pre-alert','active','updated','extended','escalate','start','clear','ended','cancelled'}`.
  - `NOTIFICATION_FILTERS` — `[{ id: 'all', key: 'ntfFilterAll' }, { id: 'unread', key: 'ntfFilterUnread' }, { id: 'alerts', key: 'ntfFilterAlerts' }]`.
  - `deliveryRatio(n)` → `{ delivered, targeted, pct, has }` where `pct` is 0–100 rounded, `has` is true only when `n.push.delivered` and `n.push.targeted` are finite numbers and `targeted > 0`.
  - `adminStats(alerts)` → `{ total, active, live, ended, cancelled, bySeverity: { RED, ORANGE, YELLOW, GREEN } }` where `active` counts `state === 'ACTIVE'`, `live` counts `ACTIVE|UPDATED|EXTENDED`, `bySeverity` counts each severity over all alerts.

- [ ] **Step 1: Write the failing tests**

Create `weathergpt/frontend-react/tests/notificationUtils.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  groupNotificationsByDay, filterNotifications, deliveryRatio,
  adminStats, ALERT_KINDS, NOTIFICATION_FILTERS,
} from '../src/notificationUtils.js';

const iso = (daysAgo, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

test('groups into today / yesterday / earlier with input order preserved', () => {
  const items = [
    { id: 1, at: iso(10) },
    { id: 2, at: iso(0, 9) },
    { id: 3, at: iso(1) },
    { id: 4, at: iso(0, 11) },
  ];
  const groups = groupNotificationsByDay(items, 'en');
  assert.deepEqual(groups.map((g) => g.key), ['today', 'yesterday', 'earlier']);
  assert.deepEqual(groups[0].items.map((i) => i.id), [2, 4]);
  assert.deepEqual(groups[2].items.map((i) => i.id), [1]);
});

test('grouping returns [] for empty or missing input', () => {
  assert.deepEqual(groupNotificationsByDay([], 'en'), []);
  assert.deepEqual(groupNotificationsByDay(null, 'en'), []);
});

test('group labels are translated strings (en has Today)', () => {
  const groups = groupNotificationsByDay([{ id: 1, at: new Date().toISOString() }], 'en');
  assert.equal(groups[0].label, 'Today');
});

test('filter: all keeps everything, unread keeps only unread, alerts keeps alert kinds', () => {
  const items = [
    { id: 1, read: false, kind: 'active' },
    { id: 2, read: true, kind: 'info' },
    { id: 3, read: false, kind: 'test' },
    { id: 4, read: true, kind: 'pre-alert' },
  ];
  assert.equal(filterNotifications(items, 'all').length, 4);
  assert.deepEqual(filterNotifications(items, 'unread').map((i) => i.id), [1, 3]);
  assert.deepEqual(filterNotifications(items, 'alerts').map((i) => i.id), [1, 4]);
  assert.deepEqual(filterNotifications(items, 'nonsense'), items); // unknown filter = no-op
  assert.deepEqual(filterNotifications(null, 'all'), []);
});

test('ALERT_KINDS excludes info/test; NOTIFICATION_FILTERS expose i18n keys', () => {
  assert.equal(ALERT_KINDS.has('info'), false);
  assert.equal(ALERT_KINDS.has('test'), false);
  assert.equal(ALERT_KINDS.has('escalate'), true);
  assert.deepEqual(NOTIFICATION_FILTERS.map((f) => f.id), ['all', 'unread', 'alerts']);
  assert.ok(NOTIFICATION_FILTERS.every((f) => typeof f.key === 'string'));
});

test('deliveryRatio: pct only when push counts are present and targeted > 0', () => {
  assert.deepEqual(deliveryRatio({ push: { delivered: 12, targeted: 15 } }),
    { delivered: 12, targeted: 15, pct: 80, has: true });
  assert.equal(deliveryRatio({ push: { targeted: 0 } }).has, false);
  assert.equal(deliveryRatio({}).has, false);
  assert.equal(deliveryRatio(null).has, false);
  assert.equal(deliveryRatio({ push: { delivered: 'x', targeted: 15 } }).has, false);
});

test('adminStats: counts by state and severity over all alerts', () => {
  const alerts = [
    { state: 'ACTIVE', severity: 'RED' },
    { state: 'UPDATED', severity: 'RED' },
    { state: 'PRE-ALERT', severity: 'ORANGE' },
    { state: 'UPCOMING', severity: 'YELLOW' },
    { state: 'ENDED', severity: 'GREEN' },
    { state: 'CANCELLED', severity: 'GREEN' },
    { state: 'ENDED' }, // no severity key: must not crash
  ];
  const s = adminStats(alerts);
  assert.equal(s.total, 7);
  assert.equal(s.active, 1);
  assert.equal(s.live, 2);   // ACTIVE + UPDATED
  assert.equal(s.ended, 2);
  assert.equal(s.cancelled, 1);
  assert.deepEqual(s.bySeverity, { RED: 2, ORANGE: 1, YELLOW: 1, GREEN: 2 });
});

test('adminStats tolerates null/empty', () => {
  assert.deepEqual(adminStats(null).total, 0);
  assert.deepEqual(adminStats([]).bySeverity, { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd weathergpt/frontend-react && npm test`
Expected: FAIL — module `../src/notificationUtils.js` not found.

- [ ] **Step 3: Implement `notificationUtils.js`**

```js
// Pure helpers for the Notification Center and Admin tiles. No React, no
// browser APIs — unit-testable with plain node --test, like alertWatch.js.

// Kinds that tell a user something about an alert's lifecycle. 'info' and
// 'test' are not alert kinds and must not show under the "Alerts" filter.
export const ALERT_KINDS = new Set([
  'pre-alert', 'active', 'updated', 'extended', 'escalate', 'start', 'clear',
  'ended', 'cancelled',
]);

export const NOTIFICATION_FILTERS = [
  { id: 'all', key: 'ntfFilterAll' },
  { id: 'unread', key: 'ntfFilterUnread' },
  { id: 'alerts', key: 'ntfFilterAlerts' },
];

const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const dayKeyFor = (d) => {
  const now = new Date();
  if (sameDay(d, now)) return 'today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'yesterday';
  return 'earlier';
};

const DAY_I18N_KEY = { today: 'ntfToday', yesterday: 'ntfYesterday', earlier: 'ntfEarlier' };
const dayLabel = (lang, key) =>
  // t() is provided by the caller's import in components; here the label is
  // passed through a tiny local table so this module stays dependency-free.
  // Components call groupNotificationsByDay(items, tFn) — see below.
  null;

/**
 * Group a newest-first notification list into Today / Yesterday / Earlier.
 * `t` is the i18n function so labels come from the same string table as the UI.
 * Order inside each group and across groups follows the input order.
 */
export function groupNotificationsByDay(items, t) {
  const order = ['today', 'yesterday', 'earlier'];
  const out = [];
  const map = new Map();
  for (const n of items || []) {
    const d = new Date(n.at);
    if (Number.isNaN(d.getTime())) return mapToGroups(); // bad timestamp: give up gracefully
    const key = dayKeyFor(d);
    if (!map.has(key)) {
      const g = { key, label: t ? t(DAY_I18N_KEY[key]) : key, items: [] };
      map.set(key, g);
    }
    map.get(key).items.push(n);
  }
  function mapToGroups() {
    return order.filter((k) => map.has(k)).map((k) => map.get(k));
  }
  return mapToGroups();
}

export function filterNotifications(items, filter) {
  if (!Array.isArray(items)) return [];
  if (filter === 'unread') return items.filter((n) => !n.read);
  if (filter === 'alerts') return items.filter((n) => ALERT_KINDS.has(n.kind));
  if (filter === 'all') return items;
  return items; // unknown filter: no-op, never silently hides data
}

/** Push delivery ratio for one logged notification. has=false when absent. */
export function deliveryRatio(n) {
  const push = (n && n.push) || {};
  const delivered = Number(push.delivered);
  const targeted = Number(push.targeted);
  const has = Number.isFinite(delivered) && Number.isFinite(targeted) && targeted > 0;
  if (!has) return { delivered: 0, targeted: 0, pct: 0, has: false };
  return { delivered, targeted, pct: Math.round((100 * delivered) / targeted), has: true };
}

const LIVE_STATES = new Set(['ACTIVE', 'UPDATED', 'EXTENDED']);

/** Counts for the admin dashboard tiles, derived only from what the store sent. */
export function adminStats(alerts) {
  const list = Array.isArray(alerts) ? alerts : [];
  const bySeverity = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0 };
  let active = 0;
  let live = 0;
  let ended = 0;
  let cancelled = 0;
  for (const a of list) {
    const state = String(a.state || '').toUpperCase();
    if (state === 'ACTIVE') active += 1;
    if (LIVE_STATES.has(state)) live += 1;
    if (state === 'ENDED') ended += 1;
    if (state === 'CANCELLED') cancelled += 1;
    const sev = String(a.severity || '').toUpperCase();
    if (bySeverity[sev] !== undefined) bySeverity[sev] += 1;
  }
  return { total: list.length, active, live, ended, cancelled, bySeverity };
}
```

Wait — `groupNotificationsByDay(items, t)` takes the `t` function as second arg (not `lang`); the test above must match. Fix Step 1's tests to pass `t` instead of `'en'`. The label test becomes:

```js
test('group labels come from the t function', () => {
  const groups = groupNotificationsByDay([{ id: 1, at: new Date().toISOString() }], (k) => `L:${k}`);
  assert.equal(groups[0].label, 'L:ntfToday');
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd weathergpt/frontend-react && npm test`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add weathergpt/frontend-react/src/notificationUtils.js weathergpt/frontend-react/tests/notificationUtils.test.mjs
git commit -m "feat(notifications): pure grouping/filter/delivery-ratio utilities with unit tests"
```

---

### Task 2: NotificationCenter — filters, day grouping, delivery bar + i18n keys

**Files:**
- Modify: `weathergpt/frontend-react/src/components/NotificationCenter.jsx`
- Modify: `weathergpt/frontend-react/src/components/Round2.css` (append `.ntf-*` rules)
- Modify: `weathergpt/frontend-react/src/strings/areas/round2.js` (3 languages)

**Interfaces:**
- Consumes: `groupNotificationsByDay`, `filterNotifications`, `deliveryRatio`, `NOTIFICATION_FILTERS` from `../notificationUtils` (Task 1).
- Produces: none (leaf view).

- [ ] **Step 1: Add i18n keys to `round2.js`**

In the `en` block (after `ntfViewAlerts: 'View alerts',`):

```js
    ntfFilterAll: 'All', ntfFilterUnread: 'Unread', ntfFilterAlerts: 'Alerts',
    ntfToday: 'Today', ntfYesterday: 'Yesterday', ntfEarlier: 'Earlier',
    ntfDelivery: 'push delivered',
```

In the `hi` block (after `ntfViewAlerts: 'अलर्ट देखें',`):

```js
    ntfFilterAll: 'सभी', ntfFilterUnread: 'अपठित', ntfFilterAlerts: 'अलर्ट',
    ntfToday: 'आज', ntfYesterday: 'कल', ntfEarlier: 'पहले',
    ntfDelivery: 'पुश पहुँचे',
```

In the `te` block (after its `ntfViewAlerts` line — search the file, same key):

```js
    ntfFilterAll: 'అన్నీ', ntfFilterUnread: 'చదవనివి', ntfFilterAlerts: 'అలర్ట్‌లు',
    ntfToday: 'ఈరోజు', ntfYesterday: 'నిన్న', ntfEarlier: 'ఇంకా',
    ntfDelivery: 'పుష్ చేరింది',
```

- [ ] **Step 2: Update NotificationCenter.jsx**

Imports (top of file, after existing imports):

```js
import { groupNotificationsByDay, filterNotifications, deliveryRatio, NOTIFICATION_FILTERS } from '../notificationUtils';
```

In `NotificationRow`, replace the plain-text push count block:

```jsx
          {n.push && typeof n.push.delivered === 'number' && (
            <span>push: {n.push.delivered}/{n.push.targeted}</span>
          )}
```

with a delivery bar (define a small helper component above `NotificationRow`):

```jsx
function DeliveryBar({ n }) {
  const { lang } = useApp();
  const r = deliveryRatio(n);
  if (!r.has) return null;
  const tone = r.pct >= 90 ? 'good' : r.pct >= 60 ? 'mid' : 'low';
  return (
    <span className="ntf-delivery" title={`${r.delivered}/${r.targeted}`}>
      <span className={`ntf-delivery-track tone-${tone}`}>
        <span className="ntf-delivery-fill" style={{ width: `${r.pct}%` }} />
      </span>
      <span className="mono">{r.delivered}/{r.targeted} {t(lang, 'ntfDelivery')}</span>
    </span>
  );
}
```

and in `ntf-meta` replace the old span with `<DeliveryBar n={n} />`.

In `NotificationCenter` default export, add filter state after `const [tick, setTick] = useState(0);`:

```js
  const [filter, setFilter] = useState('all');
```

Compute derived list (after `const unread = ...` stays as-is, add before return):

```js
  const visible = filterNotifications(items || [], filter);
  const groups = groupNotificationsByDay(visible, (k) => t(lang, k));
```

Replace the list rendering block:

```jsx
            : <div className="ntf-list">
              {items.map((n) => (
                <NotificationRow
                  key={n.id} n={n} onRead={markRead} onAck={ack} acked={!!acked[n.alert_id]}
                />
              ))}
            </div>}
```

with:

```jsx
            : groups.length === 0 ? <p className="sub">{t(lang, 'ntfEmpty')}</p>
              : <div className="ntf-list">
                {groups.map((g) => (
                  <div key={g.key} className="ntf-group">
                    <div className="ntf-group-label mono">{g.label}</div>
                    {g.items.map((n) => (
                      <NotificationRow
                        key={n.id} n={n} onRead={markRead} onAck={ack} acked={!!acked[n.alert_id]}
                      />
                    ))}
                  </div>
                ))}
              </div>}
```

Add a filter row in the Card's `actions` prop — change the existing `actions` to render filter buttons and keep mark-all-read:

```jsx
      actions={(
        <>
          <div className="ntf-filters" role="group" aria-label={t(lang, 'ntfFilterAll')}>
            {NOTIFICATION_FILTERS.map((f) => (
              <button
                key={f.id} type="button" className={`btn ghost sm${filter === f.id ? ' on' : ''}`}
                aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
              >
                {t(lang, f.key)}
              </button>
            ))}
          </div>
          {unread > 0 && (
            <button
              type="button" className="btn ghost sm"
              onClick={() => api.notificationsRead({ all: true, district: loc.district, device })
                .catch(() => {}).then(reload)}
            >
              {t(lang, 'ntfReadAll')} ({unread})
            </button>
          )}
        </>
      )}
```

- [ ] **Step 3: Append CSS to `Round2.css`**

```css
/* Notification Center: filters, day groups, delivery bar */
.ntf-filters { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.ntf-filters .btn.on { border-color: var(--accent); color: var(--accent); }
.ntf-group { display: grid; gap: 10px; }
.ntf-group + .ntf-group { margin-top: 14px; }
.ntf-group-label { color: var(--ink-3); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
.ntf-delivery { display: inline-flex; align-items: center; gap: 8px; min-width: 150px; }
.ntf-delivery-track {
  width: 90px; height: 6px; border-radius: 999px; background: var(--bg-2);
  overflow: hidden; display: inline-block;
}
.ntf-delivery-fill { display: block; height: 100%; border-radius: 999px; background: var(--sev-green); }
.ntf-delivery-track.tone-mid .ntf-delivery-fill { background: var(--sev-orange); }
.ntf-delivery-track.tone-low .ntf-delivery-fill { background: var(--sev-red); }
```

- [ ] **Step 4: Verify**

Run: `cd weathergpt/frontend-react && npm run lint && npm run build`
Expected: both pass with no new errors.

- [ ] **Step 5: Commit**

```bash
git add weathergpt/frontend-react/src/components/NotificationCenter.jsx weathergpt/frontend-react/src/components/Round2.css weathergpt/frontend-react/src/strings/areas/round2.js
git commit -m "feat(notifications): filters, day grouping, push delivery bar in Notification Center"
```

---

### Task 3: Unread badge — store polling + Shell nav badge

**Files:**
- Modify: `weathergpt/frontend-react/src/store.jsx`
- Modify: `weathergpt/frontend-react/src/components/Shell.jsx`

**Interfaces:**
- Consumes: `api.notificationsUnread(district, device)` (exists in `api.js`).
- Produces: store context value gains `unreadCount` (number). `Sidebar` and `MobileNav` render a badge on the `notifications` nav item when `unreadCount > 0`.

- [ ] **Step 1: Poll unread in the store**

In `AppProvider`, after the existing `syncTick`/`lastSync` state block (near other state declarations), add:

```js
  // Unread badge: polls the existing /api/notifications/unread endpoint.
  // Lives in the store so the sidebar badge, mobile tab and the
  // Notification Center itself all agree on one number.
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api.notificationsUnread(loc.district, device)
      .then((d) => { if (alive) setUnreadCount(Number(d.unread) || 0); })
      .catch(() => { /* offline: keep the last known count; never fake zero */ });
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [loc.district, device, syncTick]);
```

(Placing it after the `syncTick` declaration is required — the effect depends on it. If the `syncTick` declaration sits above, this drops straight in.)

Add `unreadCount` to the `useMemo` value object (next to `publishVerdict,`) and to its dependency array.

- [ ] **Step 2: Render the badge in Shell.jsx**

`Sidebar` — destructure `unreadCount` from `useApp()` and inside the nav map, wrap the label:

```jsx
            <span>{t(lang, n.label)}</span>
            {n.id === 'notifications' && unreadCount > 0 && (
              <span className="nav-badge" aria-label={`${unreadCount} unread`}>{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
```

`MobileNav` — same destructure and same conditional inside its map.

- [ ] **Step 3: Badge CSS**

Check whether `styles.css` has a `.nav-badge` rule; if not, append to `styles.css`:

```css
.nav-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
  background: var(--sev-red); color: #fff; font-size: 11px; font-weight: 800;
  line-height: 1;
}
.mobile-tab .nav-badge { position: absolute; top: 6px; right: 50%; transform: translateX(20px); }
.mobile-tab { position: relative; }
```

- [ ] **Step 4: Verify**

Run: `cd weathergpt/frontend-react && npm run lint && npm run build`
Expected: both pass. Manual check in dev: with the backend running, issue a demo alert → badge appears on Notifications nav; mark all read → badge clears.

- [ ] **Step 5: Commit**

```bash
git add weathergpt/frontend-react/src/store.jsx weathergpt/frontend-react/src/components/Shell.jsx weathergpt/frontend-react/src/styles.css
git commit -m "feat(notifications): live unread badge on nav from /api/notifications/unread"
```

---

### Task 4: AdminPanel redesign — stat tiles, severity rows, presets

**Files:**
- Modify: `weathergpt/frontend-react/src/components/AdminPanel.jsx`
- Modify: `weathergpt/frontend-react/src/components/Round2.css` (append `.admin-*` rules)
- Modify: `weathergpt/frontend-react/src/strings/areas/round2.js` (3 languages)

**Interfaces:**
- Consumes: `adminStats` from `../notificationUtils` (Task 1); all existing `api.demo*` methods unchanged.
- Produces: none (leaf view).

- [ ] **Step 1: Add i18n keys to `round2.js`**

`en` block (after `demoNotifyHint` / `demoResend` line):

```js
    adminStatsTitle: 'At a glance', adminTotal: 'Total alerts', adminActive: 'Active now',
    adminEnded: 'Ended', adminCancelled: 'Cancelled',
    adminPreset: 'Presets fill the form below — edit before creating.',
```

`hi` block:

```js
    adminStatsTitle: 'एक नज़र में', adminTotal: 'कुल अलर्ट', adminActive: 'अभी सक्रिय',
    adminEnded: 'समाप्त', adminCancelled: 'रद्द',
    adminPreset: 'प्रीसेट नीचे फ़ॉर्म भरते हैं — बनाने से पहले संपादित करें।',
```

`te` block:

```js
    adminStatsTitle: 'మొత్తం దృష్టిలో', adminTotal: 'మొత్తం అలర్ట్‌లు', adminActive: 'ఇప్పుడు యాక్టివ్',
    adminEnded: 'ముగిసింది', adminCancelled: 'రద్దు',
    adminPreset: 'ప్రీసెట్‌లు కింది ఫారమ్‌ను నింపుతాయి — సృష్టించే ముందు సవరించండి.',
```

- [ ] **Step 2: Rework AdminPanel.jsx**

Add import:

```js
import { adminStats } from '../notificationUtils';
```

Add presets and a `StatTile` helper above `AlertRow`:

```js
const PRESETS = {
  thunderstorm: { title: 'Severe Thunderstorm Warning', hazard: 'Thunderstorm', severity: 'ORANGE', district: 'Hyderabad', area: 'Hyderabad district', instruction: 'Avoid unnecessary outdoor travel during the valid hours.', pre_min: 0.2, start_min: 0.7, end_min: 3 },
  heatwave: { title: 'Heat Wave Warning', hazard: 'Heat wave', severity: 'YELLOW', district: 'Warangal', area: 'Warangal district', instruction: 'Avoid outdoor exposure during peak afternoon hours. Hydrate frequently.', pre_min: 0.2, start_min: 0.7, end_min: 3 },
  rain: { title: 'Heavy Rainfall Alert', hazard: 'Heavy rain', severity: 'ORANGE', district: 'Visakhapatnam', area: 'Visakhapatnam district', instruction: 'Waterlogging likely on low-lying roads. Avoid vulnerable routes.', pre_min: 0.2, start_min: 0.7, end_min: 3 },
  cyclone: { title: 'Cyclone Alert', hazard: 'Cyclone', severity: 'RED', district: 'Kakinada', area: 'Kakinada district (coastal)', instruction: 'Fishermen: do not venture into the sea. Follow evacuation instructions.', pre_min: 0.2, start_min: 0.7, end_min: 3 },
};
```

```jsx
function StatTile({ label, value, tone }) {
  return (
    <div className={`admin-tile${tone ? ` tone-${tone.toLowerCase()}` : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
```

In `AlertRow`, add severity to the row markup — change the row wrapper line:

```jsx
    <div className="demo-alert-row">
```

to

```jsx
    <div className="demo-alert-row" data-sev={alert.severity || 'NONE'}>
```

(The left-border colors come from CSS using the existing `data-sev` convention from `alert-card`.)

In `AdminPanel`, derive stats after `alerts` state is set (before `if (!demoLive)`):

```js
  const stats = adminStats(alerts);
```

Insert a stats Card between the scenarios Card and the active-alerts Card:

```jsx
      <Card title={t(lang, 'adminStatsTitle')} sub={t(lang, 'demoActiveSub')}>
        <div className="admin-tiles">
          <StatTile label={t(lang, 'adminTotal')} value={stats.total} />
          <StatTile label={t(lang, 'adminActive')} value={stats.live} tone={stats.live > 0 ? 'red' : 'green'} />
          <StatTile label={t(lang, 'adminEnded')} value={stats.ended} tone="green" />
          <StatTile label={t(lang, 'adminCancelled')} value={stats.cancelled} />
        </div>
        <div className="admin-sev-row" aria-hidden="true">
          {['RED', 'ORANGE', 'YELLOW', 'GREEN'].map((s) => (
            <span key={s} className={`admin-sev sev-${s.toLowerCase()}`} title={s}>
              <i>{stats.bySeverity[s]}</i> {s}
            </span>
          ))}
        </div>
      </Card>
```

Presets: below the SCENARIOS pick-grid in the create-form Card, add a preset row before the form:

```jsx
        <div className="pick-grid">
          {Object.entries(PRESETS).map(([id, p]) => (
            <button key={id} type="button" className="pick-tile" disabled={!!busy}
              onClick={() => setForm({ ...form, ...p })}>
              <span>{p.title}</span>
              <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>{p.district} · {p.severity}</span>
            </button>
          ))}
        </div>
        <p className="sub">{t(lang, 'adminPreset')}</p>
```

- [ ] **Step 3: Append CSS to `Round2.css`**

```css
/* Admin dashboard: stat tiles + severity-coded alert rows */
.admin-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.admin-tile {
  display: grid; gap: 2px; padding: 14px; border: 1px solid var(--line);
  border-radius: var(--r-sm, 10px); background: var(--bg-3);
}
.admin-tile b { font-size: 26px; line-height: 1.1; }
.admin-tile span { color: var(--ink-3); font-size: 12px; }
.admin-tile.tone-red b { color: var(--sev-red); }
.admin-tile.tone-green b { color: var(--sev-green); }
.admin-sev-row { display: flex; gap: 14px; margin-top: 12px; flex-wrap: wrap; }
.admin-sev { font-size: 12px; color: var(--ink-3); display: inline-flex; align-items: center; gap: 5px; }
.admin-sev i { font-style: normal; font-weight: 800; font-size: 13px; }
.admin-sev.sev-red i { color: var(--sev-red); }
.admin-sev.sev-orange i { color: var(--sev-orange); }
.admin-sev.sev-yellow i { color: var(--sev-yellow); }
.admin-sev.sev-green i { color: var(--sev-green); }

.demo-alert-row { border-left: 3px solid var(--line); padding-left: 12px; }
.demo-alert-row[data-sev='RED'] { border-left-color: var(--sev-red); }
.demo-alert-row[data-sev='ORANGE'] { border-left-color: var(--sev-orange); }
.demo-alert-row[data-sev='YELLOW'] { border-left-color: var(--sev-yellow); }
.demo-alert-row[data-sev='GREEN'] { border-left-color: var(--sev-green); }
```

- [ ] **Step 4: Verify**

Run: `cd weathergpt/frontend-react && npm run lint && npm run build`
Expected: both pass. Manual check in dev, demo mode on: tiles count correctly after launching a scenario; preset buttons fill the form; alert rows show severity left borders.

- [ ] **Step 5: Commit**

```bash
git add weathergpt/frontend-react/src/components/AdminPanel.jsx weathergpt/frontend-react/src/components/Round2.css weathergpt/frontend-react/src/strings/areas/round2.js
git commit -m "feat(admin): dashboard tiles, severity-coded rows, create-form presets"
```

---

### Task 5: Final verification + AlertCenter light touch

**Files:**
- Possibly modify: `weathergpt/frontend-react/src/components/AlertCenter.jsx` (only if a defect is found)
- Read-only check: `weathergpt/frontend-react/src/components/AlertCenter.css`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: a green verification run across the whole frontend.

- [ ] **Step 1: Full test + lint + build**

Run: `cd weathergpt/frontend-react && npm test && npm run lint && npm run build`
Expected: all three pass.

- [ ] **Step 2: AlertCenter light-touch audit (fix only defects, no redesign)**

Check these specific risks by reading `AlertCenter.jsx` (already read during investigation; verify before changing anything):
1. `key={a.identifier || i}` — index-key is acceptable only when lists never reorder; they don't (server order), so leave unless duplicates of `identifier` can occur.
2. `useEffect` fetch loop deps `[locKey, loc.district, loc.lat, loc.lon, syncTick, tick]` — `locKey` already encodes the other three; harmless duplication, leave as-is.
3. Accessibility: alert cards are `<article>` with `onClick` — confirm a keyboard path exists via the card's buttons (Listen/Ask). If cards have a click handler without a focusable wrapper, add `role="button"` + `tabIndex` ONLY where the whole card is clickable and only if the dev-run shows keyboard users cannot reach the actions.

Do NOT restructure, re-style, or add features here. If nothing is broken: no commit, state that plainly.

- [ ] **Step 3: Typecheck equivalent**

There is no `tsc` (plain JS + oxlint). `npm run build` is the typecheck equivalent (Vite/Rollup resolves all imports and catches syntax/JSX errors).

- [ ] **Step 4: Commit any defect fixes**

```bash
git add weathergpt/frontend-react/src/components/AlertCenter.jsx
git commit -m "fix(alerts): <specific defect found and fixed>"
```

(Only if Step 2 found something. Otherwise skip.)

---

## Self-Review

**Spec coverage:**
- Admin redesign + features (user choice) → Task 4: stat tiles, severity rows, presets, reorganized cards. ✓
- Unread badge (user choice) → Task 3, uses the existing unused `/api/notifications/unread` endpoint. ✓
- Filters + grouping (user choice) → Task 2. ✓
- Delivery viz (user choice) → Task 2 `DeliveryBar`. ✓
- AlertCenter light touch (user choice) → Task 5 Step 2, fix-defects-only policy. ✓

**Placeholder scan:** No TBDs. Task 4 presets and Task 2 strings are complete code. The `dayLabel` dead helper in Task 1's draft code was removed by the Step-3 note passing `t` as the second argument — implementer must not copy the dead function. Task 3 Step 3 says "check whether `.nav-badge` exists" with concrete CSS given either way — that's a lookup with a complete fallback, not a placeholder.

**Type consistency:**
- `groupNotificationsByDay(items, t)` — second arg is the `t` function everywhere (Task 1 implementation, Task 1 test note, Task 2 usage). The original test draft passed `'en'`; the Step 3 note corrects it — implementer must apply the corrected label test.
- `adminStats(alerts)` returns `{ total, active, live, ended, cancelled, bySeverity }`; Task 4 reads `stats.total / stats.live / stats.ended / stats.cancelled / stats.bySeverity` — consistent.
- `deliveryRatio(n)` returns `{ delivered, targeted, pct, has }`; Task 2's `DeliveryBar` reads exactly those. ✓
- `NOTIFICATION_FILTERS` entries `{ id, key }`; Task 2 maps `f.id` / `f.key`. ✓
- i18n keys introduced in Task 2 (`ntfFilter*`, `ntfToday/Yesterday/Earlier`, `ntfDelivery`) and Task 4 (`admin*`) are exactly the ones referenced by components. ✓
