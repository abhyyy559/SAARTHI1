// Offline emergency info card — plain-text QR bundle.
//
// SEPARATE from the app-to-app SOS relay (p2pqr.js): that protocol uses
// rotating multi-frame QRs that only OUR scanner can reassemble. A generic
// phone camera app reads ONE static QR as plain text, so this card is a
// single static QR (or a small manually-flipped numbered set) of plain,
// human-readable text. Anyone can scan it — no app install on the scanner's
// side.
//
// Built ONLY from this phone's saved cache (offline.js snapshots): alerts,
// advisory do's/don'ts, current weather. It never touches the network.
//
// Pure, dependency-free module: no network, no DOM, no React, no i18n —
// labels are passed in by the caller — so plain node tests exercise every
// path.
import { bulletize } from './format.js';

// Static-QR budget. Byte-mode QR at error-correction M holds far more, but
// ~700 chars keeps the code at a version any phone camera scans comfortably
// (same margin p2pqr.js uses per frame).
export const INFO_QR_BUDGET = 700;

// Avoidance matcher — compact twin of Advisor.jsx's AVOID_RE (EN/HI/TE).
// A bullet matching nothing stays in the DO list.
//
// NOTE: \b is ASCII-only even with the u flag, so it can never bound
// Devanagari/Telugu words — the HI/TE alternatives use Unicode-aware
// lookarounds (?<!\p{L}) / (?!\p{L}) instead. (Advisor.jsx's literal /\b…\b/
// has the same latent gap for HI/TE; this module does not inherit it.)
const EN_AVOID = 'avoid|don[\\u0027\\u2019]t|do\\s+not|never|stay\\s+away|keep\\s+away|not\\s+safe|cancel|postpone|hold\\s+off|skip|refrain|delay';
const HI_TE_AVOID = 'बचें|बचे|न\\s*करें|टालें|रद्द|स्थगित|मत\\s*जाएं|नहीं\\s*जाना|మానుకోండి|చేయవద్దు|వద్దు|రద్దు|వాయిదా|వెళ్లవద్దు';
const AVOID_RE = new RegExp(
  `(?:\\b(?:${EN_AVOID})\\b|(?<!\\p{L})(?:${HI_TE_AVOID})(?!\\p{L}))`, 'iu');

