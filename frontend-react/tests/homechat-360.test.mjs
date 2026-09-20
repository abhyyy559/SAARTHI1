// HomeChat regression tests (source-level, 360px viewport contracts).
//
// Asserts the executable-source contracts for the Home chat board: the
// viewport-aware facts escape popover never overflows the right edge, the
// suggestion chips row cannot create horizontal page overflow and collapses
// to a wrapping 2-col grid at ≤380px, the facts card is icon-led rows, chat
// stays facts-only with an advisory escape, and every new string ships in
// EN/HI/TE with no Tamil script.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const css = () => read('../src/components/HomeChat.css');
const chat = () => read('../src/components/HomeChat.jsx');
const msg = () => read('../src/components/ChatMessage.jsx');
const strs = () => read('../src/strings/areas/homechat.js');

// --- escape popover: never overflows the viewport's right edge ----------------
test('escape popover is viewport-safe: max-width 86vw, anchored to the inline end', () => {
  const c = css();
  assert.match(c, /\.hc-escape-pop\s*\{[^}]*max-width:\s*86vw/, 'popover must cap at 86vw');
  assert.match(c, /\.hc-escape-pop\s*\{[^}]*inset-inline-end:\s*0/, 'popover must anchor to the inline end');
  // Belt and braces: JS clamps the popover's left edge inside the viewport.
  const j = chat();
  assert.match(j, /getBoundingClientRect/, 'HomeChat must measure the popover against the viewport');
  assert.match(j, /translateX/, 'HomeChat must shift the popover when it would leave the screen');
  assert.match(j, /Escape/, 'Esc must close the popover');
});

// --- suggestion chips: no horizontal page overflow -----------------------------
test('chips row snap-scrolls horizontally and collapses to a 2-col grid at ≤380px', () => {
  const c = css();
  assert.match(c, /\.hc-chips\s*\{[^}]*overflow-x:\s*auto/, 'chips row must scroll internally');
  assert.match(c, /\.hc-chips\s*\{[^}]*scroll-snap-type:\s*x/, 'chips must snap-scroll');
  assert.match(c, /@media\s*\(\s*max-width:\s*380px\s*\)/, '≤380px breakpoint must exist');
  const bp = c.slice(c.indexOf('@media (max-width: 380px)'));
  assert.match(bp, /grid-template-columns:\s*1fr 1fr/, '≤380px chips must form a wrapping 2-col grid');
  assert.match(bp, /overflow:\s*visible/, 'grid layout must not scroll horizontally');
  // Visible scroll affordance: edge fade + thin scrollbar on the scroll row.
  assert.match(c, /\.hc-chips-wrap::after/, 'chips row must carry an edge-fade affordance');
  assert.match(c, /scrollbar-width:\s*thin/, 'chips row must show a visible scrollbar');
  // The row itself must never force the page wider.
  assert.doesNotMatch(c, /\.hc-chips\s*\{[^}]*width:\s*100vw/, 'chips row must not be viewport-wide');
});

// --- facts card: icon-led rows --------------------------------------------------
test('facts card is icon-led rows with hierarchy and spacing', () => {
  const j = chat();
  assert.match(j, /hc-facts-card/, 'facts card must exist');
  assert.match(j, /hc-facts-row/, 'facts card must be rows');
  const rows = j.match(/<div className="hc-facts-row">/g) || [];
  assert.ok(rows.length >= 3, `facts card must have ≥3 icon-led rows (found ${rows.length})`);
  assert.match(j, /hc-facts-icon[\s\S]{0,200}<Icon/, 'each row must lead with an icon');
  const c = css();
  assert.match(c, /\.hc-facts-row\s*\{[^}]*display:\s*flex/, 'rows must be flex');
  assert.match(c, /\.hc-facts-row\s*\{[^}]*gap:\s*12px/, 'rows must have spacing');
  assert.match(c, /\.hc-facts-row \+ \.hc-facts-row/, 'rows must be separated');
});

// --- ChatMessage structure ------------------------------------------------------
test('ChatMessage: SevStamp verdict, ≤40-word fold, Based-on line, three action buttons', () => {
  const m = msg();
  assert.match(m, /import\s*{\s*SevStamp\s*}\s*from\s*'\.\/ui'/, 'verdict must render through SevStamp');
  assert.match(m, /verdictLevel/, 'severity must be selected from the backend payload, never derived');
  assert.match(m, /FOLD_WORDS\s*=\s*40/, 'fold must be capped at 40 words');
  assert.match(m, /hcBasedOn/, 'provenance line must be the translated "Based on"');
  for (const key of ['hcListen', 'hcAskAboutThis', 'hcOpenAdvisory']) {
    assert.match(m, new RegExp(key), `action button ${key} must exist`);
  }
  assert.match(m, /hcReadMore/, 'long answers must offer a translated read-more');
});

