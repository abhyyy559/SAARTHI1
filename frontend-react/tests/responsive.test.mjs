// Responsive invariants: static guards that the design system cannot
// reintroduce the 390px clipping that killed the previous rebuild.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('page never scrolls horizontally', () => {
  assert.ok(/html[^{]*\{[^}]*overflow-x\s*:\s*(clip|hidden)/s.test(css) || /body[^{]*\{[^}]*overflow-x\s*:\s*(clip|hidden)/s.test(css),
    'html/body must clip horizontal overflow');
});

test('grid children cannot blow out their tracks', () => {
  assert.ok(/minmax\(\s*(0|min\(100%)/.test(css), 'grids must use minmax(0, 1fr) or minmax(min(100%, …), 1fr) so long content cannot force overflow');
});

test('box-sizing is border-box', () => {
  assert.ok(/\*\s*,\s*\*::before/.test(css) && /box-sizing\s*:\s*border-box/.test(css));
});

test('touch targets meet 44px minimum', () => {
  assert.ok(/--tap\s*:\s*44px/.test(css), '--tap token must be 44px');
});

test('reduced-motion is respected', () => {
  assert.ok(/prefers-reduced-motion/.test(css), 'must include a prefers-reduced-motion rule');
});

test('alert-status chevron has an explicit size (zero-width-text regression)', () => {
  assert.ok(/\.alert-status\s*>\s*svg\s*\{[^}]*width/.test(css),
    '.alert-status > svg must have an explicit width — an unsized flex-item svg once stole the whole row');
});

test('every icon context sizes its svg (unsized-svg audit)', () => {
  for (const sel of ['\\.loc-btn svg', '\\.role-card > svg', '\\.ac-head \\.as-icon svg', '\\.sky-src svg']) {
    assert.ok(new RegExp(sel + '\\s*\\{[^}]*width').test(css), `${sel} must have an explicit svg width`);
  }
});
test('no fixed desktop pixel widths on layout containers', () => {
  const bad = [];
  for (const m of css.matchAll(/^\s*(?:\.page|\.sky|\.topbar-inner|\.bottom-nav-inner|\.container)[^{]*\{[^}]*width\s*:\s*(\d{3,})px/gm)) {
    bad.push(m[0].slice(0, 60));
  }
  assert.deepEqual(bad, [], `fixed wide layouts found:\n${bad.join('\n')}`);
});
