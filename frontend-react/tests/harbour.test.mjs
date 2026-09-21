// Harbour Signal redesign regression tests (source-level).
//
// These assert executable-source contracts for the redesign: the exact
// simulated-P2P wording, the 5s notification timeout, banner scoping, the
// unset-persona honesty, the source-status cards, and that severity is only
// ever translated (never derived) on the client.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// --- P2P honesty -----------------------------------------------------------
test('every P2P occurrence carries the exact simulated label', () => {
  // Emergency + AlertDetails render the label through the p2pSimulated key;
  // assert the key exists in the components AND resolves to the exact label
  // in all three languages (checked in alerts.js), plus the verbatim usage
  // in NotificationCenter / P2PDemo.
  // (Worker 4: NotificationCenter was superseded by the notifications side
  // panel — the verbatim usage now lives in NotificationsPanel.)
  for (const f of ['../src/components/Emergency.jsx', '../src/components/AlertDetails.jsx']) {
    const code = read(f);
    assert.match(code, /p2pSimulated/, `${f} must render the translated simulated label`);
    assert.match(code, /p2p-simulated/, `${f} must stamp the simulated panel`);
  }
  const alerts = read('../src/strings/areas/alerts.js');
  const hits = alerts.match(/p2pSimulated: 'SIMULATED — FOR DEMO ONLY',/g) || [];
  assert.equal(hits.length, 3, 'p2pSimulated must be the exact label in EN/HI/TE');
  const ntf = read('../src/components/NotificationsPanel.jsx');
  assert.match(ntf, /ntfSimulatedTag/, 'notification rows must stamp simulated P2P');
  const hs = read('../src/strings/areas/harboursignal.js');
  assert.match(hs, /ntfSimulatedTag: 'SIMULATED — FOR DEMO ONLY'/);
});

test('emergency inbox filters to the per-session sender id', () => {
  const code = read('../src/components/Emergency.jsx');
  assert.match(code, /sessionStorage/);
  assert.match(code, /\.sender_id === sid/, 'inbox must filter to the current browser session');
});

test('SOS armed copy is a translated "Tap again to send", and sending is separate', () => {
  const code = read('../src/components/Emergency.jsx');
  assert.match(code, /sosArmedFire/, 'armed button must use the translated sosArmedFire key');
  assert.match(code, /sosSending/, 'actual request must use the translated sosSending key');
  assert.doesNotMatch(code, /"Tap again to send"/, 'no hardcoded English UI copy');
  const strs = read('../src/strings/areas/harboursignal.js');
  for (const key of ['sosArmedFire', 'sosSending'])
    assert.match(strs, new RegExp(key), `${key} must be translated for EN/HI/TE`);
});

// --- notifications ----------------------------------------------------------
test('notification fetch has a 5-second timeout and caches the list', () => {
  const api = read('../src/api.js');
  assert.match(api, /FETCH_TIMEOUT_MS\s*=\s*5000/);
  assert.match(api, /AbortSignal\.timeout|AbortController/, 'j() must actually enforce the timeout');
  const ntf = read('../src/components/NotificationsPanel.jsx');
  assert.match(ntf, /saveNotificationSnapshot/);
  assert.match(ntf, /readNotificationSnapshot/);
  assert.match(ntf, /ntfRetry/, 'failed fetch must offer a translated Retry');
  assert.match(ntf, /ntfSavedTag/, 'cached items must be labelled "Saved on this phone"');
});

// --- persona honesty ---------------------------------------------------------
test('persona starts null — no silent Fisherman default', () => {
  const store = read('../src/store.jsx');
  assert.match(store, /useState\(null\)/, 'persona state must start null');
  assert.match(store, /wgpt\.persona\.v2/, 'one-time migration marker');
  assert.doesNotMatch(store, /useState\('fisherman'\)/);
});

test('requests fall back explicitly to general when no role is set', () => {
  // Phase 0 (2026-09-21): ChatPanel.jsx/ProfileAdvice.jsx/HeroCard.jsx were
  // dead code (nothing rendered them). HomeChat.jsx is the live chat path and
  // carries the fallback; Advisor passes the picked card's own id (never null
  // at the call site) and HomeHero sends no persona.
  const code = read('../src/components/HomeChat.jsx');
  assert.match(code, /persona \|\| 'general'/, 'HomeChat must pass persona || \'general\'');
});

