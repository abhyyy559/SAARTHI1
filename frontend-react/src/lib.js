// Pure presentation logic: sky theme selection, severity metadata, formatters.
// No React, no DOM — unit tested in tests/.

/** Condition keyword -> canonical kind. */
export function conditionKind(condition = '') {
  const c = String(condition).toLowerCase();
  if (/thunder|storm|lightning/.test(c)) return 'storm';
  if (/rain|drizzle|shower|monsoon/.test(c)) return 'rain';
  if (/snow|hail|sleet/.test(c)) return 'snow';
  if (/fog|mist|haze|smoke|dust/.test(c)) return 'fog';
  if (/clear|sunny|fair/.test(c)) return 'clear';
  if (/cloud|overcast/.test(c)) return 'cloudy';
  return 'clear';
}

/** Hour (0-23) -> 'day' | 'night'. Day = 06:00-17:59 local. */
export function daypart(hour) {
  const h = Number(hour);
  if (Number.isNaN(h)) return 'day';
  return h >= 6 && h < 18 ? 'day' : 'night';
}

/** Extract local hour from an ISO timestamp, fallback to now. */
export function hourOf(iso) {
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.getHours();
  }
  return new Date().getHours();
}

/**
 * Sky theme id for the hero: e.g. 'clear-day', 'rain-night', 'storm-day'.
 * Drives the gradient + artwork + ink color.
 */
export function skyTheme(condition, isoOrHour) {
  const kind = conditionKind(condition);
  const hour = typeof isoOrHour === 'number' ? isoOrHour : hourOf(isoOrHour);
  return `${kind}-${daypart(hour)}`;
}

/** Severity string -> { key (i18n), tone, icon }. Tone drives color+icon+text. */
export function severityMeta(severity = '') {
  const s = String(severity).toUpperCase();
  if (s.includes('EXTREME')) return { key: 'sevExtreme', tone: 'bad', rank: 4 };
  if (s.includes('SEVERE') || s === 'RED') return { key: 'sevSevere', tone: 'bad', rank: 3 };
  if (s.includes('MODERATE') || s === 'ORANGE' || s === 'YELLOW') return { key: 'sevModerate', tone: 'warn', rank: 2 };
  if (s.includes('MINOR') || s === 'GREEN') return { key: 'sevMinor', tone: 'ok', rank: 1 };
  return { key: 'sevUnknown', tone: 'muted', rank: 0 };
}

/** Backend source status -> { key (i18n), tone }. */
export function sourceStatusMeta(status = '') {
  const s = String(status).toUpperCase();
  if (s === 'LIVE') return { key: 'stLive', tone: 'ok' };
  if (s === 'CACHED') return { key: 'stCached', tone: 'warn' };
  if (s === 'UNCONFIGURED') return { key: 'stUnconfigured', tone: 'muted' };
  if (s === 'OFFLINE') return { key: 'stOffline', tone: 'muted' };
  if (s === 'READY') return { key: 'stReady', tone: 'info' };
  return { key: 'stError', tone: 'bad' };
}

/** Normalize backend source names for display; unknown names pass through. */
export function sourceDisplayName(name = '') {
  const n = String(name).toLowerCase().replace(/[^a-z]/g, '');
  const map = {
    imd: 'src_imd',
    openmeteo: 'src_open_meteo',
    owm: 'src_owm',
    openweathermap: 'src_owm',
    cap: 'src_cap',
    sachet: 'src_cap',
    govdata: 'src_govdata',
    stt: 'src_stt',
    tts: 'src_tts',
    gis: 'src_gis',
  };
  return map[n] || null; // null -> render raw name
}

/** Group a /api/sources entry into Weather | Alerts | Voice | More. */
export function sourceGroup(name = '') {
  const n = String(name).toLowerCase();
  if (/imd|meteo|owm|weather|govdata|nwp|climate/.test(n)) return 'gWeather';
  if (/cap|sachet|alert|warn/.test(n)) return 'gAlerts';
  if (/stt|tts|voice|sarvam|speech/.test(n)) return 'gVoice';
  return 'gMore';
}

/** "2 min ago" style relative time; returns a t()-ready {key, params}. */
export function agoParts(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const ms = nowMs - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return { key: 'justNow', params: {} };
  const min = Math.floor(ms / 60000);
  if (min < 1) return { key: 'justNow', params: {} };
  if (min < 60) return { key: 'minAgo', params: { n: min } };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { key: 'hrAgo', params: { n: hr } };
  return null; // too old to be useful; caller shows absolute date instead
}

