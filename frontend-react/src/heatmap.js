// Heatmap layer maths — pure, so the numbers the map draws can be tested
// without a DOM or a network.

export const SEV_RANK = { GREEN: 0, UNKNOWN: 1, YELLOW: 2, ORANGE: 3, RED: 4 };

// Number(null) is 0 and Number('') is 0, so a plain Number() check would turn
// a missing reading into a real zero — a district with no weather data would
// render as "0C" and sit at the cold end of the scale. Anything that is not
// present becomes null instead, and every caller treats null as absent.
export function finiteOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const LAYERS = ['alerts', 'weather', 'health'];

export const HEAT_GRADIENTS = {
  alerts: { 0.25: '#fbc02d', 0.55: '#f57c00', 1: '#d32f2f' },
  weather: { 0.25: '#42a5f5', 0.55: '#ffee58', 0.8: '#fb8c00', 1: '#e53935' },
  health: { 0.35: '#66bb6a', 0.7: '#fdd835', 1: '#e53935' },
};

// Heat points that carry no information are not drawn at all: a district with
// no active alert must read as absent from the alerts layer, never as a faint
// green that still occupies space.
export function alertsIntensity(d) {
  const rank = finiteOrNull(d && d.alerts && d.alerts.severity);
  if (rank === null || rank < 2) return 0;
  return (rank - 1) / 3;
}

export function weatherIntensity(d, range) {
  const temp = finiteOrNull(d && d.weather && d.weather.temperature);
  if (temp === null || !range || range.max <= range.min) return 0;
  return (temp - range.min) / (range.max - range.min);
}

export function healthIntensity(d) {
  const score = finiteOrNull(d && d.health && d.health.risk_score);
  if (score === null || score < 1) return 0;
  return score / 2;
}

/** Min/max temperature across districts that actually carry a reading. */
export function temperatureRange(districts) {
  let min = null;
  let max = null;
  for (const d of districts || []) {
    const temp = finiteOrNull(d && d.weather && d.weather.temperature);
    if (temp === null) continue;
    if (min === null || temp < min) min = temp;
    if (max === null || temp > max) max = temp;
  }
  if (min === null || max === null) return null;
  return { min, max };
}

/**
 * leaflet.heat wants [lat, lng, intensity]. Districts whose intensity is 0 are
 * dropped so the layer shows only what is actually happening — an all-zero
 * canvas would be indistinguishable from a layer that failed to load.
 */
export function buildHeatData(districts, layer, range) {
  const out = [];
  for (const d of districts || []) {
    const lat = finiteOrNull(d && d.latitude);
    const lon = finiteOrNull(d && d.longitude);
    if (lat === null || lon === null) continue;
    let v = 0;
    if (layer === 'alerts') v = alertsIntensity(d);
    else if (layer === 'weather') v = weatherIntensity(d, range);
    else if (layer === 'health') v = healthIntensity(d);
    if (v <= 0) continue;
    out.push([lat, lon, Math.min(1, Math.max(0, v))]);
  }
  return out;
}

/** Human-readable value for one district under one layer, for the popup. */
export function layerValue(d, layer) {
  if (layer === 'alerts') {
    const label = (d.alerts && d.alerts.severity_label) || 'UNKNOWN';
    const count = Number(d.alerts && d.alerts.count) || 0;
    return count > 0 ? `${label} · ${count} active` : label;
  }
  if (layer === 'weather') {
    const temp = finiteOrNull(d && d.weather && d.weather.temperature);
    return temp === null ? null : `${Math.round(temp)}°C`;
  }
  const risk = (d.health && d.health.risk) || 'unknown';
  return risk;
}
