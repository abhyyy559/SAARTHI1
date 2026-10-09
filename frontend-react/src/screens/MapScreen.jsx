// Map with heatmaps: where official alerts are in force across India (NDMA
// SACHET, every state's feed), and tomorrow's rain / heat (Open-Meteo model).
// Saved layers still draw offline; only the background map needs internet.
import { useEffect, useMemo, useRef, useState } from 'react';
import L from '../lib/leaflet';
import 'leaflet.heat/dist/leaflet-heat.js';
import { api } from '../lib/api';
import { useApp } from '../lib/appState';
import { useData, useOnline } from '../lib/useData';
import { fmtDateTime, hazardText, t } from '../lib/i18n';
import { distanceKm, severityTone } from '../lib/weather';
import { Icon } from '../components/Icons';
import { Fresh, SpeakButton } from '../components/ui';

const LAYERS = [
  { id: 'alerts', icon: 'warning', key: 'tabAlerts' },
  { id: 'rain', icon: 'rain', key: 'mapRain' },
  { id: 'heat', icon: 'heat', key: 'mapHeat' },
];
const TONE_HEX = { red: '#e5484d', orange: '#f76b15', yellow: '#ffc53d', green: '#30a46c', grey: '#8e8e8e' };
const GRADIENT = {
  alerts: { 0.25: '#ffc53d', 0.55: '#f76b15', 0.9: '#e5484d' },
  rain: { 0.15: '#9ec5ff', 0.45: '#4f8ff7', 0.8: '#1f4fbf', 1: '#5b2bd6' },
  heat: { 0.2: '#ffe08a', 0.5: '#ffa94d', 0.8: '#f76b15', 1: '#c62828' },
};

// Popup content as DOM text nodes: feed text never becomes HTML.
function popup(p, lang) {
  const div = document.createElement('div');
  div.className = 'map-pop';
  const b = document.createElement('b');
  b.textContent = `${hazardText(p.hazard, lang)} · ${p.severity || '?'}`;
  div.appendChild(b);
  const where = document.createElement('div');
  where.textContent = `${p.district || p.state}${p.approx ? ` (${t(lang, 'mapApprox')})` : ''}`;
  div.appendChild(where);
  if (p.expires) {
    const until = document.createElement('div');
    until.textContent = t(lang, 'until', { t: fmtDateTime(p.expires, lang) });
    div.appendChild(until);
  }
  if (p.headline) {
    const h = document.createElement('p');
    h.textContent = p.headline;
    div.appendChild(h);
  }
  return div;
}