function str(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function trunc(s, n) {
  s = str(s);
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

// --- field extractors (defensive: cache shapes drift) -----------------------

function pickAlert(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const headline = str(raw.title || raw.headline || raw.event || raw.hazard || '');
  if (!headline) return null;
  return {
    headline,
    severity: str(raw.severity || raw.level || ''),
    detail: str(raw.instruction || raw.description || ''),
    validTill: str(raw.ends_at || raw.valid_until || raw.expires || ''),
    area: str(raw.area || raw.district || ''),
  };
}

function cardText(card) {
  if (!card) return '';
  if (typeof card === 'string') return card;
  return str(card.detail || card.text || card.lead || card.title || '');
}

function splitDoAvoid(bullets) {
  const doList = [];
  const avoidList = [];
  for (const b of bullets) {
    (AVOID_RE.test(b) ? avoidList : doList).push(b);
  }
  return { doList, avoidList };
}

function weatherLine(obs) {
  if (!obs || typeof obs !== 'object') return '';
  const t = obs.temperature ?? obs.temp ?? obs.temp_c;
  const c = str(obs.condition || obs.weather || obs.description || '');
  const parts = [];
  if (t !== undefined && t !== null && t !== '') {
    const n = Number(t);
    parts.push(`${Number.isFinite(n) ? (Math.round(n * 10) / 10) : t}°C`);
  }
  if (c) parts.push(c);
  return parts.join(', ');
}

// "2026-09-23T17:38:00+05:30" -> "23 Sep, 5:38 PM". Machine-readable,
// locale-independent — a stranger's camera app must parse it too.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatInfoTime(ms) {
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    let h = d.getHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h}:${min} ${ap}`;
  } catch {
    return '';
  }
}

// --- pagination --------------------------------------------------------------

// Greedily pack lines into pages of <= budget chars. When more than one page
// results, every page is prefixed with a "(i/n)" marker line (counted in the
// budget), so a stranger flipping through knows the order. Manual flip only —
// never auto-rotating frames for this feature.
export function paginateLines(lines, budget = INFO_QR_BUDGET) {
  const clean = (Array.isArray(lines) ? lines : []).map((l) => str(l));
  const pack = (markerLen) => {
    const room = budget - markerLen;
    // A single line longer than the budget can never share a page; split it
    // so no emitted page exceeds the budget no matter what the caller passes.
    const feed = [];
    for (const line of clean) {
      if (room <= 0 || line.length <= room) { feed.push(line); continue; }
      for (let i = 0; i < line.length; i += room) feed.push(line.slice(i, i + room));
    }
    const pages = [];
    let cur = [];
    let len = 0;
    for (const line of feed) {
      const add = (cur.length ? 1 : 0) + line.length; // +1 for the newline
      if (cur.length && len + add > room) {
        pages.push(cur);
        cur = [];
        len = 0;
      }
      cur.push(line);
      len += add;
    }
    if (cur.length) pages.push(cur);
    return pages.length ? pages : [[]];
  };
  let pages = pack(0);
  if (pages.length > 1) {
    // Re-pack accounting for the marker line; n is stable after one pass
    // because markers are short and uniform.
    const n = pages.length;
    const markerLen = `(${n}/${n})`.length + 1;
    pages = pack(markerLen);
    return pages.map((p, i) => [`(${i + 1}/${pages.length})`, ...p].join('\n'));
  }
  return [pages[0].join('\n')];
}

// --- main builder ------------------------------------------------------------

// input:
//   alert, warning        raw cached alert / warning objects (alert wins)
//   advisoryCards         array of cached advisory cards (string or object)
//   observation           raw cached current-weather object
//   district              string
//   labels                { title, alert, do, avoid, weatherNow, generated,
//                          cachedNote, noApp, validTill }
//   generatedAt           ms epoch (defaults to now)
//   offline               bool — device currently offline
//   showCachedNote        bool — stamp "cached data, may be outdated"
// returns { pages, pageCount, empty, text }
export function buildInfoCard(input = {}) {
  const {
    alert: alertRaw,
    warning: warningRaw,
    advisoryCards,
    observation,
    district = '',
    labels = {},
    generatedAt = Date.now(),
    offline = false,
    showCachedNote = false,
  } = input;

  const L = {
    title: 'SAARTHI EMERGENCY INFO',
    alert: 'ALERT', do: 'DO', avoid: 'AVOID', weatherNow: 'WEATHER NOW',
    generated: 'Generated', cachedNote: 'Cached data — may be outdated',
    noApp: 'No app needed to read this', validTill: 'Valid till',
    ...labels,
  };

  const alert = pickAlert(alertRaw) || pickAlert(warningRaw);

  // Advisory do's/don'ts: first card with real bullets wins; bulletize splits
  // the detail into sentences like the Advisory view does.
  let doList = [];
  let avoidList = [];
  const cards = Array.isArray(advisoryCards) ? advisoryCards : [];
  for (const card of cards) {
    const bullets = bulletize(cardText(card), 6).map((b) => trunc(b, 110));
    if (!bullets.length) continue;
    ({ doList, avoidList } = splitDoAvoid(bullets));
    break;
  }

  const wx = weatherLine(observation);
  const when = formatInfoTime(generatedAt);

  if (!alert && !doList.length && !avoidList.length && !wx) {
    return { pages: [], pageCount: 0, empty: true, text: '' };
  }

  const head = [];
  head.push(L.title);
  const where = [str(district), when ? `${L.generated} ${when}` : ''].filter(Boolean).join(' · ');
  if (where) head.push(where);
  // Honest stamp: generated-at is always shown; the cached-data warning
  // rides along when the phone is offline or the caller flagged staleness.
  if (showCachedNote || offline) head.push(L.cachedNote);

  // Abhiram's priority order: alert headline+severity, 2–3 do's, 2–3 don'ts,
  // weather line, district+timestamp (already in the header).
  const attempts = [
    { maxDo: 3, maxAvoid: 3, detailChars: 140, bulletChars: 110 },
    { maxDo: 2, maxAvoid: 2, detailChars: 80, bulletChars: 70 },
    { maxDo: 0, maxAvoid: 0, detailChars: 0, bulletChars: 0 }, // alert + stamp only
  ];

  for (const a of attempts) {
    const lines = [...head, ''];
    if (alert) {
      const sev = alert.severity ? ` — ${trunc(alert.severity, 24)}` : '';
      lines.push(`${L.alert}: ${trunc(alert.headline, 90)}${sev}`);
      const sub = [];
      if (alert.validTill) {
        const vt = formatInfoTime(alert.validTill) || alert.validTill;
        sub.push(`${L.validTill} ${vt}`);
      }
      if (a.detailChars && alert.detail) sub.push(trunc(alert.detail, a.detailChars));
      if (sub.length) lines.push(sub.join('. '));
      lines.push('');
    }
    const dos = doList.slice(0, a.maxDo).map((b) => `- ${trunc(b, a.bulletChars)}`);
    const avoids = avoidList.slice(0, a.maxAvoid).map((b) => `- ${trunc(b, a.bulletChars)}`);
    if (dos.length) {
      lines.push(`${L.do}:`);
      lines.push(...dos);
    }
    if (avoids.length) {
      lines.push(`${L.avoid}:`);
      lines.push(...avoids);
    }
    if ((dos.length || avoids.length) && wx) lines.push('');
    if (wx && (a.maxDo > 0 || !alert)) lines.push(`${L.weatherNow}: ${trunc(wx, 80)}`);
    if (!alert && !dos.length && !avoids.length && wx) {
      // weather-only card still needs the stamp context — already in header.
    }
    lines.push('');
    lines.push(L.noApp);

    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length <= INFO_QR_BUDGET) {
      return { pages: [text], pageCount: 1, empty: false, text };
    }
  }

  // Even the minimal card overflowed (pathological input): fall back to
  // numbered static pages the user flips manually. Headline/detail are
  // clamped so every line fits a page comfortably; paginateLines splits
  // anything still overlong as a last resort.
  const lines = [...head, ''];
  if (alert) {
    const sev = alert.severity ? ` — ${trunc(alert.severity, 24)}` : '';
    lines.push(`${L.alert}: ${trunc(alert.headline, 140)}${sev}`);
    if (alert.detail) lines.push(trunc(alert.detail, 400));
    lines.push('');
  }
  for (const b of doList) lines.push(`- ${b}`);
  for (const b of avoidList) lines.push(`- ${b}`);
  if (wx) lines.push(`${L.weatherNow}: ${wx}`);
  lines.push('');
  lines.push(L.noApp);
  const pages = paginateLines(lines);
  return { pages, pageCount: pages.length, empty: false, text: pages.join('\n---\n') };
}
