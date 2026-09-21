import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Source-level regression guards for the pre-commit review. This is the same
// contract style the other frontend suites use (views.test.mjs, modes.test.mjs):
// JSX cannot be imported by node, so the assertions read the source and pin the
// exact expression that was wrong. Every test below fails on the pre-fix code.

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const advisor = src('components/Advisor.jsx');
const home = src('components/Home.jsx');
const hero = src('components/HomeHero.jsx');
const shell = src('components/Shell.jsx');
const app = src('App.jsx');
const store = src('store.jsx');
const apiSrc = src('api.js');

// --- the reported bug: profile switch did not refresh the advice ------------

test('Advisor derives the open card from the live profile, never a snapshot', () => {
  // `const [open, setOpen] = useState(persona)` froze the open card at mount, so
  // switching profile in the top bar left the old card (and its advice) open and
  // fired no fetch. Reloading re-initialised it from the persisted persona, which
  // is why a manual refresh appeared to fix it.
  assert.doesNotMatch(advisor, /const \[open, setOpen\] = useState\(persona\)/, 'open card must not be snapshotted from persona');
  assert.doesNotMatch(advisor, /const pick =/, 'there must be no separate picker state');
  assert.match(advisor, /active=\{persona === ut\.id\}/, 'the open card must follow persona');
  assert.match(advisor, /onPick=\{setPersona\}/, 'picking a card must set the profile');
});

test('a persona change is in the fetch dependency list of the advice card', () => {
  // A profile/district/language change must re-run the fetch. Pin the *coverage*
  // of the dep array (active, the type, the location, the language, syncTick)
  // rather than one exact literal, since `loc` may be spread into its fields.
  const deps = advisor.match(/\[active, ut\.id,[^\]]*\]/);
  assert.ok(deps, 'the advice card effect must declare a dependency array');
  for (const need of ['active', 'ut\\.id', 'loc', 'lang', 'syncTick']) {
    assert.match(deps[0], new RegExp(need), `dependency array must cover ${need}`);
  }
});

// --- state that never resets when what it describes changes -----------------
//
// Phase 0 (2026-09-21): HeroCard.jsx was dead code (nothing rendered it);
// HomeHero.jsx is the live hero. The profile-advice caching the first test
// below guarded no longer exists in the rewrite — advice never renders on
// Home — so that test is dropped with the file. The stale-flag and
// provenance invariants move to HomeHero.

test('HomeHero clears the stale flag on ANY answered request', () => {
  // setStale(false) used to sit inside `if (d.warning)`, so a live, calm district
  // stayed labelled CACHED for the rest of the session.
  const then = hero.slice(hero.indexOf('api.warnings(loc.district'), hero.indexOf('api.current('));
  assert.match(then, /setWarn\(d\);/);
  const afterSetWarn = then.slice(then.indexOf('setWarn(d);'));
  const staleIdx = afterSetWarn.indexOf('setStale(false)');
  const warningIdx = afterSetWarn.indexOf('if (d && d.status');
  assert.ok(staleIdx > -1, 'setStale(false) must run on success');
  assert.ok(staleIdx < warningIdx, 'setStale(false) must not be gated behind d.warning');
});

test('the hero status chip cannot say LIVE over a DEMO/CACHED payload', () => {
  // The old card hardcoded 'LIVE' while the evidence line rendered the
  // payload's own provenance, so the card contradicted itself: "LIVE" beside
  // "DEMO". HomeHero derives evProv honestly: pending/aged/unavailable win
  // over the payload's own provenance word, which is the last resort.
  assert.doesNotMatch(hero, /basis === 'unavailable' \? t\(lang, 'basisUnavailable'\) : 'LIVE'/);
  assert.match(hero, /const evProv = pending \? '—' : aged \? 'CACHED' : basis === 'unavailable' \? 'UNAVAILABLE'/);
  assert.match(hero, /\{evProv\}/, 'the evidence line must render the derived provenance');
});

// --- the error boundary ------------------------------------------------------

test('the view error boundary resets when the view changes', () => {
  // Without a key, one crashing view left the boundary in its error state for the
  // whole session: every other (working) view rendered "This view failed".
  assert.match(app, /<Boundary key=\{view\}/);
});

test('the error boundary copy is not hardcoded English', () => {
  assert.doesNotMatch(app, /This view failed to render/);
  assert.doesNotMatch(app, /Nothing was invented to fill the gap/);
  assert.match(app, /t\(lang, 'boundaryTitle'\)/);
});

// --- accessible names on icon-only controls ----------------------------------

test('the notification listen control has an accessible name', () => {
  // Worker 4 (2026-09-21): notifications moved off their own route into the
  // bell's side panel. The Listen control is a real <button> with icon +
  // translated text, never an icon-only span: the text node gives it its
  // accessible name.
  const ntf = src('components/NotificationsPanel.jsx');
  assert.doesNotMatch(ntf, /<span aria-hidden[^>]*>\s*<\/span>\s*<\/button>/);
  assert.match(ntf, /<button[^>]*>[\s\S]{0,120}?t\(lang, 'alertsListen'\)/);
  assert.doesNotMatch(home, /h-notif-speak/, 'Home no longer carries the notification strip');
});

test('chrome labels come from the string files, not hardcoded English', () => {
  assert.doesNotMatch(shell, /DISASTER MODE - verified/);
  assert.match(shell, /t\(lang, 'disasterBanner'\)/);
  // Single light theme: the theme switcher was deliberately deleted, so there
  // is no theme control left to carry a hardcoded or string-file label.
  assert.doesNotMatch(shell, /aria-label="Colour theme"/);
  assert.doesNotMatch(shell, /themeLabel/);
  assert.doesNotMatch(shell, /aria-label="Sections"/);
});

// --- the offline queue has exactly one owner / duplicate definitions ---------

test('the api client defines no method key twice', () => {
  // The uncommitted diff had grown a second copy of the whole notifications
  // block inside `export const api`. In an object literal the later key silently
  // wins, so a future edit to the first copy would do nothing. Scope the scan to
  // the `api` literal itself — sibling exports (demoAlertApi, notificationsApi)
  // legitimately reuse names like `list` and `reset`.
  const start = apiSrc.indexOf('export const api = {');
  assert.ok(start > -1, 'api.js must export the api client object');
  const body = apiSrc.slice(start, apiSrc.indexOf('\n};', start));
  const keys = [...body.matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]);
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  assert.deepEqual(dupes, [], `duplicate api keys: ${dupes.join(', ')}`);
});

test('the store does not clear the offline queue before HomeChat can replay it', () => {
  // flushQueueOnReconnect() cleared the queue on reconnect without replaying, so
  // every question asked while offline was dropped and HomeChat's replay found
  // nothing. HomeChat owns replay (and the clear that follows it).
  // (Phase 0, 2026-09-21: the dead ChatPanel.jsx that used to own this was
  // deleted; the live owner is HomeChat.)
  assert.doesNotMatch(store, /flushQueueOnReconnect/);
  assert.doesNotMatch(store, /clearQueue/);
  assert.doesNotMatch(store, /readQueue/);
});
