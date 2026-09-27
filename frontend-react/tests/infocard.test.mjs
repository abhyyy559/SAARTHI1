// Offline emergency info-card QR tests.
//
// Two layers:
//  1. Real unit tests over frontend-react/src/infocard.js (dependency-free,
//     imports cleanly in plain node): budget, priorities, do/avoid split,
//     honesty stamp, pagination, empty state.
//  2. Source-level contracts over InfoCardQr.jsx / Emergency.jsx: the card
//     makes ZERO network calls, never auto-rotates frames (generic camera
//     apps cannot reassemble rotation), and the SOS relay path is untouched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  INFO_QR_BUDGET,
  buildInfoCard,
  formatInfoTime,
  paginateLines,
} from '../src/infocard.js';

const L = {
  title: 'SAARTHI EMERGENCY INFO',
  alert: 'ALERT', do: 'DO', avoid: 'AVOID', weatherNow: 'WEATHER NOW',
  generated: 'Generated', cachedNote: 'Cached data — may be outdated',
  noApp: 'No app needed to read this', validTill: 'Valid till',
};

const SAMPLE_ALERT = {
  title: 'Severe Thunderstorm Warning',
  severity: 'ORANGE',
  instruction: 'Avoid unnecessary outdoor travel between the valid hours. Stay away from exposed areas and follow official safety guidance.',
  ends_at: '2026-09-23T20:00:00+05:30',
  district: 'Hyderabad',
};

const SAMPLE_CARDS = [
  {
    title: 'Thunderstorm advice',
    detail: 'Stay indoors during the storm. Keep away from windows. Do not take shelter under trees. Avoid using wired electrical appliances. Unplug sensitive electronics.',
  },
];

const SAMPLE_OBS = { temperature: 24.9, condition: 'Thunderstorm' };

function fullInput(over = {}) {
  return {
    alert: SAMPLE_ALERT,
    advisoryCards: SAMPLE_CARDS,
    observation: SAMPLE_OBS,
    district: 'Hyderabad',
    labels: L,
    generatedAt: new Date(2026, 8, 23, 17, 38).getTime(),
    offline: true,
    showCachedNote: false,
    ...over,
  };
}

// --- budget ----------------------------------------------------------------

test('typical card fits in ONE static QR under budget', () => {
  const card = buildInfoCard(fullInput());
  assert.equal(card.empty, false);
  assert.equal(card.pageCount, 1);
  assert.ok(card.pages[0].length <= INFO_QR_BUDGET,
    `page is ${card.pages[0].length} chars, budget ${INFO_QR_BUDGET}`);
});

test('priority order: alert headline + severity lead the card', () => {
  const card = buildInfoCard(fullInput());
  const text = card.pages[0];
  const alertAt = text.indexOf('ALERT:');
  const doAt = text.indexOf('\nDO:');
  const avoidAt = text.indexOf('\nAVOID:');
  const wxAt = text.indexOf('WEATHER NOW:');
  assert.ok(alertAt >= 0 && alertAt < doAt, 'alert before DO');
  assert.ok(doAt < avoidAt, 'DO before AVOID');
  assert.ok(avoidAt < wxAt, 'AVOID before weather line');
  assert.match(text, /Severe Thunderstorm Warning/);
  assert.match(text, /ORANGE/);
});

test('pathological input degrades to numbered static pages, each in budget', () => {
  const longCards = Array.from({ length: 6 }, (_, i) => ({
    detail: `Extremely important safety instruction number ${i} that every person must follow immediately without any delay whatsoever. Do not ignore this warning under any circumstances at all. `.repeat(4),
  }));
  const card = buildInfoCard(fullInput({
    advisoryCards: longCards,
    alert: { ...SAMPLE_ALERT, instruction: 'x'.repeat(5000) },
  }));
  assert.ok(card.pageCount >= 1);
  for (const [i, p] of card.pages.entries()) {
    assert.ok(p.length <= INFO_QR_BUDGET, `page ${i} is ${p.length} chars`);
  }
  if (card.pageCount > 1) {
    assert.match(card.pages[0], /^\(1\/\d+\)/m, 'first page carries (1/n) marker');
    assert.match(card.pages[card.pageCount - 1], new RegExp(`^\\(${card.pageCount}/${card.pageCount}\\)`, 'm'));
  }
});

test('paginateLines packs lines greedily and numbers only when needed', () => {
  const one = paginateLines(['a', 'b', 'c'], 100);
  assert.equal(one.length, 1);
  assert.ok(!one[0].includes('(1/1)'), 'single page carries no marker');
  const many = paginateLines(['x'.repeat(60), 'y'.repeat(60), 'z'.repeat(60)], 100);
  assert.ok(many.length > 1);
  assert.match(many[0], /^\(1\/\d+\)/);
  for (const p of many) assert.ok(p.length <= 100);
});

test('paginateLines never emits an over-budget page for one giant line', () => {
  const pages = paginateLines(['x'.repeat(5000)], 100);
  assert.ok(pages.length > 1, 'giant line is split across pages');
  for (const [i, p] of pages.entries()) {
    assert.ok(p.length <= 100, `page ${i} is ${p.length} chars`);
  }
});

test('buildInfoCard clamps pathological headline/detail in the fallback', () => {
  const card = buildInfoCard(fullInput({
    advisoryCards: [],
    alert: {
      title: 'T'.repeat(3000),
      severity: 'ORANGE',
      instruction: 'x'.repeat(5000),
      ends_at: '2026-09-23T20:00:00+05:30',
    },
    observation: null,
  }));
  assert.ok(!card.empty);
  for (const [i, p] of card.pages.entries()) {
    assert.ok(p.length <= INFO_QR_BUDGET, `page ${i} is ${p.length} chars`);
  }
});

