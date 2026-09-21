// Alert overlay + advisory bullets (2026-09-21, Abhiram's direction).
//
// 1. An alert is mentioned exactly ONCE app-wide: a single slim overlay that
//    sits on top of all pages and appears only while alerts are active.
//    Per-page alert blocks (Home teasers) are gone; the Alerts view stays
//    the one full home. The overlay never pushes content (position:fixed),
//    is dismissible, and re-announces when the alert set changes.
// 2. Advisory advice renders as short bullet points, never walls of text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const TAMIL = /[\u0B80-\u0BFF]/;

// --- the single overlay -------------------------------------------------------
test('overlay: one global pill rendered by the Shell, on top of every page', () => {
  const shell = read('../src/components/Shell.jsx');
  assert.match(shell, /<AlertOverlay \/>/, 'Shell renders the global alert overlay');
  const ovl = read('../src/components/AlertOverlay.jsx');
  assert.match(ovl, /role="status"/, 'overlay announces politely to screen readers');
  assert.match(ovl, /setView\('alerts'\)/, 'tapping the pill opens the Alerts view');
});

test('overlay: appears only while alerts are active, dismissible per alert set', () => {
  const ovl = read('../src/components/AlertOverlay.jsx');
  assert.match(ovl, /if \(items\.length === 0\) return null/, 'no alerts → no overlay');
  assert.match(ovl, /isExpired/, 'expired alerts never surface the overlay');
  assert.match(ovl, /dismissedKey/, 'dismissal is tracked');
  assert.match(ovl, /setKey/, 'dismissal is keyed to the alert set, so a new alert re-announces');
});

test('overlay: never disturbs the page — fixed, click-through wrapper', () => {
  const css = read('../src/styles.css');
  const block = css.match(/\.alert-overlay \{[\s\S]*?\n\}/);
  assert.ok(block, '.alert-overlay CSS block must exist');
  assert.match(block[0], /position:\s*fixed/, 'overlay is fixed: it never pushes content');
  assert.match(block[0], /pointer-events:\s*none/, 'wrapper is click-through; only the pill takes taps');
  assert.match(block[0], /bottom:/, 'bottom-anchored, clear of the sticky topbar');
});

test('overlay: most urgent alert leads, count is honest', () => {
  const ovl = read('../src/components/AlertOverlay.jsx');
  assert.match(ovl, /SEV_RANK/, 'alerts are severity-ranked');
  assert.match(ovl, /ovlActiveOne/, 'singular count label');
  assert.match(ovl, /ovlActiveMany/, 'plural count label with {n}');
});

test('overlay: EN/HI/TE strings exist, no Tamil script', () => {
  const area = read('../src/strings/areas/alerts.js');
  for (const key of ['ovlActiveOne', 'ovlActiveMany', 'ovlDismiss', 'ovlOpenAlerts']) {
    const hits = area.match(new RegExp(`^\\s*${key}:`, 'gm')) || [];
    assert.equal(hits.length, 3, `${key} must exist in en, hi and te`);
  }
  assert.ok(!TAMIL.test(area), 'no Tamil script in the alerts area strings');
});

test('alert rows: DOM ids are unique across the active and ended sections', () => {
  const list = read('../src/components/AlertsList.jsx');
  // renderRows is invoked once per section — the id must carry the section
  // prefix, otherwise alert-row-0 exists twice (active + ended lists).
  assert.match(list, /const renderRows = \(list, section\)/, 'renderRows takes a section');
  assert.match(list, /`alert-row-\$\{section\}-\$\{i\}`/, 'row id is section-prefixed');
  assert.match(list, /renderRows\(activeAlerts, 'active'\)/, 'active section passes its prefix');
  assert.match(list, /renderRows\(endedAlerts, 'ended'\)/, 'ended section passes its prefix');
});

test('no per-page alert repeats remain', () => {
  const home = read('../src/components/Home.jsx');
  assert.doesNotMatch(home, /<WarningTeasers/, 'Home renders no alert teaser component');
  assert.doesNotMatch(home, /teaser-list|className="teasers"/, 'Home has no alert teaser markup');
});

// --- advisory bullets ----------------------------------------------------------
test('bulletize: prose becomes capped short bullets', async () => {
  const { bulletize, splitAdvisory } = await import('../src/format.js');
  assert.deepEqual(bulletize('', 5), [], 'empty → no bullets');
  assert.deepEqual(
    bulletize('Stay indoors. Avoid travel.', 5),
    ['Stay indoors.', 'Avoid travel.'],
    'sentences become bullets',
  );
  const long = 'One. Two. Three. Four. Five. Six. Seven.';
  assert.equal(bulletize(long, 5).length, 5, 'bullets are capped');
  assert.ok(splitAdvisory('Stay indoors. Avoid travel.').lead, 'splitAdvisory still intact');
});

test('Advisor: detail renders as bullets, not a paragraph', () => {
  const adv = read('../src/components/Advisor.jsx');
  assert.match(adv, /bulletize\(split\.detail, 5\)/, 'detail goes through bulletize (cap 5)');
  assert.match(adv, /<ul className="adv-bullets">/, 'detail renders as a bullet list');
  assert.doesNotMatch(adv, /<p className="sub">\{split\.detail\}<\/p>/, 'no paragraph wall of text');
});

test('AdviceCards: multi-sentence body becomes bullets', () => {
  const cards = read('../src/components/AdviceCards.jsx');
  assert.match(cards, /bulletize\(card\.body, 4\)/, 'body goes through bulletize (cap 4)');
  assert.match(cards, /<ul className="adv-bullets"/, 'multi-sentence body renders as bullets');
  assert.match(cards, /bodyBullets\.length > 1/, 'single-sentence body stays a single line');
});

test('advisory bullets: CSS exists', () => {
  const css = read('../src/styles.css');
  assert.match(css, /\.adv-bullets \{/, '.adv-bullets styles must exist');
});
