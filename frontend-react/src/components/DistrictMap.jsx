// DistrictMap — schematic warning map (inline SVG, zero tile servers).
//
// One dot per district, coloured by its worst ACTIVE alert; tap a district to
// open its first alert inline. Fully offline-capable: coordinates come from
// /api/location/districts (static geography, cached in localStorage) with the
// bundled DISTRICTS list as fallback — no map tiles are ever fetched, so this
// renders in airplane mode. Positions are equirectangular-projected centroids:
// approximate by design, labelled schematic, never a surveyed boundary.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { DISTRICTS, t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

const COORDS_KEY = 'wgpt-dist-coords-v1';

const SEV_RANK = { GREEN: 0, UNKNOWN: 1, YELLOW: 2, ORANGE: 3, RED: 4 };
const SEV_FILL = {
  RED: '#d32f2f',
  ORANGE: '#f57c00',
  YELLOW: '#fbc02d',
  GREEN: '#388e3c',
  UNKNOWN: '#9e9e9e',
  NONE: '#cfcfcf',
};
const SEV_WORD = { RED: 'sevRed', ORANGE: 'sevOrange', YELLOW: 'sevYellow', GREEN: 'sevGreen' };

function districtOf(a) {
  return String(a.district || a.areaDesc || a.area || '').trim();
}

function isEnded(a) {
  return String(a.lifecycle_state || a.state || '').toUpperCase() === 'ENDED';
}

// Map labels use a short form so long names (e.g. "Medchal Malkajgiri")
// don't collide with neighbouring dots. Full name stays in <title>.
function shortName(name) {
  const s = String(name || '').trim();
  if (s.toLowerCase() === 'medchal malkajgiri') return 'Medchal';
  const first = s.split(/\s+/)[0];
  return first.length >= 3 ? first : s;
}

function loadCachedCoords() {
  try {
    const v = JSON.parse(localStorage.getItem(COORDS_KEY) || '[]');
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null;
  }
}

export default function DistrictMap({ alerts = [], onSelectDistrict = null }) {
  const { lang, loc } = useApp();
  const [coords, setCoords] = useState(() => loadCachedCoords() || DISTRICTS);

  // Static geography: fetch once, cache forever. A failed fetch keeps the
  // bundled fallback — the map must never blank for want of coordinates.
  useEffect(() => {
    let alive = true;
    api.districtCoords()
      .then((list) => {
        if (!alive || !Array.isArray(list) || !list.length) return;
        const clean = list.filter((d) => d && d.district && Number.isFinite(Number(d.latitude)) && Number.isFinite(Number(d.longitude)));
        if (!clean.length) return;
        try { localStorage.setItem(COORDS_KEY, JSON.stringify(clean)); } catch { /* ignore */ }
        setCoords(clean);
      })
      .catch(() => { /* offline — cached/bundled coordinates stand in */ });
    return () => { alive = false; };
  }, []);

  // Worst active severity per district (ended alerts never colour the map).
  const sevByDistrict = useMemo(() => {
    const out = new Map();
    for (const a of alerts || []) {
      if (!a || isEnded(a)) continue;
      const name = districtOf(a).toLowerCase();
      if (!name) continue;
      const sev = String(a.severity || 'UNKNOWN').toUpperCase();
      const rank = SEV_RANK[sev] ?? SEV_RANK.UNKNOWN;
      const prev = out.get(name);
      if (!prev || rank > (SEV_RANK[prev] ?? 0)) out.set(name, SEV_RANK[sev] !== undefined ? sev : 'UNKNOWN');
    }
    return out;
  }, [alerts]);

  const pts = useMemo(() => {
    const clean = (coords || []).filter((d) => d && d.district && Number.isFinite(Number(d.latitude)) && Number.isFinite(Number(d.longitude)));
    if (!clean.length) return [];
    const lats = clean.map((d) => Number(d.latitude));
    const lons = clean.map((d) => Number(d.longitude));
    const W = 340, H = 300, PAD = 22;
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const spanLat = Math.max(maxLat - minLat, 0.5);
    const spanLon = Math.max(maxLon - minLon, 0.5);
    return clean.map((d) => ({
      name: d.district,
      x: PAD + ((Number(d.longitude) - minLon) / spanLon) * (W - PAD * 2),
      // SVG y grows downward: northern districts sit higher.
      y: PAD + ((maxLat - Number(d.latitude)) / spanLat) * (H - PAD * 2),
    }));
  }, [coords]);

  const userName = String(loc.district || '').toLowerCase();
  const alerted = pts.filter((p) => sevByDistrict.has(p.name.toLowerCase()));

  return (
    <section aria-label={t(lang, 'mapTitle')}>
      <div className="alert-sec-title">
        <span className="kicker">{t(lang, 'mapTitle')}</span>
      </div>
      <p className="sub">{t(lang, 'mapSub')}</p>
      <div className="map-wrap" style={{ textAlign: 'center' }}>
        <svg
          viewBox="0 0 340 300"
          role="img"
          aria-label={t(lang, 'mapTitle')}
          style={{ width: '100%', maxWidth: 420, height: 'auto', background: 'var(--paper)', border: '2px solid var(--ink)', borderRadius: 8 }}
        >
          {pts.map((p) => {
            const key = p.name.toLowerCase();
            const sev = sevByDistrict.get(key);
            const isUser = key === userName && userName !== '';
            return (
              <g key={p.name}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isUser ? 9 : 7}
                  fill={SEV_FILL[sev] || SEV_FILL.NONE}
                  stroke={isUser ? 'var(--ink)' : '#5c5c5c'}
                  strokeWidth={isUser ? 2.5 : 1}
                  style={{ cursor: sev ? 'pointer' : 'default' }}
                  onClick={sev && onSelectDistrict ? () => onSelectDistrict(p.name) : undefined}
                >
                  <title>{`${p.name}${sev ? ` — ${t(lang, SEV_WORD[sev] || 'sevUnknown')}` : ''}${isUser ? ' •' : ''}`}</title>
                </circle>
                {(sev || isUser) && (
                  <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--ink)"
                    style={{ paintOrder: 'stroke', stroke: 'var(--paper)', strokeWidth: 3 }}>
                    {shortName(p.name)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="chip-row" style={{ justifyContent: 'center', marginTop: 8 }}>
        {['RED', 'ORANGE', 'YELLOW', 'GREEN'].map((s) => (
          <span key={s} className="chip">
            <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: SEV_FILL[s] }} />{' '}
            {t(lang, SEV_WORD[s])}
          </span>
        ))}
      </div>
      {alerted.length === 0 && (
        <p className="sub" role="status" style={{ textAlign: 'center' }}>{t(lang, 'mapNoAlerts')}</p>
      )}
      <p className="sub" style={{ textAlign: 'center' }}>
        <Icon name="info" size={12} /> {t(lang, 'mapSchematic')}
      </p>
    </section>
  );
}
