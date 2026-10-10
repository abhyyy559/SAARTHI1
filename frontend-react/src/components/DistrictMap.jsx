// DistrictMap — the warning map (inline SVG, zero tile servers).
//
// India's outline with one dot per district, coloured by its worst ACTIVE
// alert. "Near me" zooms to the user's region, "All India" shows the whole
// country; tap a district for a card with its alert. Fully offline-capable:
// the outline is bundled (indiaOutline.js), coordinates come from
// /api/location/districts (static geography, cached in localStorage) with the
// bundled DISTRICTS list as fallback — no map tiles are ever fetched, so this
// renders in airplane mode. Dots are district centroids: approximate by
// design, labelled schematic, never a surveyed boundary.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { DISTRICTS, t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import { isPastAlert } from './inboxLogic';
import { INDIA_RINGS } from './indiaOutline';
import {
  alertsByDistrict, dotBox, FULL_VIEW, normalizeCoords, placeLabels, project, ringsPath, scaleBar, SEV_RANK, viewAround,
} from './mapLogic';

const COORDS_KEY = 'wgpt-dist-coords-v1';
const SEV_WORD = { RED: 'sevRed', ORANGE: 'sevOrange', YELLOW: 'sevYellow', GREEN: 'sevGreen', UNKNOWN: 'sevUnknown' };
const LEGEND = ['RED', 'ORANGE', 'YELLOW', 'GREEN'];
const OUTLINE = ringsPath(INDIA_RINGS);
// Faint 5° grid: reads as a map, carries no data.
const GRID = (() => {
  let d = '';
  for (let lon = 70; lon <= 95; lon += 5) {
    const [x0, y0] = project(lon, 38); const [x1, y1] = project(lon, 5);
    d += `M${x0.toFixed(1)} ${y0}L${x1.toFixed(1)} ${y1}`;
  }
  for (let lat = 10; lat <= 35; lat += 5) {
    const [x0, y0] = project(66, lat); const [x1, y1] = project(99, lat);
    d += `M${x0.toFixed(1)} ${y0}L${x1.toFixed(1)} ${y1}`;
  }
  return d;
})();

// Ended, cancelled, or past its expiry: never colours the map.
function isEnded(a) {
  return isPastAlert(a);
}

