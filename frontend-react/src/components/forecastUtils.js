// Pure helpers for the 7-day forecast card (ForecastCard.jsx). No JSX here —
// this module is importable from node --test, which is how the forecast
// section's logic is unit-tested (components are source-asserted instead).

// Number or null — a missing value is never rendered as 0. An empty string
// is missing, not zero: Number('') is 0 and would fake a "0%" reading.
export function finiteNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Condition word → the one glyph a non-reader recognises. Coarse on purpose:
// the word itself always renders next to the icon — never color alone.
export function conditionIconName(cond) {
  const c = String(cond || '').toLowerCase();
  if (/thunder|storm|lightning/.test(c)) return 'storm';
  if (/rain|drizzle|shower/.test(c)) return 'rain';
  if (/snow|hail|sleet/.test(c)) return 'snow';
  if (/fog|mist|haze|smoke/.test(c)) return 'fog';
  if (/wind|gust|squall/.test(c)) return 'wind';
  if (/clear|sun/.test(c)) return 'sun';
  if (/cloud|overcast/.test(c)) return 'cloud';
  if (/heat|hot/.test(c)) return 'heat';
  return 'cloud';
}

const LOCALES = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };

// A day's label: { main, sub }. Day 0 is "Today", day 1 is "Tomorrow", the
// rest get a localized weekday + date — never a guessed condition, only
// labels. An unparseable date falls back to the raw string, never a crash.
export function dayLabel(dateStr, index, lang, t) {
  const raw = String(dateStr || '').trim();
  const d = new Date(raw);
  const locale = LOCALES[lang] || 'en-IN';
  let short = '';
  if (!Number.isNaN(d.getTime())) {
    try {
      short = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d);
    } catch { short = raw; }
  }
  if (index === 0) return { main: t('fcToday'), sub: short || raw };
  if (index === 1) return { main: t('fcTomorrow'), sub: short || raw };
  let weekday = '';
  if (!Number.isNaN(d.getTime())) {
    try {
      weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d);
    } catch { weekday = ''; }
  }
  return { main: weekday || raw || t('fcToday'), sub: short || '' };
}