// --- severity: translate only, never derive ----------------------------------
test('SevStamp translates backend severity codes to citizen words, never derives them', () => {
  const ui = read('../src/components/ui.jsx');
  assert.match(ui, /SevStamp/);
  assert.match(ui, /t\(lang, /, 'severity words must go through the translator');
  // The map is translation only: backend canonical codes -> i18n keys. The
  // level always arrives as a prop (backend-provided) and is never computed
  // from warning payload fields inside the component.
  assert.match(ui, /sevWord\(lang, level\)/);
  assert.match(ui, /level,\s*stamp/, 'SevStamp destructures the backend level from props');
  assert.doesNotMatch(ui, /w\.severity|warning\.severity|verdict\.hazard/, 'must not read severity off a payload');
});

// --- sources / trust citizen copy --------------------------------------------
test('SourceStatus gives each source one citizen line and a Why? disclosure', () => {
  const code = read('../src/components/SourceStatus.jsx');
  for (const id of ['cap', 'open-meteo', 'wis2', 'imd']) assert.match(code, new RegExp(`id: '${id}'`));
  for (const icon of ['bell', 'globe', 'radio', 'thermometer']) assert.match(code, new RegExp(`icon: '${icon}'`));
  assert.match(code, /srcWhy/, 'machine vocabulary must live behind "Why?"');
  assert.match(code, /srcLineLive/, 'citizen line for LIVE');
  assert.match(code, /srcLineUnconfigured/, 'citizen line for UNCONFIGURED');
});

test('SourceStrip uses one meaningful icon per source', () => {
  const code = read('../src/components/SourceStrip.jsx');
  assert.match(code, /SRC_ICON/);
  assert.match(code, /thermometer/);
});

// --- banner scoping ------------------------------------------------------------
test('demo-data banner only shows on demo-content views', () => {
  const code = read('../src/components/Shell.jsx');
  // IA dedup (2026-09-20): ask/advisor/details/sources routes are gone; the
  // banner follows the demo-content routes. Aviation is a profile now — its
  // briefing renders on Home, which is already in the banner set.
  for (const v of ['home', 'alerts', 'advisory', 'notifications', 'offline', 'trust'])
    assert.match(code, new RegExp(`'${v}'`), `banner set must include ${v}`);
  for (const v of ['ask', 'details', 'sources', 'advisor', 'aviation'])
    assert.doesNotMatch(code, new RegExp(`'${v}'`), `banner set must not include removed view ${v}`);
  assert.match(code, /showDemoBanner/, 'banner must be gated, not always-on in demo mode');
});

// --- view heading ----------------------------------------------------------------
test('ViewHead renders the nav kicker only when it differs from the H1', () => {
  const code = read('../src/components/ViewHead.jsx');
  assert.match(code, /showKicker/, 'kicker must be conditional');
  assert.match(code, /!== h1/, 'kicker must be suppressed when it duplicates the h1');
});

// --- offline answers: translated, never a fake all-clear -----------------------
test('answerOffline is fully translated and carries the cannot-check wording', () => {
  const code = read('../src/offline.js');
  assert.match(code, /offlineNewWarning/, 'new-warning offline path must be translated');
  assert.match(code, /offlineCachedTag/, 'cached guidance must be labelled translated');
  assert.match(code, /offlineNoAnswer/, 'fallback must be translated');
  assert.doesNotMatch(code, /'I cannot verify new information/, 'no hardcoded English');
  const hs = read('../src/strings/areas/harboursignal.js');
  for (const key of ['offlineNewWarning', 'offlineCachedTag', 'offlineNoAnswer']) {
    const hits = hs.match(new RegExp(`${key}: '`, 'g')) || [];
    assert.equal(hits.length, 3, `${key} must exist in EN/HI/TE`);
  }
});

test('sev word keys exist for EN/HI/TE', () => {
  // sevRed/sevOrange/... live in i18n.js's core dictionary (overridable by areas).
  const dict = read('../src/i18n.js');
  for (const key of ['sevRed', 'sevOrange', 'sevYellow', 'sevGreen', 'sevUnknown']) {
    const hits = dict.match(new RegExp(`${key}: '`, 'g')) || [];
    assert.equal(hits.length, 3, `${key} must exist in EN/HI/TE`);
  }
});

test('offline verdict detail is translated with the cannot-check wording', () => {
  // Phase 0 (2026-09-21): ChatPanel.jsx was dead code (nothing rendered it);
  // HomeChat.jsx is the live chat and answers offline questions through
  // answerOffline(), whose cannot-check wording is pinned by the
  // 'answerOffline is fully translated' test above. This guards that the live
  // chat keeps that path — a future chat rewrite must not drop it silently.
  const code = read('../src/components/HomeChat.jsx');
  assert.match(code, /answerOffline\(/, 'the live chat must answer offline via answerOffline()');
  assert.match(code, /verdict: \{ level: 'UNKNOWN', confirmed: false, basis: 'unavailable' \}/,
    'offline answers must carry an unavailable verdict, never a calm');
  const hs = read('../src/strings/areas/harboursignal.js');
  const hits = hs.match(/offlineVerdictDetail: '/g) || [];
  assert.equal(hits.length, 3, 'offlineVerdictDetail must exist in EN/HI/TE');
});

// --- City operations panel (§4 smart-city gap) ----------------------------------
test('CityOpsPanel renders facts only: no advice language, no client-side severity', () => {
  const code = read('../src/components/CityOpsPanel.jsx');
  assert.match(code, /api\.current\(/, 'must read the real current endpoint');
  assert.match(code, /api\.forecast\(/, 'must read the real forecast endpoint');
  assert.match(code, /api\.warnings\(/, 'must read the official warnings endpoint');
  assert.match(code, /SevStamp/, 'alert severity must render through the canonical stamp');
  assert.match(code, /a\.severity \|\| 'UNKNOWN'/, 'UNKNOWN must survive as UNKNOWN, never recoloured');
  assert.doesNotMatch(code, /air_pollution|aqi_endpoint|aqi_value|pm2/i,
    'no invented AQI data plumbing — it must stay omitted');
  assert.match(code, /no backend adapter provides an air-quality feed/,
    'the AQI omission must be documented in the component');
  // Facts only: imperative advisory verbs must not appear in user-facing copy.
  assert.doesNotMatch(code, /wear a |drink water|carry an umbrella|stay indoors|should stay|should wear/i,
    'panel must not carry advisory language — advice lives in Advisory');
});

test('CityOpsPanel concurrency: the three fetches run in parallel', () => {
  const code = read('../src/components/CityOpsPanel.jsx');
  assert.match(code, /Promise\.allSettled/, 'independent fetches must not serialize');
});

test('cityops strings: EN/HI/TE parity and no Tamil script', () => {
  const strs = read('../src/strings/areas/cityops.js');
  const keys = ['cityOpsTitle', 'cityOpsSub', 'cityHeat', 'cityHeatNow', 'cityHeatMax',
    'cityRain', 'cityRainObs', 'cityRainFcst', 'cityAlerts', 'cityAlertsNone',
    'cityAlertsActive', 'cityAlertsSevNote', 'cityUnavailable', 'cityLoading',
    'cityFailed', 'cityRetry'];
  for (const key of keys) {
    const hits = strs.match(new RegExp(`${key}: ['"]`, 'g')) || [];
    assert.equal(hits.length, 3, `${key} must exist in EN/HI/TE`);
  }
  // Tamil block U+0B80–U+0BFF must never appear in any UI string.
  assert.doesNotMatch(strs, /[\u0B80-\u0BFF]/, 'no Tamil script anywhere');
});

test('TrustView renders CityOpsPanel (Trust route owns the city-ops snapshot)', () => {
  const views = read('../src/views.jsx');
  assert.match(views, /import CityOpsPanel/, 'TrustView must import the panel');
  assert.match(views, /<CityOpsPanel \/>/, 'TrustView must render the panel');
  assert.match(views, /CityOpsPanel \/>[\s\S]{0,200}<HowItWorks/, 'panel sits on Trust before HowItWorks');
});

test('CityOpsPanel honest states: UNAVAILABLE per metric, translated retry', () => {
  const code = read('../src/components/CityOpsPanel.jsx');
  assert.match(code, /cityUnavailable/, 'missing values must render an honest unavailable state');
  assert.match(code, /UNAVAILABLE/, 'provenance fallback must be honest UNAVAILABLE, never a guess');
  assert.match(code, /cityRetry/, 'failed fetch must offer a translated retry');
  assert.match(code, /aria-live="polite"/, 'async state must be announced politely');
  assert.doesNotMatch(code, /"No active official alerts/, 'no hardcoded English alert copy');
});