export default function MapScreen() {
  const { lang, loc } = useApp();
  const online = useOnline();
  const [layer, setLayer] = useState('alerts');
  const alerts = useData('map:alerts', () => api.mapAlerts(), { refreshMs: 10 * 60 * 1000, maxAgeMs: 5 * 60 * 1000 });
  const grid = useData('map:grid', () => api.mapGrid(), { refreshMs: 0, maxAgeMs: 60 * 60 * 1000 });
  const box = useRef(null);
  const map = useRef(null);
  const overlay = useRef(null);

  useEffect(() => {
    // All of India first: the heatmaps are national. OpenStreetMap tiles need
    // no key (CARTO basemaps now do); dark mode darkens them with a filter.
    const m = L.map(box.current, { preferCanvas: true, zoomControl: true, minZoom: 4 });
    m.fitBounds([[7.5, 68.5], [35.5, 97.0]]);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 12, className: 'osm-tiles',
    }).addTo(m);
    L.circleMarker([loc.lat, loc.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#3e7cc9', fillOpacity: 1 })
      .bindTooltip(`${t(lang, 'mapYou')} · ${loc.district}`).addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, [loc.lat, loc.lon, loc.district, lang]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (overlay.current) { m.removeLayer(overlay.current); overlay.current = null; }
    const group = L.layerGroup();
    if (layer === 'alerts') {
      const pts = alerts.data?.points || [];
      L.heatLayer(pts.map((p) => [p.lat, p.lon, p.weight]), { radius: 34, blur: 24, max: 1, minOpacity: 0.35, gradient: GRADIENT.alerts }).addTo(group);
      pts.forEach((p) => L.circleMarker([p.lat, p.lon], {
        radius: p.approx ? 5 : 7, color: '#000', weight: 1, fillColor: TONE_HEX[severityTone(p.severity)], fillOpacity: 0.95,
        dashArray: p.approx ? '2 2' : null,
      }).bindPopup(() => popup(p, lang)).addTo(group));
    } else {
      const pts = grid.data?.points || [];
      const val = layer === 'rain'
        ? (p) => (p.rain_mm == null ? null : Math.min(1, p.rain_mm / 40))
        : (p) => (p.tmax_c == null ? null : Math.max(0, Math.min(1, (p.tmax_c - 24) / 18)));
      const heat = pts.map((p) => [p.lat, p.lon, val(p)]).filter((x) => x[2] != null && x[2] > 0.02);
      L.heatLayer(heat, { radius: 46, blur: 34, max: 1, minOpacity: 0.3, gradient: GRADIENT[layer] }).addTo(group);
    }
    group.addTo(m);
    overlay.current = group;
  }, [layer, alerts.data, grid.data, lang]);

  // Spoken / written summary: how many alerts, and the one nearest to you.
  const summary = useMemo(() => {
    if (layer === 'alerts') {
      const d = alerts.data;
      if (!d?.points) return '';
      const near = [...d.points].sort((a, b) => distanceKm(loc, a) - distanceKm(loc, b))[0];
      const base = t(lang, 'mapAlertsSum', { n: d.alerts });
      return near ? `${base} ${t(lang, 'mapNearest', { h: hazardText(near.hazard, lang), s: near.severity || '', km: Math.round(distanceKm(loc, near)), w: near.district || near.state })}` : base;
    }
    const d = grid.data;
    if (!d?.points) return '';
    const pick = layer === 'rain' ? (p) => p.rain_mm : (p) => p.tmax_c;
    const top = [...d.points].filter((p) => pick(p) != null).sort((a, b) => pick(b) - pick(a))[0];
    return top ? t(lang, layer === 'rain' ? 'mapRainSum' : 'mapHeatSum', { v: Math.round(pick(top)) }) : '';
  }, [layer, alerts.data, grid.data, lang, loc]);

  const src = layer === 'alerts' ? alerts : grid;
  return (
    <div className="screen map-screen">
      <div className="screen-head">
        <h1><Icon name="globe" size={26} /> {t(lang, 'tabMap')}</h1>
        <Fresh {...src} lang={lang} />
      </div>
      <div className="layer-chips" role="radiogroup" aria-label={t(lang, 'tabMap')}>
        {LAYERS.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={layer === l.id}
            className={`layer-chip ${layer === l.id ? 'is-on' : ''}`} onClick={() => setLayer(l.id)}>
            <Icon name={l.icon} size={28} /> {t(lang, l.key)}
          </button>
        ))}
      </div>
      <div className="map-box" ref={box} />
      <div className={`legend legend-${layer}`}>
        <span>{layer === 'alerts' ? t(lang, 'mapFew') : layer === 'rain' ? '0 mm' : '24°C'}</span>
        <i />
        <span>{layer === 'alerts' ? t(lang, 'mapMany') : layer === 'rain' ? '40+ mm' : '42°C+'}</span>
      </div>
      {summary ? (
        <div className="card map-sum">
          <p>{summary}</p>
          <SpeakButton text={summary} lang={lang} id="map" />
        </div>
      ) : null}
      <p className="note">
        <Icon name="info" size={14} />{' '}
        {layer === 'alerts'
          ? t(lang, 'mapAlertsNote', { f: alerts.data?.feeds_reached ?? '–', tt: alerts.data?.feeds_total ?? 36 })
          : t(lang, 'mapGridNote', { d: grid.data?.date || '' })}
      </p>
      {!online ? <p className="warn-note">{t(lang, 'mapOffline')}</p> : null}
    </div>
  );
}