function loadCachedCoords() {
  try {
    const v = JSON.parse(localStorage.getItem(COORDS_KEY) || '[]');
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null;
  }
}

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export default function DistrictMap({ alerts = [], onSelectDistrict = null }) {
  const { lang, loc } = useApp();
  const [coords, setCoords] = useState(() => loadCachedCoords() || DISTRICTS);
  const [scope, setScope] = useState('near');
  const [selected, setSelected] = useState(null);
  const [vb, setVb] = useState(FULL_VIEW);
  const [pxWidth, setPxWidth] = useState(340);
  const svgRef = useRef(null);
  const vbRef = useRef(FULL_VIEW);

  // Static geography: fetch once, cache forever. A failed fetch keeps the
  // bundled fallback — the map must never blank for want of coordinates.
  useEffect(() => {
    let alive = true;
    api.districtCoords()
      .then((list) => {
        if (!alive || !normalizeCoords(list).length) return;
        try { localStorage.setItem(COORDS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
        setCoords(list);
      })
      .catch(() => { /* offline — cached/bundled coordinates stand in */ });
    return () => { alive = false; };
  }, []);

  const pts = useMemo(() => normalizeCoords(coords).map((d) => {
    const [x, y] = project(d.lon, d.lat);
    return { ...d, x, y };
  }), [coords]);
  const names = useMemo(() => pts.map((p) => p.name), [pts]);

  // Worst active severity per district (ended alerts never colour the map).
  const byDistrict = useMemo(
    () => alertsByDistrict((alerts || []).filter((a) => a && !isEnded(a)), names),
    [alerts, names],
  );

  const userKey = String(loc.district || '').toLowerCase();
  const userPt = pts.find((p) => p.name.toLowerCase() === userKey)
    || (Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lon))
      ? { name: loc.district || '', x: project(Number(loc.lon), Number(loc.lat))[0], y: project(Number(loc.lon), Number(loc.lat))[1] }
      : null);

  const target = useMemo(() => {
    if (scope === 'all' || !userPt) return FULL_VIEW;
    return viewAround([userPt.x, userPt.y], pts);
  }, [scope, userPt && userPt.x, userPt && userPt.y, pts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Glide between views; jump when the user prefers less motion.
  useEffect(() => {
    const from = vbRef.current;
    if (reducedMotion()) { vbRef.current = target; setVb(target); return undefined; }
    let raf = 0;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / 420);
      const e = 1 - (1 - p) ** 3;
      const next = from.map((v, i) => v + (target[i] - v) * e);
      vbRef.current = next;
      setVb(next);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  // Keep dots and labels the same size on screen at every zoom.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setPxWidth(Math.max(1, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const k = vb[2] / pxWidth; // map units per screen pixel
  const inView = (p, m = 0) => p.x >= vb[0] - m && p.x <= vb[0] + vb[2] + m && p.y >= vb[1] - m && p.y <= vb[1] + vb[2] + m;
  const zoomed = vb[2] < FULL_VIEW[2] * 0.6;

  const alerted = pts
    .filter((p) => byDistrict.has(p.name))
    .sort((a, b) => SEV_RANK[byDistrict.get(b.name).sev] - SEV_RANK[byDistrict.get(a.name).sev]);
  const counts = LEGEND.reduce((o, s) => ({ ...o, [s]: alerted.filter((p) => byDistrict.get(p.name).sev === s).length }), {});

  // Labels: you and the selected district always; alerted districts next;
  // in a zoomed view the other districts too, wherever they fit.
  const labelItems = [];
  const seen = new Set();
  const addLabel = (p, size, force, gap) => {
    if (!p || seen.has(p.name) || !inView(p)) return;
    seen.add(p.name);
    labelItems.push({ key: p.name, x: p.x, y: p.y, text: p.name, size, force, gap, strong: force || byDistrict.has(p.name) });
  };
  if (userPt && userPt.name) addLabel(userPt, 11.5, true, 16);
  addLabel(pts.find((p) => p.name === selected), 11.5, true, 12);
  alerted.forEach((p) => addLabel(p, 11, false, 11));
  if (zoomed) pts.forEach((p) => addLabel(p, 9.5, false, 7));
  const dotR = (p) => (byDistrict.has(p.name) ? 8 : zoomed ? 3.4 : 2.6) * k;
  const scale = scaleBar(vb[2], pxWidth);
  // The compass (top right) and scale bar (bottom left) sit over the map.
  const [vx, vy, vs] = vb;
  const obstacles = [
    ...pts.filter((p) => inView(p)).map((p) => dotBox(p.x, p.y, dotR(p), !byDistrict.has(p.name))),
    { x0: vx + vs - 48 * k, x1: vx + vs, y0: vy, y1: vy + 54 * k },
    { x0: vx, x1: vx + ((scale ? scale.px : 60) + 80) * k, y0: vy + vs - 44 * k, y1: vy + vs },
  ];
  const labels = placeLabels(labelItems, k, obstacles, { x0: vx + 4 * k, x1: vx + vs - 4 * k, y0: vy + 4 * k, y1: vy + vs - 4 * k });

  const sel = selected ? pts.find((p) => p.name === selected) : null;
  const selInfo = sel ? byDistrict.get(sel.name) : null;
  const choose = (name) => setSelected((cur) => (cur === name ? null : name));
  // A district outside the region view: widen to All India so it shows.
  const focusOn = (p) => {
    setSelected(p.name);
    const [x, y, s] = target;
    const m = 8;
    if (p.x < x + m || p.x > x + s - m || p.y < y + m || p.y > y + s - m) setScope('all');
  };

  return (
    <section aria-label={t(lang, 'mapTitle')} className="wmap">
      <div className="wmap-head">
        <div className="alert-sec-title">
          <span className="kicker">{t(lang, 'mapTitle')}</span>
        </div>
        {userPt && (
          <div className="segmented wmap-scope" role="group" aria-label={t(lang, 'mapTitle')}>
            <button type="button" className={`seg-opt${scope === 'near' ? ' is-active' : ''}`} aria-pressed={scope === 'near'} onClick={() => setScope('near')}>
              <Icon name="pin" size={14} /> {t(lang, 'mapNearMe')}
            </button>
            <button type="button" className={`seg-opt${scope === 'all' ? ' is-active' : ''}`} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
              <Icon name="map" size={14} /> {t(lang, 'mapAllIndia')}
            </button>
          </div>
        )}
      </div>
      <p className="sub">{t(lang, 'mapSub')}</p>

      <div className="map-wrap wmap-frame">
        <svg
          ref={svgRef}
          viewBox={[vb[0], vb[1], vb[2], vb[2]].map((v) => v.toFixed(2)).join(' ')}
          role="img"
          aria-label={t(lang, 'mapTitle')}
          className="wmap-svg"
          onClick={(e) => { if (e.target === e.currentTarget || e.target.dataset.bg) setSelected(null); }}
        >
          <rect data-bg="1" x={FULL_VIEW[0]} y={FULL_VIEW[1]} width={FULL_VIEW[2]} height={FULL_VIEW[2]} className="wmap-sea" />
          <path d={GRID} className="wmap-grid" strokeWidth={k} />
          <path d={OUTLINE} className="wmap-shadow" transform={`translate(${1.6 * k} ${2.2 * k})`} />
          <path data-bg="1" d={OUTLINE} className="wmap-land" strokeWidth={1.4 * k} />

          {/* Quiet districts first, alerted ones on top. */}
          {pts.filter((p) => !byDistrict.has(p.name)).map((p) => (
            <circle
              key={p.name} cx={p.x} cy={p.y} r={(zoomed ? 3.4 : 2.6) * k}
              className={`wmap-dot${selected === p.name ? ' is-selected' : ''}`}
              strokeWidth={(selected === p.name ? 2 : 0) * k}
              onClick={() => choose(p.name)}
            >
              <title>{p.name}</title>
            </circle>
          ))}

          {userPt && (
            <g className="wmap-you" aria-hidden="true">
              <circle cx={userPt.x} cy={userPt.y} r={17 * k} className="wmap-you-halo" />
              <circle cx={userPt.x} cy={userPt.y} r={12 * k} fill="none" strokeWidth={2.5 * k} />
            </g>
          )}

          {alerted.map((p) => {
            const { sev, alerts: list } = byDistrict.get(p.name);
            const loud = sev === 'RED' || sev === 'ORANGE';
            return (
              <g
                key={p.name}
                data-sev={sev}
                className={`wmap-alert${selected === p.name ? ' is-selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${p.name}: ${t(lang, SEV_WORD[sev])}`}
                onClick={() => choose(p.name)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(p.name); } }}
              >
                {loud && <circle cx={p.x} cy={p.y} r={7 * k} className="wmap-pulse" />}
                <circle cx={p.x} cy={p.y} r={16 * k} fill="transparent" />
                <circle cx={p.x} cy={p.y} r={(list.length > 1 ? 8.5 : 7) * (selected === p.name ? 1.2 : 1) * k} className="wmap-alert-dot" strokeWidth={2 * k} />
                {list.length > 1 && (
                  <text x={p.x} y={p.y + 3.3 * k} textAnchor="middle" fontSize={9 * k} className="wmap-count">{list.length}</text>
                )}
                <title>{`${p.name} — ${t(lang, SEV_WORD[sev])}`}</title>
              </g>
            );
          })}

          {labels.map((l) => (
            <text
              key={l.key} x={l.lx} y={l.ly} textAnchor={l.anchor} fontSize={l.fs}
              className={`wmap-label${l.strong ? ' is-strong' : ''}`} strokeWidth={3 * k}
            >
              {l.text}
            </text>
          ))}
        </svg>

        <span className="wmap-north" aria-hidden="true">N<span>▲</span></span>
        {scale && (
          <span className="wmap-scale" aria-hidden="true">
            <span className="wmap-scale-bar" style={{ width: scale.px }} />
            {scale.km} km
          </span>
        )}
      </div>

      {sel && (
        <div className="wmap-card" data-sev={selInfo ? selInfo.sev : undefined} role="status">
          <div className="wmap-card-head">
            <span className="wmap-card-dot" aria-hidden="true" />
            <span className="wmap-card-title">
              <b>{sel.name}</b>
              <span className="sub">
                {[sel.state, userPt && userPt.name === sel.name ? t(lang, 'mapYou') : ''].filter(Boolean).join(' · ')}
              </span>
            </span>
            <button type="button" className="wmap-card-close" aria-label={t(lang, 'mapClose')} onClick={() => setSelected(null)}>
              <Icon name="close" size={16} />
            </button>
          </div>
          {selInfo ? (
            <>
              <p className="wmap-card-line">
                <b className="wmap-card-sev">{t(lang, SEV_WORD[selInfo.sev])}</b>
                {' · '}
                {selInfo.alerts.length === 1 ? t(lang, 'ovlActiveOne') : t(lang, 'ovlActiveMany').replace('{n}', String(selInfo.alerts.length))}
              </p>
              <p className="wmap-card-text">{String(selInfo.alerts[0].headline || selInfo.alerts[0].message || '').slice(0, 160)}</p>
              {onSelectDistrict && (
                <button type="button" className="btn sm wmap-card-btn" onClick={() => onSelectDistrict(sel.name)}>
                  {t(lang, 'mapOpenAlert')} <Icon name="chevron" size={14} />
                </button>
              )}
            </>
          ) : (
            <p className="wmap-card-text">{t(lang, 'mapNoAlertHere')}</p>
          )}
        </div>
      )}

      <div className="wmap-legend" aria-label={t(lang, 'mapTitle')}>
        {LEGEND.map((s) => (
          <span key={s} className="wmap-legend-item" data-sev={s}>
            <span className="wmap-legend-dot" aria-hidden="true" />
            {t(lang, SEV_WORD[s])}
            {counts[s] > 0 && <b className="wmap-legend-n">{counts[s]}</b>}
          </span>
        ))}
        {userPt && (
          <span className="wmap-legend-item">
            <span className="wmap-legend-you" aria-hidden="true" />
            {t(lang, 'mapYou')}
          </span>
        )}
      </div>

      {alerted.length > 0 ? (
        <div className="wmap-list">
          <span className="kicker">{t(lang, 'mapAlertedTitle')}</span>
          <div className="wmap-list-row">
            {alerted.map((p) => (
              <button
                key={p.name} type="button" data-sev={byDistrict.get(p.name).sev}
                className={`wmap-pill${selected === p.name ? ' is-active' : ''}`}
                aria-pressed={selected === p.name}
                onClick={() => focusOn(p)}
              >
                <span className="wmap-legend-dot" aria-hidden="true" />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="sub" role="status" style={{ textAlign: 'center' }}>{t(lang, 'mapNoAlerts')}</p>
      )}
      <p className="sub wmap-note">
        <Icon name="info" size={12} /> {t(lang, 'mapSchematic')}
      </p>
    </section>
  );
}