export function fmtTemp(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  return `${Math.round(Number(v))}°`;
}

export function fmtWind(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  return `${Math.round(Number(v))}`;
}

/** Wind degrees -> 8-point compass. */
export function compass(deg) {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return '';
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return pts[Math.round(Number(deg) / 45) % 8];
}

/** Short weekday label for a YYYY-MM-DD date. */
export function weekdayLabel(isoDate, lang = 'en') {
  try {
    const d = new Date(`${isoDate}T12:00:00`);
    if (Number.isNaN(d.getTime())) return isoDate;
    const loc = lang === 'hi' ? 'hi-IN' : lang === 'te' ? 'te-IN' : 'en-IN';
    return d.toLocaleDateString(loc, { weekday: 'short' });
  } catch {
    return isoDate;
  }
}

/** Alert lifecycle: active vs expired from validity window. Never treat an
 *  expired warning as active — missing end time counts as unknown, not live. */
export function alertIsActive(alert, nowMs = Date.now()) {
  if (!alert) return false;
  const end = alert.expires || alert.ends || alert.ends_at || alert.valid_until || alert.end_time || alert.endsAt;
  if (!end) return false;
  const ms = new Date(end).getTime();
  if (Number.isNaN(ms)) return false;
  if (alert.lifecycle_state && /expir|complet|cancel/.test(String(alert.lifecycle_state).toLowerCase())) return false;
  return ms > nowMs;
}

/* The /v1/warnings payload mixes two shapes:
 *   - IMD warning: {source:'IMD', hazard, severity, district, message, issued_at, valid_until}
 *   - SACHET CAP alert: {identifier, headline, message, severity, expires, issued_at, sender, instruction, area}
 * normalizeAlert collapses either into one UI record with a computed `active`
 * flag, so every view agrees on what counts as active. */
export function normalizeAlert(a = {}, opts = {}) {
  if (a && a.__normalized) return opts.nearby ? { ...a, nearby: true } : a;
  const cap = !!a.identifier;
  const severity = String(a.severity || 'UNKNOWN').toUpperCase();
  return {
    __normalized: true,
    id: a.identifier || `imd-${a.district || ''}-${a.hazard || ''}`,
    title: cap ? (a.headline || a.hazard || '') : (a.hazard || ''),
    body: a.message || a.description || '',
    instruction: a.instruction || a.recommended_action || '',
    severity,
    sender: a.sender || a.source || (cap ? 'SACHET' : 'IMD'),
    issuedAt: a.issued_at || a.sent || '',
    endsAt: a.expires || a.ends || a.ends_at || a.valid_until || a.end_time || '',
    area: a.area || a.district || '',
    hazard: a.hazard || '',
    official: a.official !== false,
    nearby: !!opts.nearby,
    active: alertIsActive(a),
  };
}

/** Severity string -> canonical UI level. */
export function alertLevel(a = {}) {
  const s = String(a.severity || '').toUpperCase();
  if (s === 'EXTREME') return 'extreme';
  if (s === 'SEVERE' || s === 'RED') return 'severe';
  if (s === 'MODERATE' || s === 'ORANGE' || s === 'YELLOW') return 'moderate';
  if (s === 'MINOR' || s === 'GREEN') return 'minor';
  return 'unknown';
}

/* Combine a /v1/warnings payload: the IMD warning first, then CAP alerts
 * verified for this district, then nearby state alerts (flagged). */
export function collectAlerts(data) {
  if (!data) return [];
  const out = [];
  if (data.warning) out.push(normalizeAlert(data.warning));
  for (const a of data.cap_alerts || []) out.push(normalizeAlert(a));
  for (const a of data.nearby_alerts || []) out.push(normalizeAlert(a, { nearby: true }));
  return sortAlerts(out);
}

/** Rank alerts: active first, then by severity rank, then newest. */
export function sortAlerts(alerts, nowMs = Date.now()) {
  return [...alerts].sort((a, b) => {
    const aa = alertIsActive(a, nowMs) ? 1 : 0;
    const bb = alertIsActive(b, nowMs) ? 1 : 0;
    if (aa !== bb) return bb - aa;
    const r = severityMeta(b.severity).rank - severityMeta(a.severity).rank;
    if (r !== 0) return r;
    return new Date(b.sent || b.issued_at || b.issuedAt || 0) - new Date(a.sent || a.issued_at || a.issuedAt || 0);
  });
}
