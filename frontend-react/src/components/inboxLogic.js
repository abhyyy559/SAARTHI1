// Pure logic for the grouped notifications inbox and the inline alerts
// list. No JSX, no Vite-only syntax: node tests import this file directly
// through a data URL (the same pattern as src/alertWatch.js).
//
// Severity is never derived here — grouping and labels only. The backend's
// severity renders as-is.

// Transition kind -> icon. Icons carry meaning for non-readers; the word
// label next to them carries it for everyone else.
export const KIND_ICON = {
  'pre-alert': 'clock',
  start: 'clock',
  active: 'alert',
  updated: 'refresh',
  extended: 'clock',
  ended: 'check',
  clear: 'check',
  cancelled: 'offline',
  escalate: 'alert',
  test: 'bell',
  info: 'info',
  'p2p-relay': 'radio',
};

// Transition kind -> i18n key for the one-verb label.
export function transitionKey(kind) {
  const k = String(kind || 'info').toLowerCase().replace(/[^a-z-]/g, '');
  const map = {
    'pre-alert': 'trPreAlert',
    start: 'trStart',
    active: 'trActive',
    updated: 'trUpdated',
    extended: 'trExtended',
    ended: 'trEnded',
    clear: 'trClear',
    cancelled: 'trCancelled',
    escalate: 'trEscalate',
    test: 'trTest',
    'p2p-relay': 'trP2pRelay',
  };
  return map[k] || 'trInfo';
}

// Group newest-first notification rows into per-alert trails.
// Each group: { key, alertId, items (oldest-first), latest, unread,
// severity, demo }. `tr` is the translate function (injected so this file
// stays importable in node).
export function groupNotifications(items) {
  const order = [];
  const byKey = new Map();
  for (const n of items || []) {
    const key = n.alert_id || `misc:${n.district || ''}:${n.kind || ''}`;
    if (!byKey.has(key)) {
      const g = { key, alertId: n.alert_id || '', items: [], unread: 0, demo: false };
      byKey.set(key, g);
      order.push(g);
    }
    const g = byKey.get(key);
    g.items.push(n);
    if (!n.read) g.unread += 1;
    if (n.alert_id && String(n.alert_id).startsWith('demo-')) g.demo = true;
  }
  for (const g of order) {
    // Timeline reads oldest -> newest: issued first, ended last.
    g.items.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    g.latest = g.items[g.items.length - 1];
    g.severity = g.latest.severity || 'UNKNOWN';
  }
  // Groups newest-first by their latest transition.
  order.sort((a, b) => String(b.latest.at || '').localeCompare(String(a.latest.at || '')));
  return order;
}

// Human title for a group. Demo alerts resolve through the fetched bulletin;
// official trails read the hazard out of their stable key; nothing is guessed.
export function groupTitle(group, fetched, tr) {
  if (fetched && (fetched.title || fetched.hazard)) {
    return fetched.title || fetched.hazard;
  }
  const id = String(group.alertId || '');
  if (id.startsWith('official:')) {
    const hazard = id.split(':').slice(2).join(':') || '';
    if (hazard && hazard !== 'warning') return hazard;
  }
  if (id.startsWith('cap:')) return tr('inboxOfficialTag');
  return tr('inboxUnknownAlert');
}

// Relative timestamp for alert rows ("2 min ago") — the board must read as
// live. Absolute timestamps live in the inbox timeline instead.
export function relTime(iso, nowMs = Date.now()) {
  try {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const mins = Math.max(0, Math.round((nowMs - then) / 60000));
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const days = Math.round(hrs / 24);
    return `${days} d ago`;
  } catch { return ''; }
}

// Merge official CAP alerts and demo alerts into one list, official first,
// each tagged with its origin so the row can label it honestly.
export function mergeAlerts(official, demo) {
  const list = [];
  for (const a of official || []) list.push({ ...a, _origin: 'official' });
  for (const a of demo || []) list.push({ ...a, _origin: 'demo' });
  return list;
}
