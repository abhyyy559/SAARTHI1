// QR share: the snapshot travels INSIDE the link (after #), so the page can
// show it even when our server is down, and nothing is stored server-side.
// The # part is never sent to any server by the browser.
//
//   link = <public url>/#s=<payload>
//   payload = 'z' + base64url(deflate-raw(JSON))   (or 'j' + base64url(JSON))
//
// Pure module: runs in node tests (CompressionStream is global in node 18+).

import { condText, fmtDateTime, hazardText, t } from './i18n.js';

const MAX_TEXT = { headline: 140, advisory: 260 };
// Phone-to-phone relay: a snapshot can be passed on at most this many times.
export const MAX_HOPS = 5;
export const MAX_LINK = 1800; // keeps the QR at a version phone cameras read easily

const clip = (s, n) => {
  const x = String(s || '').replace(/\s+/g, ' ').trim();
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};
const r1 = (n) => (n == null || Number.isNaN(Number(n)) ? null : Math.round(Number(n) * 10) / 10);

// Build the compact snapshot from what the Today screen holds.
export function buildSnapshot({ lang, persona, loc, savedAt, verdict, current, days, alerts, advisory, hops }, maxAlerts = 3) {
  return {
    v: 1,
    t: savedAt || Date.now(),
    h: Math.min(MAX_HOPS, Number(hops) || 0),
    l: lang,
    p: persona || 'general',
    loc: [loc?.district || '', loc?.state || '', r1(loc?.lat), r1(loc?.lon)],
    vd: verdict ? [verdict.level || 'UNKNOWN', verdict.severity || '', clip(verdict.hazard, 60),
      (verdict.checked_sources || []).join(','), (verdict.unchecked_sources || []).join(',')] : null,
    w: current ? [r1(current.temperature), current.condition || '', r1(current.rainfall),
      r1(current.wind_speed), r1(current.humidity), current.source || ''] : null,
    f: (days || []).slice(0, 3).map((d) => [d.date, d.condition || '', r1(d.rainfall),
      r1(d.max_temperature), r1(d.min_temperature)]),
    a: (alerts || []).slice(0, maxAlerts).map((a) => [a.severity || '', clip(a.hazard, 50),
      clip(a.headline || a.message, MAX_TEXT.headline), a.expires || '', clip(a.sender || a.source, 40)]),
    adv: clip(advisory, MAX_TEXT.advisory),
  };
}

// Expand back into readable fields for the share page.
export function readSnapshot(s) {
  if (!s || s.v !== 1) throw new Error('unsupported snapshot');
  const [district, state, lat, lon] = s.loc || [];
  const vd = s.vd && {
    level: s.vd[0], severity: s.vd[1] || null, hazard: s.vd[2] || null,
    checked_sources: s.vd[3] ? s.vd[3].split(',') : [], unchecked_sources: s.vd[4] ? s.vd[4].split(',') : [],
  };
  const w = s.w && {
    temperature: s.w[0], condition: s.w[1], rainfall: s.w[2], wind_speed: s.w[3], humidity: s.w[4], source: s.w[5],
  };
  return {
    savedAt: s.t, lang: s.l || 'en', persona: s.p || 'general', hops: Number(s.h) || 0,
    loc: { district, state, lat, lon },
    verdict: vd, current: w,
    days: (s.f || []).map(([date, condition, rainfall, max_temperature, min_temperature]) =>
      ({ date, condition, rainfall, max_temperature, min_temperature })),
    alerts: (s.a || []).map(([severity, hazard, headline, expires, sender]) =>
      ({ severity, hazard, headline, expires, sender })),
    advisory: s.adv || '',
  };
}

// ---- bytes <-> base64url ---------------------------------------------------
function toB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeSnapshot(snap) {
  const json = new TextEncoder().encode(JSON.stringify(snap));
  if (typeof CompressionStream !== 'undefined') {
    try { return `z${toB64url(await pipe(json, new CompressionStream('deflate-raw')))}`; } catch { /* fall through */ }
  }
  return `j${toB64url(json)}`;
}

export async function decodeSnapshot(payload) {
  const kind = payload[0];
  const bytes = fromB64url(payload.slice(1));
  let json;
  if (kind === 'z') json = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind === 'j') json = bytes;
  else throw new Error('unknown payload');
  return JSON.parse(new TextDecoder().decode(json));
}

// Fit the link under MAX_LINK by dropping alerts, then the advisory.
export async function makeShareLink(base, input) {
  const root = String(base || '').replace(/\/$/, '');
  for (const maxAlerts of [3, 2, 1, 0]) {
    const snap = buildSnapshot(input, maxAlerts);
    for (const withAdvice of [true, false]) {
      if (!withAdvice) snap.adv = '';
      const link = `${root}/#s=${await encodeSnapshot(snap)}`;
      if (link.length <= MAX_LINK) return link;
    }
  }
  const snap = buildSnapshot({ ...input, alerts: [], advisory: '' }, 0);
  return `${root}/#s=${await encodeSnapshot(snap)}`;
}

export function payloadFromHash(hash) {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash || '');
  return m ? m[1] : null;
}

// Plain-text version for a QR any camera can read with no internet at all:
// the phone shows the words directly, no page to load. Kept short so the
// code stays easy to scan.
export function textSummary(input, lang = 'en', maxLen = 420) {
  const L = (k, v) => t(lang, k, v);
  const v = input.verdict || {};
  const c = input.current || {};
  const tm = (input.days || [])[1];
  const lines = [
    `WeatherGPT · ${input.loc?.district || ''}${input.loc?.state ? `, ${input.loc.state}` : ''}`,
    fmtDateTime(input.savedAt, lang),
    `${L(`lv${v.level || 'UNKNOWN'}`)}${v.hazard && v.level !== 'LOW' ? `: ${hazardText(v.hazard, lang)}` : ''}`,
  ];
  if (c.temperature != null) lines.push(`${L('now')} ${Math.round(c.temperature)}°C ${condText(c.condition, lang)}`);
  if (tm && tm.rainfall != null) lines.push(`${L('tomorrow')} ${L('rain')} ${Math.round(tm.rainfall * 10) / 10} mm`);
  // Same wording twice is one alert; and when the district has none, the
  // listed alerts are elsewhere in the state and must say so.
  const seen = new Set();
  const alerts = (input.alerts || []).filter((a) => {
    const k = `${a.severity}|${a.hazard}|${a.expires}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 2);
  if (alerts.length && v.level === 'LOW') lines.push(`${L('elsewhere')}:`);
  for (const a of alerts) {
    lines.push(`${a.severity || '?'} ${hazardText(a.hazard, lang)}${a.expires ? ` · ${L('until', { t: fmtDateTime(a.expires, lang) })}` : ''}`);
  }
  lines.push('112');
  let out = lines.filter(Boolean).join('\n');
  if (out.length > maxLen) out = `${out.slice(0, maxLen - 1)}…`;
  return out;
}
