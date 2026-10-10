// Warning map: the pure part (no React), unit-tested directly.
//
// Projection: equirectangular, longitude squeezed by cos(22°) so India keeps
// its shape. 10 map units per degree of latitude (≈ 11.1 km per unit).

export const LON0 = 68;
export const LAT0 = 37.5;
const UNITS_PER_DEG = 10;
const SQUEEZE = Math.cos((22 * Math.PI) / 180);
export const KM_PER_UNIT = 111.2 / UNITS_PER_DEG;

// India's outline spans these map units (see indiaOutline.js).
export const INDIA_BOX = { x0: 1.6, x1: 272.4, y0: 4, y1: 307 };

export const SEV_RANK = { GREEN: 0, UNKNOWN: 1, YELLOW: 2, ORANGE: 3, RED: 4 };

export function project(lon, lat) {
  return [(lon - LON0) * SQUEEZE * UNITS_PER_DEG, (LAT0 - lat) * UNITS_PER_DEG];
}

export function unproject(x, y) {
  return [LON0 + x / (SQUEEZE * UNITS_PER_DEG), LAT0 - y / UNITS_PER_DEG];
}

// --- views: a centre (map units) and a scale (map units per screen pixel) ----

/** All of India, fitted into a w x h px frame. */
export function fitIndia(w, h) {
  const b = INDIA_BOX;
  const s = Math.max((b.x1 - b.x0) / w, (b.y1 - b.y0) / h) * 1.06;
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, s };
}

/** About 700 km across the shorter side, centred on a point. */
export function nearView(center, w, h, km = 700) {
  return { cx: center[0], cy: center[1], s: km / KM_PER_UNIT / Math.min(w, h) };
}

/** Zoom limits and the area the centre may be dragged to. */
export function clampView(v, w, h) {
  const fit = fitIndia(w, h);
  const s = Math.min(fit.s * 1.6, Math.max(nearView([0, 0], w, h, 120).s, v.s));
  return { s, cx: Math.min(300, Math.max(-25, v.cx)), cy: Math.min(335, Math.max(-25, v.cy)) };
}

/** Zoom by a factor while keeping the map point under (px, py) still. */
export function zoomAt(v, factor, px, py, w, h) {
  const ux = v.cx + (px - w / 2) * v.s;
  const uy = v.cy + (py - h / 2) * v.s;
  const s = v.s / factor;
  return clampView({ s, cx: ux - (px - w / 2) * s, cy: uy - (py - h / 2) * s }, w, h);
}

export const viewBoxOf = (v, w, h) => [v.cx - (w * v.s) / 2, v.cy - (h * v.s) / 2, w * v.s, h * v.s];

const finite = (x) => typeof x === 'number' && Number.isFinite(x);

