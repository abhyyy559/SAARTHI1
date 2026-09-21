// IA dedup + 360px regression tests (2026-09-20).
//
// The public IA is Home · Alerts · Advisory · the bell (notifications panel)
// · More (Offline & P2P, Trust & sources, Settings, tour replay). Ask /
// Advisor / Details / Sources routes are gone; their content was folded in.
// Aviation is a PROFILE, not a menu row — its briefing renders on Home for
// the aviation persona. Everything must render without horizontal overflow at
// 320–360px.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const views = read('../src/views.jsx');
const shell = read('../src/components/Shell.jsx');
const home = read('../src/components/Home.jsx');
const hero = read('../src/components/HomeHero.jsx');
const css = read('../src/styles.css');
const app = read('../src/App.jsx');
const tour = read('../src/components/OnboardingTour.jsx');

// --- IA shape --------------------------------------------------------------
test('public IA is exactly Home · Alerts · Advisory · More', () => {
  // Primary registry
  assert.match(read('../src/i18n.js'), /PRIMARY_VIEWS = \['home', 'alerts', 'advisory'\]/);
  // Mobile: three tabs + a More sheet trigger
  assert.match(shell, /\{ view: 'home'[\s\S]*?\{ view: 'alerts'[\s\S]*?\{ view: 'advisory'/);
  assert.match(shell, /menuMore/);
});

test('More sheet lists the deduped destinations; notifications moved to the bell panel', () => {
  // Notifications left the More sheet: the topbar bell opens the side panel,
  // which is the one and only notifications home.
  for (const v of ['offline', 'trust', 'settings'])
    assert.match(shell, new RegExp(`\\{ view: '${v}'`), `More sheet must list ${v}`);
  assert.doesNotMatch(shell, /\{ view: 'notifications'/, 'notifications must not be a More-sheet/rail row');
  // Tour replay is the last row.
  assert.match(shell, /sbTakeTour/);
  // Aviation left the menu: it is a profile now, never a More-sheet row.
  assert.doesNotMatch(shell, /\{ view: 'aviation'/, 'aviation must not be a More-sheet row');
});

test('the topbar bell opens the notifications panel and carries the unread badge', () => {
  assert.match(shell, /import NotificationsPanel from '.\/NotificationsPanel'/, 'Shell must mount the panel');
  assert.match(shell, /<NotificationsPanel open=\{panelOpen\}/, 'panel is driven by Shell state');
  assert.match(shell, /aria-haspopup="dialog"/, 'bell announces the dialog it opens');
  assert.doesNotMatch(shell, /onClick=\{toggleNotify\}/, 'bell must not toggle push directly any more');
  assert.match(shell, /bell-badge/, 'bell keeps the unread badge');
  assert.match(shell, /notificationsApi\.unread/, 'badge is fed by the server unread count');
  assert.match(shell, /wgpt:notifications-open/, 'stale deep links can still open the panel');
});

test('aviation is a persona: briefing renders on Home for the aviation profile', () => {
  assert.match(read('../src/i18n.js'), /'aviation'/, 'aviation must be a registered persona');
  assert.match(home, /persona === 'aviation'/, 'Home gates the briefing on the aviation profile');
  assert.match(home, /<AviationBriefing \/>/, 'the briefing lives on the dashboard, not a route');
});

test('removed routes have no registration, no public entry', () => {
  for (const v of ['ask', 'advisor', 'details', 'sources']) {
    assert.doesNotMatch(app, new RegExp(`^\\s*${v}: \\w+View,$`, 'm'), `${v} must not be registered`);
  }
  // Stale deep links fall back to Home — documented in App.jsx.
  assert.match(app, /stale/i);
});

test('alerts fold detail inline; advisory folds the advisor', () => {
  // Agent 1's AlertsList is the one alerts surface: list + inline expansion.
  assert.match(views, /<AlertsList[\s\S]*?initialAlertId=\{initialId\}/);
  assert.match(views, /<Emergency \/>/, 'SOS stays first on the Alerts route');
  assert.doesNotMatch(views, /DetailsView/, 'no separate Details route');
  assert.match(views, /<Advisor \/>/);
  assert.match(views, /<AdviceCards \/>/);
  assert.match(home, /<HomeHero \/>/, 'the hero mounts on Home');
  assert.match(views, /TrustSourcesView/, 'trust renders the merged view');
});

// --- hero ------------------------------------------------------------------
test('hero severity is icon + word + color, never color alone', () => {
  assert.match(hero, /className="sev-stamp" data-sev=\{displayState\}/);
  // The severity WORD resolves dynamically: sev${...} over sevRed/Orange/Yellow/Green/Unknown.
  assert.match(hero, /`sev\$\{/);
  assert.match(hero, /'Red'|"Red"/);
  assert.match(hero, /'Unknown'|"Unknown"/);
  assert.match(hero, /<Icon name=/);
});

test('hero severity comes from the backend verdict, never re-derived', () => {
  assert.match(hero, /const verdict = \(warn && warn\.verdict\)/);
  assert.doesNotMatch(hero, /temperature >|temp >|humidity >/);
});

test('hero expiry uses a countdown, not a bare time-of-day', () => {
  assert.match(hero, /formatCountdown/);
  assert.doesNotMatch(hero, /formatValidUntil/);
});

// --- 360px regressions -------------------------------------------------------
test('no horizontal scrolling at 320–360px: body overflow guard', () => {
  assert.match(css, /overflow-x: clip;/, 'body must clip horizontal overflow');
  // ...but it must not use hidden, which breaks the sticky topbar.
  assert.doesNotMatch(css, /body[\s\S]{0,300}?overflow-x: hidden/, 'hidden would kill the sticky topbar');
});

test('guidance pill is viewport-safe at 360px', () => {
  assert.match(css, /\.facts-strip \{ flex-wrap: wrap; \}/);
  assert.match(css, /\.facts-escape \{[\s\S]*?max-width: 100%;/);
});

test('suggestion chips collapse to a 2-col grid at <=380px', () => {
  assert.match(css, /@media \(max-width: 380px\) \{[\s\S]*?\.suggestions \{ display: grid;/);
});

test('hero dial and glyph shrink at <=380px', () => {
  assert.match(css, /@media \(max-width: 380px\) \{[\s\S]*?\.hh-icon \{ width: 104px;/);
});

test('More sheet never exceeds the viewport', () => {
  assert.match(css, /\.more-sheet \{ max-width: 100vw;/);
});

// --- tour --------------------------------------------------------------------
test('tour is exactly five icon-led steps on the deduped IA', () => {
  const steps = [...tour.matchAll(/\{ view: '[^']+'[^}]*icon: '[^']+'[^}]*title: '[^']+'[^}]*body: '[^']+'[^}]*\}/g)];
  assert.equal(steps.length, 5, `tour must have exactly 5 steps, got ${steps.length}`);
  assert.ok(steps.every((st) => /icon: '(sun|chat|bell|offline|person|info|radio)'/.test(st[0])), 'every step has an icon');
  assert.ok(!steps.some((st) => /view: 'ask'/.test(st[0])), 'no tour step points at the removed Ask route');
  assert.ok(steps.some((st) => /action: 'notify'/.test(st[0])), 'the notifications step wires the Allow-notifications action');
});

// --- admin invisibility -------------------------------------------------------
test('offline route mounts Agent 2\'s OfflineP2P panel per the integration contract', () => {
  const off = read('../src/components/OfflineView.jsx');
  assert.match(off, /<OfflineP2P[\s\S]*?api=\{api\}/);
  assert.match(off, /demoMode=\{demoMode\}/, 'relay stays demo-gated');
  assert.match(off, /alerts=\{alerts\}/, 'cached alerts pass through for offline evaluation');
  assert.match(views, /OfflineView/, 'views.jsx routes offline to the shell');
});

test('admin is absent from tabs, More sheet, and tour', () => {
  assert.doesNotMatch(shell, /\{ view: 'admin'/);
  assert.doesNotMatch(shell, /\{ view: "admin"/);
  assert.doesNotMatch(tour, /admin/);
});

// --- home assembly -------------------------------------------------------------
test('home is hero + chat + warning teasers, no dispatch strip', () => {
  assert.match(home, /<HomeHero \/>/);
  assert.match(home, /<HomeChat[\s\S]*?key=\{`chat:/, 'Agent 3 HomeChat mounts with the identity key');
  assert.doesNotMatch(home, /ActionTiles|DispatchStrip/, 'old action tiles and dispatch strip are gone');
});
