// Notifications side panel regression tests (Worker 4, 2026-09-21).
//
// Contracts:
// - The panel is the ONE notifications home: the bell opens it, the
//   notifications view is a redirect that raises wgpt:notifications-open.
// - EN/HI/TE key parity on every new panel string, no Tamil script anywhere.
// - The push switch calls the store's toggleNotify — the enable logic is
//   NOT reimplemented in the panel.
// - ARIA: role="dialog" + aria-modal, Escape closes, focus moves to the
//   close button on open and is restored to the opener on close.
// - Newest-first list from /api/notifications; tapping a row marks it read
//   and deep-links alert-carrying notifications into ?view=alerts.
// - Severity is rendered from the backend payload only (SevStamp), never
//   re-derived in the component.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const TAMIL = /[\u0B80-\u0BFF]/;

const panelSrc = read('../src/components/NotificationsPanel.jsx');
const panelCss = read('../src/styles.css');
const stringsSrc = read('../src/strings/areas/panel.js');
const viewsSrc = read('../src/views.jsx');

// --- strings: parity, script, case ------------------------------------------

test('panel strings: every key exists in en, hi and te', () => {
  const blocks = {};
  for (const lang of ['en', 'hi', 'te']) {
    const m = stringsSrc.match(new RegExp(`${lang}: \\{([\\s\\S]*?)\\n  \\},`));
    assert.ok(m, `panel.js must have an ${lang} block`);
    blocks[lang] = new Set([...m[1].matchAll(/^\s{4}(\w+):/gm)].map((x) => x[1]));
  }
  for (const key of blocks.en) {
    assert.ok(blocks.hi.has(key), `key ${key} missing in hi`);
    assert.ok(blocks.te.has(key), `key ${key} missing in te`);
  }
  for (const key of [...blocks.hi, ...blocks.te]) {
    assert.ok(blocks.en.has(key), `key ${key} missing in en`);
  }
});

test('panel strings and component: no Tamil script', () => {
  assert.ok(!TAMIL.test(stringsSrc), 'panel.js must contain no Tamil script');
  assert.ok(!TAMIL.test(panelSrc), 'NotificationsPanel.jsx must contain no Tamil script');
});

test('panel strings: no all-caps sentence (sentence case)', () => {
  for (const m of stringsSrc.matchAll(/:\s*'([^']+)'/g)) {
    const val = m[1];
    if (val.length > 12 && /^[A-Z0-9\s—–.,;:!?()%°+]+$/.test(val)) {
      assert.fail(`all-caps string violates sentence case: ${val}`);
    }
  }
});

// --- the panel is the one home ----------------------------------------------

test('panel is a modal dialog with Escape-to-close and focus management', () => {
  assert.match(panelSrc, /role="dialog"/, 'dialog role');
  assert.match(panelSrc, /aria-modal="true"/, 'aria-modal');
  assert.match(panelSrc, /e\.key === 'Escape'/, 'Escape closes the panel');
  assert.match(panelSrc, /closeRef\.current\.focus\(\)/, 'focus moves to close on open');
  assert.match(panelSrc, /openerRef\.current/, 'focus is restored to the opener on close');
  assert.match(panelSrc, /aria-label=\{t\(lang, 'ntfTitle'\)\}/, 'dialog is labelled');
});

test('push switch reuses the store enable logic, never reimplements it', () => {
  assert.match(panelSrc, /toggleNotify/, 'panel calls the store toggleNotify');
  assert.match(panelSrc, /role="switch"/, 'the switch is a real switch');
  assert.match(panelSrc, /aria-checked=\{!!notifyOn\}/, 'switch state reflects notifyOn');
  assert.doesNotMatch(panelSrc, /askNotifyPermission/, 'permission flow stays in the store');
  assert.doesNotMatch(panelSrc, /subscribeToPush/, 'push registration stays in the store');
  assert.doesNotMatch(panelSrc, /Notification\.requestPermission/, 'no raw permission calls');
});

test('list is newest-first from the server log, tap deep-links the alert', () => {
  assert.match(panelSrc, /notificationsApi\.list/, 'list comes from /api/notifications');
  assert.match(panelSrc, /String\(b\.at \|\| ''\)\.localeCompare\(String\(a\.at \|\| ''\)\)/,
    'rows sort newest-first');
  assert.match(panelSrc, /setSelectedAlert\(\{ id: n\.alert_id \}\)/, 'tap selects the alert');
  assert.match(panelSrc, /setView\('alerts'\)/, 'tap deep-links into ?view=alerts');
  assert.match(panelSrc, /notificationsApi\.markRead/, 'tap marks read through the server');
  assert.match(panelSrc, /ntfReadAll/, 'mark-all-read is offered');
  assert.match(panelSrc, /notificationsApi\.ack/, 'per-alert acknowledgement survives');
});