/** Server rows use latitude/longitude, the bundled list lat/lon: accept both. */
export function normalizeCoords(list) {
  const out = [];
  for (const d of list || []) {
    if (!d || !d.district) continue;
    const lat = Number(d.latitude ?? d.lat);
    const lon = Number(d.longitude ?? d.lon);
    if (!finite(lat) || !finite(lon)) continue;
    out.push({ name: String(d.district), state: d.state ? String(d.state) : '', lat, lon });
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Which of the known districts an alert is about.
 * named_districts (from the server) wins, then a plain district field, then
 * the names found in areaDesc ("Hyderabad district, Telangana"). In the text
 * case, "Mumbai" is dropped when "Mumbai Suburban" also matched.
 */
export function districtsOfAlert(a, names) {
  if (!a) return [];
  const byLower = new Map((names || []).map((n) => [String(n).toLowerCase(), n]));
  const pick = (list) => [...new Set(list.map((n) => byLower.get(String(n).trim().toLowerCase())).filter(Boolean))];
  if (Array.isArray(a.named_districts) && a.named_districts.length) return pick(a.named_districts);
  if (a.district && byLower.has(String(a.district).trim().toLowerCase())) return pick([a.district]);
  const text = String(a.areaDesc || a.area || a.district || '').toLowerCase();
  if (!text) return [];
  const hits = [...byLower.keys()].filter((n) => new RegExp(`(^|[^\\p{L}])${esc(n)}($|[^\\p{L}])`, 'u').test(text));
  return hits.filter((n) => !hits.some((o) => o !== n && o.includes(n))).map((n) => byLower.get(n));
}

/** Per district: the worst severity and the alerts behind it (worst first). */
export function alertsByDistrict(alerts, names) {
  const out = new Map();
  for (const a of alerts || []) {
    const sev = String((a && a.severity) || 'UNKNOWN').toUpperCase();
    const level = SEV_RANK[sev] !== undefined ? sev : 'UNKNOWN';
    for (const n of districtsOfAlert(a, names)) {
      const cur = out.get(n) || { sev: level, alerts: [] };
      if (SEV_RANK[level] > SEV_RANK[cur.sev]) cur.sev = level;
      cur.alerts.push(a);
      out.set(n, cur);
    }
  }
  for (const v of out.values()) {
    v.alerts.sort((x, y) => (SEV_RANK[String(y.severity).toUpperCase()] ?? 1) - (SEV_RANK[String(x.severity).toUpperCase()] ?? 1));
  }
  return out;
}

/** Steps a scale bar may show, and the one that fits 40-110 px. */
const STEPS = [5, 10, 20, 50, 100, 200, 300, 500];
export function scaleBar(unitsPerPx) {
  if (!finite(unitsPerPx) || unitsPerPx <= 0) return null;
  const kmPerPx = unitsPerPx * KM_PER_UNIT;
  const km = STEPS.find((s) => s / kmPerPx >= 40) || STEPS[STEPS.length - 1];
  return { km, px: Math.round(km / kmPerPx) };
}

/**
 * Greedy label placement: highest priority first; each label tries above,
 * below, right, then left of its dot and is dropped if all four collide.
 * Items: { key, x, y, text, size, force }. k = map units per screen pixel.
 * obstacles: boxes labels must not cover (dots, the compass, the scale bar).
 * bounds: the visible box; a label that would be cut off is moved or dropped.
 * Obstacles marked soft (quiet dots) only keep out labels not marked strong.
 */
export function placeLabels(items, k, obstacles = [], bounds = null) {
  const placed = [];
  const boxes = [...obstacles];
  const out = (b) => !!bounds && (b.x0 < bounds.x0 || b.x1 > bounds.x1 || b.y0 < bounds.y0 || b.y1 > bounds.y1);
  const hit = (b, strong) => out(b)
    || boxes.some((o) => !(strong && o.soft) && b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  for (const it of items) {
    const fs = it.size * k;
    const w = it.text.length * fs * 0.58;
    const h = fs * 1.15;
    const gap = (it.gap || 9) * k;
    const tries = [
      { x: it.x, y: it.y - gap, anchor: 'middle', box: { x0: it.x - w / 2, x1: it.x + w / 2, y0: it.y - gap - h, y1: it.y - gap } },
      { x: it.x, y: it.y + gap + h * 0.8, anchor: 'middle', box: { x0: it.x - w / 2, x1: it.x + w / 2, y0: it.y + gap, y1: it.y + gap + h } },
      { x: it.x + gap, y: it.y + h * 0.35, anchor: 'start', box: { x0: it.x + gap, x1: it.x + gap + w, y0: it.y - h / 2, y1: it.y + h / 2 } },
      { x: it.x - gap, y: it.y + h * 0.35, anchor: 'end', box: { x0: it.x - gap - w, x1: it.x - gap, y0: it.y - h / 2, y1: it.y + h / 2 } },
    ];
    const spot = tries.find((t) => !hit(t.box, it.strong)) || (it.force ? tries[0] : null);
    if (!spot) continue;
    boxes.push(spot.box);
    placed.push({ ...it, lx: spot.x, ly: spot.y, anchor: spot.anchor, fs });
  }
  return placed;
}

/** SVG path for the outline rings. */
export function ringsPath(rings) {
  return (rings || []).map((r) => r.map(([lon, lat], i) => {
    const [x, y] = project(lon, lat);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join('') + 'Z').join('');
}

/** A square box around a dot, for placeLabels' obstacles. */
export const dotBox = (x, y, r, soft = false) => ({ x0: x - r, x1: x + r, y0: y - r, y1: y + r, soft });

// --- the colour field --------------------------------------------------------

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * Colour ramps: [value, colour]. Danger runs 0 (calm) → 1 Be careful →
 * 2 Be alert → 3 Danger, the same steps as the alert levels.
 */
export const RAMPS = {
  danger: [[0, '#2a9d5c'], [0.55, '#8fcb4f'], [1, '#f2d03b'], [1.5, '#f6a52a'], [2, '#ee6a22'], [2.5, '#de3a20'], [3, '#b5141f'], [3.6, '#6a0a1d']],
  temp: [[-20, '#5a3fd0'], [-10, '#6f8ce8'], [0, '#a8d6f2'], [10, '#3ea86a'], [20, '#a3d25b'], [25, '#f2c53d'], [30, '#f39a2b'], [35, '#e8562a'], [40, '#b8232f'], [45, '#741029']],
  rain: [[0, '#26324f'], [1, '#2a4a78'], [5, '#2f6db0'], [15.6, '#3d9de3'], [35.5, '#63d1e6'], [64.5, '#f0d548'], [115.6, '#f0862a'], [204.5, '#d42a6a']],
  wind: [[0, '#26335e'], [15, '#2c69a6'], [30, '#2fa58c'], [50, '#e3c83a'], [62, '#ef8a26'], [88, '#d42a2a'], [118, '#7a0f3a']],
};

export function rampColor(ramp, v) {
  if (!finite(v) || v <= ramp[0][0]) return hex(ramp[0][1]);
  for (let i = 1; i < ramp.length; i += 1) {
    if (v <= ramp[i][0]) {
      const [a, ca] = ramp[i - 1];
      const [b, cb] = ramp[i];
      const t = (v - a) / (b - a);
      const A = hex(ca); const B = hex(cb);
      return [0, 1, 2].map((j) => Math.round(A[j] + (B[j] - A[j]) * t));
    }
  }
  return hex(ramp[ramp.length - 1][1]);
}

/** 512-step lookup table for fast painting. */
export function rampLut(ramp) {
  const lo = ramp[0][0];
  const hi = ramp[ramp.length - 1][0];
  const lut = new Uint8ClampedArray(512 * 3);
  for (let i = 0; i < 512; i += 1) {
    const c = rampColor(ramp, lo + ((hi - lo) * i) / 511);
    lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
  }
  return { lut, lo, hi };
}

const piece = (v, pts) => {
  if (!finite(v)) return 0;
  if (v <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i += 1) {
    if (v <= pts[i][0]) {
      const [a, ya] = pts[i - 1]; const [b, yb] = pts[i];
      return ya + ((yb - ya) * (v - a)) / (b - a);
    }
  }
  return pts[pts.length - 1][1];
};

// IMD's limits: heavy / very heavy / extremely heavy rain in 24 h; heat wave
// at 40 °C on the plains, severe at 45; gale from 62 km/h.
const HEAT = [[34, 0], [37, 1], [40, 2], [45, 3], [48, 3.6]];
const RAIN = [[0, 0], [15.6, 0.4], [64.5, 1], [115.6, 2], [204.5, 3], [300, 3.6]];
const GUST = [[30, 0], [50, 1], [62, 2], [88, 3], [118, 3.6]];

/** Weather danger at one place: score 0-3.6 and what drives it. */
export function weatherDanger(temp, rain, gust) {
  const parts = [['heat', piece(temp, HEAT)], ['rain', piece(rain, RAIN)], ['wind', piece(gust, GUST)]];
  parts.sort((a, b) => b[1] - a[1]);
  return { score: parts[0][1], cause: parts[0][1] > 0 ? parts[0][0] : null };
}

export const SEV_LEVEL = { RED: 3, ORANGE: 2, YELLOW: 1 };
/** How far an official alert's colour reaches (map units, ~120 km). */
export const ALERT_REACH = 11;
export const alertDanger = (level, d2) => level * Math.exp(-d2 / (ALERT_REACH * ALERT_REACH));

/** Danger score → the alert level it reads as. */
export function dangerWord(score) {
  if (score >= 2.5) return 'RED';
  if (score >= 1.6) return 'ORANGE';
  if (score >= 0.8) return 'YELLOW';
  return 'GREEN';
}

/** Missing grid values filled from their neighbours (else 0). */
export function fillGaps(arr, rows, cols) {
  const out = Float32Array.from(arr || [], (v) => (finite(v) ? v : NaN));
  for (let pass = 0; pass < 4; pass += 1) {
    let left = 0;
    for (let i = 0; i < out.length; i += 1) {
      if (!Number.isNaN(out[i])) continue;
      const r = Math.floor(i / cols); const c = i % cols;
      let sum = 0; let n = 0;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr; const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const v = out[rr * cols + cc];
        if (!Number.isNaN(v)) { sum += v; n += 1; }
      }
      if (n) out[i] = sum / n; else left += 1;
    }
    if (!left) break;
  }
  for (let i = 0; i < out.length; i += 1) if (Number.isNaN(out[i])) out[i] = 0;
  return out;
}

const cubic = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

/** Smooth (Catmull-Rom) value of a filled grid at a longitude/latitude. */
export function sampleGrid(g, arr, lon, lat) {
  const r = Math.min(g.rows - 1, Math.max(0, (g.lat0 - lat) / g.step));
  const c = Math.min(g.cols - 1, Math.max(0, (lon - g.lon0) / g.step));
  const r1 = Math.floor(r); const c1 = Math.floor(c);
  const tr = r - r1; const tc = c - c1;
  const at = (rr, cc) => arr[Math.min(g.rows - 1, Math.max(0, rr)) * g.cols + Math.min(g.cols - 1, Math.max(0, cc))];
  const row = (rr) => cubic(at(rr, c1 - 1), at(rr, c1), at(rr, c1 + 1), at(rr, c1 + 2), tc);
  return cubic(row(r1 - 1), row(r1), row(r1 + 1), row(r1 + 2), tr);
}

/** Wind "from" direction + speed → the way the air moves (east, north). */
export function windVector(dirDeg, speed) {
  if (!finite(dirDeg) || !finite(speed)) return [0, 0];
  const a = (dirDeg * Math.PI) / 180;
  return [-speed * Math.sin(a), -speed * Math.cos(a)];
}

/** The nearest alerted district to a point: { p, km, dir } or null. */
export function nearestAlert(here, alerted) {
  let best = null;
  for (const p of alerted || []) {
    const d = Math.hypot(p.x - here[0], p.y - here[1]) * KM_PER_UNIT;
    if (!best || d < best.km) best = { p, km: d };
  }
  if (!best) return null;
  const ang = (Math.atan2(best.p.x - here[0], here[1] - best.p.y) * 180) / Math.PI;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return { ...best, dir: dirs[Math.round((((ang % 360) + 360) % 360) / 45) % 8] };
}
