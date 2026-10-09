// Pure helpers: picture for a condition or hazard, colour for a verdict,
// which alerts are still in force. Severity itself is decided by the backend
// (verdict.level); nothing here grades or re-grades a warning.

export function conditionIcon(condition = '', rainMm = 0) {
  const c = String(condition).toLowerCase();
  if (c.includes('thunder')) return 'storm';
  if (c.includes('heavy') && (c.includes('rain') || c.includes('shower'))) return 'rain-heavy';
  if (c.includes('rain') || c.includes('shower')) return 'rain';
  if (c.includes('drizzle')) return 'drizzle';
  if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'fog';
  if (c.includes('snow')) return 'cloud';
  if (c.includes('overcast') || c === 'cloudy') return 'cloud';
  if (c.includes('partly') || c.includes('mostly cloudy')) return 'partly';
  if (c.includes('clear') || c.includes('sun')) return Number(rainMm) > 1 ? 'partly' : 'sun';
  return Number(rainMm) > 2 ? 'rain' : 'partly';
}

export function hazardIcon(hazard = '') {
  const h = String(hazard).toLowerCase();
  if (/lightning|thunder/.test(h)) return 'bolt';
  if (/cyclone|depression|storm surge/.test(h)) return 'cyclone';
  if (/tsunami|high wave|swell|sea|ocean|surge/.test(h)) return 'waves';
  if (/flood|inundation/.test(h)) return 'flood';
  if (/heat|hot|temperature/.test(h)) return 'heat';
  if (/cold/.test(h)) return 'cold';
  if (/wind|gale|squall|dust/.test(h)) return 'wind';
  if (/landslide/.test(h)) return 'landslide';
  if (/fog/.test(h)) return 'fog';
  if (/rain|shower/.test(h)) return 'rain-heavy';
  return 'alert';
}

// verdict.level -> visual tone. Unknown is grey: never green, never "safe".
export const LEVEL_TONE = {
  CRITICAL: 'red', HIGH: 'orange', MODERATE: 'yellow', LOW: 'green', UNKNOWN: 'grey',
};
export function toneOf(verdict) {
  return LEVEL_TONE[(verdict && verdict.level) || 'UNKNOWN'] || 'grey';
}
export function levelIcon(verdict) {
  const tone = toneOf(verdict);
  if (tone === 'green') return 'shield-ok';
  if (tone === 'grey') return 'question';
  return 'warning';
}

// Official alert severity (SACHET colour words) -> tone, for alert rows.
export function severityTone(sev) {
  const s = String(sev || '').toUpperCase();
  return { RED: 'red', ORANGE: 'orange', YELLOW: 'yellow', GREEN: 'green' }[s] || 'grey';
}
const RANK = { red: 4, orange: 3, yellow: 2, green: 1, grey: 0 };

export function isActive(alert, now = Date.now()) {
  const raw = alert && (alert.expires || alert.valid_until);
  if (!raw) return true; // unknown expiry is still an alert
  const t = Date.parse(raw);
  return Number.isNaN(t) ? true : t > now;
}

// In-force alerts, worst first, de-duplicated by identifier.
export function activeAlerts(list, now = Date.now()) {
  const seen = new Set();
  return (list || [])
    .filter((a) => isActive(a, now))
    .filter((a) => {
      const id = a.identifier || a.headline;
      if (!id || seen.has(id)) return !id;
      seen.add(id);
      return true;
    })
    .sort((a, b) => RANK[severityTone(b.severity)] - RANK[severityTone(a.severity)]);
}

export function sourceLabel(s) {
  const x = String(s || '');
  if (/sachet|ndma|sdma|cap/i.test(x)) return 'NDMA SACHET';
  if (/imd/i.test(x)) return 'IMD';
  if (/gdacs/i.test(x)) return 'GDACS';
  if (/era5/i.test(x)) return 'ERA5 (20-year record)';
  if (/open-?meteo/i.test(x)) return 'Open-Meteo';
  if (/owm|openweather/i.test(x)) return 'OpenWeatherMap';
  return x;
}

// Readable sender: "Andhra-Pradesh-SDMA" -> "Andhra Pradesh SDMA".
export function senderLabel(alert) {
  return String((alert && (alert.sender || alert.source)) || '').replace(/-/g, ' ');
}

// Persona choices the backend understands.
export const ROLES = [
  { id: 'general', icon: 'family', key: 'roleGeneral' },
  { id: 'farmer', icon: 'farmer', key: 'roleFarmer' },
  { id: 'fisherman', icon: 'boat', key: 'roleFisherman' },
  { id: 'driver', icon: 'truck', key: 'roleDriver' },
  { id: 'outdoor-worker', icon: 'worker', key: 'roleWorker' },
];

export const CARD_ICON = {
  agriculture: 'farmer', commute: 'truck', health: 'heart', alert_safety: 'warning',
};

// Great-circle distance in km between {lat, lon} points.
export function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
