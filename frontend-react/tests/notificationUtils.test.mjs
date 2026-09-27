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
  const groups = groupNotificationsByDay(items, (k) => `L:${k}`);
  assert.deepEqual(groups.map((g) => g.key), ['today', 'yesterday', 'earlier']);
  assert.deepEqual(groups[0].items.map((i) => i.id), [2, 4]);
  assert.deepEqual(groups[1].items.map((i) => i.id), [3]);
  assert.deepEqual(groups[2].items.map((i) => i.id), [1]);
});

test('grouping returns [] for empty or missing input', () => {
  assert.deepEqual(groupNotificationsByDay([], (k) => k), []);
  assert.deepEqual(groupNotificationsByDay(null, (k) => k), []);
});

test('group labels come from the t function', () => {
  const groups = groupNotificationsByDay([{ id: 1, at: new Date().toISOString() }], (k) => `L:${k}`);
  assert.equal(groups[0].label, 'L:ntfToday');
});

test('unparsable timestamps refuse to group (no silent refiling)', () => {
  assert.deepEqual(groupNotificationsByDay([{ id: 1, at: 'not-a-date' }], (k) => k), []);
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
  assert.equal(s.live, 2); // ACTIVE + UPDATED
  assert.equal(s.ended, 2);
  assert.equal(s.cancelled, 1);
  assert.deepEqual(s.bySeverity, { RED: 2, ORANGE: 1, YELLOW: 1, GREEN: 2 });
});

test('adminStats tolerates null/empty', () => {
  assert.equal(adminStats(null).total, 0);
  assert.deepEqual(adminStats([]).bySeverity, { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0 });
});