// --- honesty -----------------------------------------------------------------

test('generated-at stamp is always present; cached note rides along offline', () => {
  const card = buildInfoCard(fullInput({ offline: true, showCachedNote: false }));
  assert.match(card.pages[0], /Generated 23 Sep, 5:38 PM/);
  assert.match(card.pages[0], /Cached data — may be outdated/);
});

test('cached note appears when snapshots are stale even if online', () => {
  const card = buildInfoCard(fullInput({ offline: false, showCachedNote: true }));
  assert.match(card.pages[0], /Cached data — may be outdated/);
});

test('no cached note when online and fresh', () => {
  const card = buildInfoCard(fullInput({ offline: false, showCachedNote: false }));
  assert.doesNotMatch(card.pages[0], /may be outdated/);
  assert.match(card.pages[0], /Generated/);
});

test('empty cache is honest — no invented card', () => {
  const card = buildInfoCard({ labels: L });
  assert.equal(card.empty, true);
  assert.equal(card.pageCount, 0);
});

test('warning snapshot is a valid alert source when no alert snapshot', () => {
  const card = buildInfoCard(fullInput({
    alert: null,
    warning: { headline: 'Heat wave likely', level: 'YELLOW', description: 'Day temperatures rising.' },
  }));
  assert.equal(card.empty, false);
  assert.match(card.pages[0], /ALERT: Heat wave likely — YELLOW/);
});

test('weather-only card still builds when no alert or advisory exists', () => {
  const card = buildInfoCard({ labels: L, observation: SAMPLE_OBS, district: 'Goa' });
  assert.equal(card.empty, false);
  assert.match(card.pages[0], /WEATHER NOW: 24\.9°C, Thunderstorm/);
});

// --- do / avoid split ----------------------------------------------------------

test('do/avoid split: avoidance verbs go to AVOID in EN', () => {
  const card = buildInfoCard(fullInput({
    alert: null,
    advisoryCards: [{ detail: 'Drink plenty of water. Avoid going out in the afternoon sun. Rest in shade. Do not leave children in parked cars.' }],
  }));
  const text = card.pages[0];
  assert.match(text, /DO:\n- Drink plenty of water\.\n- Rest in shade\./);
  assert.match(text, /AVOID:\n- Avoid going out in the afternoon sun\.\n- Do not leave children in parked cars\./);
});

test('do/avoid split works in HI and TE', () => {
  const hi = buildInfoCard(fullInput({
    alert: null,
    advisoryCards: [{ detail: 'खूब पानी पिएँ। दोपहर में बाहर जाने से बचें। छाँव में आराम करें।' }],
  }));
  assert.match(hi.pages[0], /- खूब पानी पिएँ।/);
  assert.match(hi.pages[0], /बचें/);
  const te = buildInfoCard(fullInput({
    alert: null,
    advisoryCards: [{ detail: 'నీళ్లు ఎక్కువగా తాగండి. మధ్యాహ్నం బయటకు వెళ్లవద్దు.' }],
  }));
  assert.match(te.pages[0], /- నీళ్లు ఎక్కువగా తాగండి\./);
  assert.match(te.pages[0], /వెళ్లవద్దు/);
});

// --- truncation ------------------------------------------------------------------

test('long fields are truncated, never dropped mid-card', () => {
  const card = buildInfoCard(fullInput({
    alert: { ...SAMPLE_ALERT, title: 'T'.repeat(500), instruction: 'I'.repeat(500) },
  }));
  assert.ok(card.pages[0].length <= INFO_QR_BUDGET);
  assert.match(card.pages[0], /ALERT: T{10}/);
  assert.match(card.pages[0], /…/);
});

// --- source contracts ------------------------------------------------------------

const infoCardSrc = readFileSync(new URL('../src/components/InfoCardQr.jsx', import.meta.url), 'utf8');
const emergencySrc = readFileSync(new URL('../src/components/Emergency.jsx', import.meta.url), 'utf8');
const relaySrc = readFileSync(new URL('../src/components/QrRelay.jsx', import.meta.url), 'utf8');

test('InfoCardQr makes zero network calls', () => {
  assert.doesNotMatch(infoCardSrc, /\b fetch\s*\(/);
  assert.doesNotMatch(infoCardSrc, /from '\.\.\/api'/);
  assert.doesNotMatch(infoCardSrc, /XMLHttpRequest|navigator\.sendBeacon/);
});

test('InfoCardQr never auto-rotates: no interval, manual pager only', () => {
  assert.doesNotMatch(infoCardSrc, /setInterval|setTimeout/);
  assert.match(infoCardSrc, /icPrev/);
  assert.match(infoCardSrc, /icNext/);
});

test('QR is rendered static at EC level M via the qrcode package', () => {
  assert.match(infoCardSrc, /from 'qrcode'/);
  assert.match(infoCardSrc, /errorCorrectionLevel: 'M'/);
  assert.match(infoCardSrc, /toDataURL/);
});

test('Emergency console keeps the SOS relay untouched and adds the info card', () => {
  assert.match(emergencySrc, /QrRelay/);
  assert.match(emergencySrc, /emgQrRelay/);
  assert.match(emergencySrc, /InfoCardQr/);
  assert.match(emergencySrc, /icShowBtn/);
});

test('app-to-app SOS relay still rotates frames (unchanged behavior)', () => {
  assert.match(relaySrc, /setInterval/);
  assert.match(relaySrc, /FRAME_MS/);
});

test('formatInfoTime renders a camera-friendly timestamp', () => {
  assert.equal(formatInfoTime(new Date(2026, 8, 23, 17, 38).getTime()), '23 Sep, 5:38 PM');
  assert.equal(formatInfoTime('garbage'), '');
});
