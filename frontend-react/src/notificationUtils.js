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

/**
 * Group a notification list into Today / Yesterday / Earlier buckets.
 * `t` is the i18n translate function so labels come from the same string
 * table the UI uses. Order inside each group follows input order; groups are
 * always emitted today → yesterday → earlier. A list containing an unparsable
 * timestamp returns [] — a broken clock must not silently refile entries.
 */
export function groupNotificationsByDay(items, t) {
  const order = ['today', 'yesterday', 'earlier'];
  const map = new Map();
  for (const n of items || []) {
    const d = new Date(n.at);
    if (Number.isNaN(d.getTime())) return [];
    const key = dayKeyFor(d);
    if (!map.has(key)) map.set(key, { key, label: t ? t(DAY_I18N_KEY[key]) : key, items: [] });
    map.get(key).items.push(n);
  }
  return order.filter((k) => map.has(k)).map((k) => map.get(k));
}

export function filterNotifications(items, filter) {
  if (!Array.isArray(items)) return [];
  if (filter === 'unread') return items.filter((n) => !n.read);
  if (filter === 'alerts') return items.filter((n) => ALERT_KINDS.has(n.kind));
  return items; // 'all' and unknown filters: no-op, never silently hide data
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
