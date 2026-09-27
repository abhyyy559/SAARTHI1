// Ask-as-hero regression tests (2026-09-21, Worker 3).
//
// Ask (HomeChat) is the hero of Home: it mounts first, above the compact
// HomeHero verdict bulletin. The aviation briefing stays intact; alert
// mentions live only in the global AlertOverlay (Home carries no per-page
// alert block). The data-tour="home-chat" composer hook and every HomeChat
// capability (voice, speak, advisory handoff, offline queue) are untouched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const home = () => read('../src/components/Home.jsx');
const hero = () => read('../src/components/HomeHero.jsx');
const chat = () => read('../src/components/HomeChat.jsx');
const chatCss = () => read('../src/components/HomeChat.css');
const css = () => read('../src/styles.css');
const strs = () => read('../src/strings/areas/homechat.js');

// --- Ask mounts first; the verdict is kept but demoted -----------------------
test('Ask mounts above HomeHero on Home', () => {
  const h = home();
  const chatAt = h.indexOf('<HomeChat');
  const heroAt = h.indexOf('<HomeHero />');
  assert.ok(chatAt !== -1, 'HomeChat must mount on Home');
  assert.ok(heroAt !== -1, 'HomeHero must stay on Home (safety-critical readout)');
  assert.ok(chatAt < heroAt, 'Ask must render before the verdict card');
});

test('Home carries no per-page alert block; the aviation briefing keeps its behavior', () => {
  const h = home();
  // The alert is mentioned exactly once app-wide: the global AlertOverlay.
  // Home must not repeat it with its own teasers section.
  assert.doesNotMatch(h, /<WarningTeasers/, 'per-page alert teasers are gone from Home');
  assert.doesNotMatch(h, /teaser-list|className="teasers"/, 'no teasers section markup on Home');
  assert.match(h, /persona === 'aviation'/, 'briefing stays gated on the aviation profile');
  assert.match(h, /<AviationBriefing \/>/, 'the briefing mounts on Home');
  assert.match(h, /key=\{`chat:\$\{lang\}:\$\{persona\}:\$\{loc\.district\}`\}/, 'chat identity still resets per lang/role/district');
});

// --- Ask carries the one heading; the tour hook never moved --------------------
test('Ask is the hero: one h1, hero card, composer tour hook intact', () => {
  const j = chat();
  assert.match(j, /className="hc is-hero"/, 'chat section must carry the hero treatment');
  assert.match(j, /<h1 className="hc-hero-title">\{t\(lang, 'askHeroTitle'\)\}<\/h1>/, 'Ask must own the single h1');
  assert.match(j, /className="hc-composer" data-tour="home-chat"/, 'data-tour="home-chat" stays on the composer (OnboardingTour contract)');
  assert.match(j, /dictation\.listen/, 'voice input stays wired');
  assert.match(j, /onOpenAdvisory/, 'advisory escape stays wired');
});

// --- Hero card styling ---------------------------------------------------------
test('hero chat card: white card, 2px ink border, hard shadow, dominant log', () => {
  const c = chatCss();
  assert.match(c, /\.hc\.is-hero\s*\{[^}]*border:\s*2px solid var\(--ink\)/, 'hero card keeps the 2px ink border');
  assert.match(c, /\.hc\.is-hero\s*\{[^}]*box-shadow:\s*6px 6px 0 var\(--ink\)/, 'hero card carries the hardest shadow on the view');
  assert.match(c, /\.hc\.is-hero \.hc-log\s*\{[^}]*min-height:\s*32vh/, 'conversation area dominates the screen');
  for (const sel of ['.hc.is-hero .hc-mic', '.hc.is-hero .hc-send']) {
    const esc = sel.replace(/\./g, '\\.');
    assert.match(c, new RegExp(`${esc}[^}]*?min-height:\\s*52px`), `${sel} stays a ≥44px touch target`);
  }
  // The hero card must tighten, never overflow, at the smallest widths.
  assert.match(c, /@media\s*\(\s*max-width:\s*380px\s*\)[\s\S]*?\.hc\.is-hero/, 'hero card must adapt at ≤380px');
});

// --- HomeHero is compact but honest ---------------------------------------------
test('verdict bulletin is compact: small sky icon, small dial, full contract', () => {
  const c = css();
  assert.match(c, /\.hh-icon\s*\{[^}]*width:\s*64px/, 'sky icon circle is compact (64px, not 128px)');
  assert.doesNotMatch(c, /\.hh-icon\s*\{[^}]*width:\s*128px/, 'the giant wow icon is gone');
  assert.match(c, /\.hh-dial\s*\{[^}]*width:\s*116px/, 'the dial shrinks with the card');
  const j = hero();
  assert.match(j, /const verdict = \(warn && warn\.verdict\)/, 'verdict still comes from the backend, never derived');
  assert.match(j, /data-tour="sky"/, 'the sky tour hook stays put');
  assert.match(j, /formatCountdown/, 'expiry countdown stays');
  assert.match(j, /askAbout|setPendingAsk/, 'ask-about scroll to the chat stays');
});

// --- strings: EN/HI/TE parity, no Tamil script -----------------------------------
test('ask-hero strings: EN/HI/TE parity and no Tamil script', () => {
  const s = strs();
  for (const key of ['askHeroTitle', 'askHeroSub']) {
    const hits = s.match(new RegExp(`${key}: ['"]`, 'g')) || [];
    assert.equal(hits.length, 3, `${key} must exist in EN/HI/TE`);
  }
  assert.doesNotMatch(s, /[\u0B80-\u0BFF]/, 'no Tamil script anywhere');
});
