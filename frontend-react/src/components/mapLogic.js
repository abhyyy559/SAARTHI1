// Warning map: the pure part (no React), unit-tested directly.
//
// Projection: equirectangular, longitude squeezed by cos(22°) so India keeps
// its shape. 10 map units per degree of latitude (≈ 11.1 km per unit).

export const LON0 = 68;
export const LAT0 = 37.5;
const UNITS_PER_DEG = 10;
const SQUEEZE = Math.cos((22 * Math.PI) / 180);
export const KM_PER_UNIT = 111.2 / UNITS_PER_DEG;

/** The full-India view: [x, y, size] of a square viewBox. */
export const FULL_VIEW = [-23, -5, 320];

export const SEV_RANK = { GREEN: 0, UNKNOWN: 1, YELLOW: 2, ORANGE: 3, RED: 4 };

export function project(lon, lat) {
  return [(lon - LON0) * SQUEEZE * UNITS_PER_DEG, (LAT0 - lat) * UNITS_PER_DEG];
}

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

/** A square view around a point that also takes in nearby districts. */
export function viewAround(center, pts, radiusKm = 320) {
  if (!center) return FULL_VIEW;
  const [cx, cy] = center;
  const r = radiusKm / KM_PER_UNIT;
  let half = 18;
  for (const p of pts || []) {
    const d = Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy));
    if (d <= r) half = Math.max(half, d + 9);
  }
  half = Math.min(half, r + 9);
  return [cx - half, cy - half, half * 2];
}

/** Steps a scale bar may show, and the one that fits 40-110 px. */
const STEPS = [5, 10, 20, 50, 100, 200, 300, 500];
export function scaleBar(viewSize, pxWidth) {
  if (!finite(viewSize) || !finite(pxWidth) || pxWidth <= 0) return null;
  const kmPerPx = (viewSize * KM_PER_UNIT) / pxWidth;
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