test('severity is translated from the backend payload, never derived', () => {
  assert.match(panelSrc, /<SevStamp lang=\{lang\} level=\{sev\} \/>/);
  assert.doesNotMatch(panelSrc, /w\.severity|warning\.severity|verdict\./, 'no severity math');
  assert.match(panelSrc, /KIND_ICON\[n\.kind\]/, 'icons come from the shared inbox logic');
});

test('notifications view is a redirect into the panel, not a second home', () => {
  assert.match(viewsSrc, /wgpt:notifications-open/, 'NotificationsView raises the panel event');
  assert.match(viewsSrc, /setView\('home'\)/, 'the route parks on Home after opening the panel');
  assert.doesNotMatch(viewsSrc, /NotificationCenter/, 'the old page component is gone');
  assert.doesNotMatch(viewsSrc, /ViewHead titleKey="ntfTitle"/, 'no duplicate notifications page chrome');
});

test('panel styles: slide-in right on desktop, near-full sheet on mobile', () => {
  assert.match(panelCss, /\.npanel \{/, 'panel styles exist');
  assert.match(panelCss, /@media \(max-width: 560px\) \{[\s\S]*?\.npanel \{/, 'mobile sheet rules exist');
  assert.match(panelCss, /prefers-reduced-motion/, 'reduced motion is honoured');
  assert.match(panelCss, /\.bell-badge/, 'bell badge styles exist');
  assert.match(panelCss, /\.npanel \{[\s\S]*?background: var\(--paper\)/, 'panel uses the --paper token');
});

// --- filters + clear + denied guidance (Crew E, Phase 1) --------------------
// Spec: the panel keeps user controls for mark read, clear notifications and
// filter options (unread / alert-linked / info); permission denied gets clear
// guidance with a link to Settings.

test('filter control: four segmented options, client-side, aria-pressed', () => {
  assert.match(panelSrc, /FILTERS = \['all', 'unread', 'alerts', 'info'\]/, 'four filters');
  assert.match(panelSrc, /className="segmented"[^>]*role="group"/, 'segmented group');
  assert.match(panelSrc, /aria-label=\{t\(lang, 'panelFilterLabel'\)\}/, 'group is labelled');
  assert.match(panelSrc, /aria-pressed=\{filter === f\}/, 'active filter is announced');
  // The filter reads the row shape only — never the backend severity.
  assert.match(panelSrc, /filter === 'unread' \? !n\.read/, 'unread filter');
  assert.match(panelSrc, /filter === 'alerts' \? !!n\.alert_id/, 'alert-linked filter');
  assert.match(panelSrc, /filter === 'info' \? !n\.alert_id/, 'info filter');
  assert.match(panelSrc, /className=\{`seg-opt\$\{filter === f \? ' is-active' : ''\}`\}/,
    'reuses the shared segmented styles, no new CSS');
});

test('clear all: server-confirmed mark-read, then local dismissal that persists', () => {
  assert.match(panelSrc, /const clearAll = \(\) =>/, 'clearAll handler exists');
  assert.match(panelSrc, /markRead\(\{ all: true, district: loc\.district, device \}\)/,
    'clear marks everything read on the server first');
  // Dismissal happens only in the POST success branch — a failed clear
  // changes nothing, matching the mark-read honesty rule.
  assert.match(panelSrc, /wgpt\.notifications-cleared/, 'dismissals persist per device');
  assert.match(panelSrc, /saveCleared\(next\)/, 'cleared ids are saved');
  assert.match(panelSrc, /panelCleared/, 'success is confirmed, not silent');
  // Cleared rows stay hidden across refetches (but live in the server log for
  // other devices — the panel never deletes shared history).
  assert.match(panelSrc, /!loadCleared\(\)\.has\(n\.id\)/, 'refetch filters cleared ids');
});

test('clear uses only existing strings/APIs, no new backend contract', () => {
  assert.match(panelSrc, /notificationsApi\.markRead/, 'clear reuses mark-read');
  assert.doesNotMatch(panelSrc, /notificationsApi\.clear/, 'no new clear endpoint invented');
  assert.doesNotMatch(panelSrc, /ntfDelete|ntfRemove/, 'no deletion vocabulary');
});

test('permission denied gets guidance with a link to Settings', () => {
  assert.match(panelSrc, /notifyOn && notifyPerm === 'denied'/, 'denied state is named');
  assert.match(panelSrc, /setView\('settings'\)/, 'link navigates to the settings view');
  assert.match(panelSrc, /onClose\(\); setView\('settings'\)/, 'the panel closes before navigating');
  assert.match(panelSrc, /panelOpenSettings/, 'the link has a trilingual string');
  assert.doesNotMatch(panelSrc, /import SettingsPanel/, 'SettingsPanel itself is not touched');
});

test('push-reason map is not reintroduced in the panel', () => {
  // push-enable.test.mjs pins the cross-file invariant; the panel also names
  // the single import it renders through.
  assert.match(panelSrc, /import \{ pushReasonKey \} from '\.\.\/notify'/, 'single import');
  assert.doesNotMatch(panelSrc, /'rsnUnsupported'/, 'no local copy of the map');
});