// --- facts-only boundary ---------------------------------------------------------
test('HomeChat is facts-only: no advisory verbs, advisory reachable only via onOpenAdvisory', () => {
  const j = chat();
  assert.doesNotMatch(j, /you should|stay indoors|drink water|wear a |carry an umbrella|take shelter/i,
    'chat must not carry advisory language — advice lives in Advisory');
  assert.match(j, /onOpenAdvisory/, 'escape must accept the onOpenAdvisory prop');
  const m = msg();
  assert.doesNotMatch(m, /you should|stay indoors|drink water|wear a |carry an umbrella|take shelter/i,
    'ChatMessage must not carry advisory language');
});

// --- no ask route -----------------------------------------------------------------
test('HomeChat never references the removed ask route', () => {
  const j = chat();
  assert.doesNotMatch(j, /setView\(['"]ask['"]\)/, 'must not navigate to an ask view');
  assert.doesNotMatch(j, /['"]\/ask['"]/, 'must not link to an /ask path');
});

// --- offline honesty ----------------------------------------------------------------
test('offline questions get an honest queued chip and replay on reconnect', () => {
  const j = chat();
  assert.match(j, /hcQueuedChip/, 'queued chip must use the translated key');
  assert.match(j, /hcQueuedText/, 'queued text must be the translated waiting-for-network line');
  assert.match(j, /queueQuery/, 'offline questions must be queued');
  assert.match(j, /readQueue/, 'reconnect must replay the queue');
  assert.match(j, /UNKNOWN/, 'offline verdict must be UNKNOWN, never a fake all-clear');
});

// --- streaming -----------------------------------------------------------------------
test('streaming reveals progressively and honours reduced motion', () => {
  const j = chat();
  assert.match(j, /prefers-reduced-motion/, 'must honour reduced motion');
  assert.match(msg(), /hc-caret/, 'streaming must show a caret');
  const c = css();
  assert.match(c, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/, 'caret must stop under reduced motion');
});

// --- sanitize reuse -------------------------------------------------------------------
test('sanitize logic is shared: chatText exports it, both components reuse it', () => {
  assert.match(read('../src/chatText.js'), /export function sanitizeForTTS/, 'chatText must export sanitizeForTTS');
  assert.match(msg(), /from '\.\.\/chatText'/, 'ChatMessage must reuse the shared sanitize, not a second copy');
  assert.match(chat(), /from '\.\.\/chatText'/, 'HomeChat must reuse the shared sanitize, not a second copy');
});

// --- 44px targets ----------------------------------------------------------------------
test('touch targets are ≥44px: mic, send, chips, action buttons', () => {
  const c = css();
  for (const sel of ['.hc-mic', '.hc-send', '.hc-chip', '.hcm-btn', '.hcm-toggle']) {
    const re = new RegExp(`${sel.replace(/\./g, '\\.')}[^}]*min-height:\\s*44px`);
    assert.match(c, re, `${sel} must be at least 44px tall`);
  }
});

// --- strings: EN/HI/TE parity, no Tamil script ------------------------------------------
test('homechat strings: EN/HI/TE parity and no Tamil script', () => {
  const s = strs();
  const keys = ['hcRegion', 'hcFactsTitle', 'hcFactsBody', 'hcFactsEscape', 'hcFactsMore',
    'hcFactsClose', 'hcAs', 'hcComposerHint', 'hcSend', 'hcMicHint', 'hcQueuedChip',
    'hcQueuedText', 'hcListen', 'hcStopListen', 'hcSpeaking', 'hcBasedOn',
    'hcBasedOnSaved', 'hcAskAboutThis', 'hcOpenAdvisory', 'hcComposing',
    'hcSuggestionsHint', 'hcReadMore', 'hcReadLess', 'hcEmptyLine'];
  for (const key of keys) {
    const hits = s.match(new RegExp(`${key}: ['"]`, 'g')) || [];
    assert.equal(hits.length, 3, `${key} must exist in EN/HI/TE`);
  }
  // Tamil block U+0B80–U+0BFF must never appear in any UI string.
  assert.doesNotMatch(s, /[\u0B80-\u0BFF]/, 'no Tamil script anywhere');
});

// --- injectability ------------------------------------------------------------------------
test('HomeChat is injectable: every dependency arrives via props with safe defaults', () => {
  const j = chat();
  for (const p of ['onAsk', 'speak', 'stopSpeaking', 'speechState', 'netState', 'api', 'onOpenAdvisory']) {
    assert.match(j, new RegExp(`${p}\\s*=`), `${p} must be a destructured prop with a default`);
  }
});
