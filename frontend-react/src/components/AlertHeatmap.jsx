// AlertHeatmap — the real-geography heatmap behind the Map view.
//
// Three toggleable heat layers over OpenStreetMap tiles: alert severity,
// observed temperature, and the health risk derived from that temperature
// (the same thresholds the Advisory cards use). Each district also keeps a
// circle marker with the exact numbers in its popup, because a blurred heat
// blob is a shape, not a reading — the console never asks you to judge
// severity from a colour alone.
//
// Honesty notes: the heat layer is RELATIVE to the districts on screen (the
// hottest district in the set is intensity 1.0), the schema is centroid-based,
// and a district with no data for the active layer is simply absent from it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L, { heatLayerAvailable, loadHeatLayer } from '../leafletSetup';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { Prov } from './ui';
import Icon from './icons';
import {
  HEAT_GRADIENTS, LAYERS, buildHeatData, layerValue, temperatureRange,
} from '../heatmap';
import './AlertHeatmap.css';

const SEV_FILL = {
  RED: '#d32f2f', ORANGE: '#f57c00', YELLOW: '#fbc02d',
  GREEN: '#388e3c', UNKNOWN: '#9e9e9e', NONE: '#cfcfcf',
};
const HEALTH_FILL = { high: '#e53935', moderate: '#fdd835', low: '#66bb6a', unknown: '#9e9e9e' };

const LAYER_LABEL = { alerts: 'hmAlerts', weather: 'hmWeather', health: 'hmHealth' };

// Fit the map to the districts we actually have, so the view never opens on
// an empty ocean waiting for the user to find India.
function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return undefined;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 8 });
    return undefined;
  }, [map, points]);
  return null;
}

// The blur canvas. Recreated only when the underlying data actually changes
// (keyed on the serialised points), not on every parent render.
function HeatLayer({ points, gradient }) {
  const map = useMap();
  const ref = useRef(null);
  const key = JSON.stringify(points);
  useEffect(() => {
    if (!heatLayerAvailable()) return undefined;
    const layer = window.L.heatLayer(points, {
      radius: 34,
      blur: 26,
      max: 1,
      minOpacity: 0.35,
      gradient,
    }).addTo(map);
    ref.current = layer;
    return () => {
      if (ref.current) map.removeLayer(ref.current);
      ref.current = null;
    };
    // `points` is captured through `key`: same key means same content, so a
    // stale closure cannot draw different data than the one it was built for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, gradient]);
  return null;
}

// A tile fetch failure must not blank the view — the markers carry the data.
function TileFallback() {
  const map = useMap();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const onErr = () => setFailed(true);
    map.on('tileerror', onErr);
    return () => { map.off('tileerror', onErr); };
  }, [map]);
  if (!failed) return null;
  return (
    <p className="hm-tile-note" role="status">
      <Icon name="info" size={12} /> {t('en', 'hmTileError')}
    </p>
  );
}

export default function AlertHeatmap() {
  const { lang } = useApp();
  const [districts, setDistricts] = useState(null);
  const [prov, setProv] = useState(null);
  const [layer, setLayer] = useState('alerts');
  const [heatReady, setHeatReady] = useState(() => heatLayerAvailable());

  useEffect(() => {
    if (heatReady) return undefined;
    let alive = true;
    loadHeatLayer().then((ok) => { if (alive) setHeatReady(ok); });
    return () => { alive = false; };
  }, [heatReady]);

  useEffect(() => {
    let alive = true;
    api.mapLayers()
      .then((d) => {
        if (!alive) return;
        const list = (d && d.districts) || [];
        setDistricts(list.length ? list : []);
        setProv((d && d.provenance) || 'UNAVAILABLE');
      })
      .catch(() => {
        if (!alive) return;
        setDistricts([]);
        setProv('UNAVAILABLE');
      });
    return () => { alive = false; };
  }, []);

  const range = useMemo(() => temperatureRange(districts || []), [districts]);
  const heatData = useMemo(
    () => buildHeatData(districts || [], layer, range),
    [districts, layer, range],
  );
  const bounds = useMemo(
    () => (districts || [])
      .filter((d) => Number.isFinite(Number(d.latitude)) && Number.isFinite(Number(d.longitude)))
      .map((d) => [Number(d.latitude), Number(d.longitude)]),
    [districts],
  );

  const markerColor = (d) => {
    if (layer === 'alerts') return SEV_FILL[(d.alerts && d.alerts.severity_label) || 'UNKNOWN'] || SEV_FILL.UNKNOWN;
    if (layer === 'health') return HEALTH_FILL[(d.health && d.health.risk) || 'unknown'] || HEALTH_FILL.unknown;
    const temp = Number(d.weather && d.weather.temperature);
    return Number.isFinite(temp) ? '#f57c00' : SEV_FILL.UNKNOWN;
  };

  const loading = districts === null;
  const unavailable = !loading && Array.isArray(districts) && districts.length === 0;

  return (
    <section className="hm" aria-label={t(lang, 'viewMap')}>
      <div className="alert-sec-title">
        <span className="kicker">{t(lang, 'viewMap')}</span>
      </div>
      <p className="sub">{t(lang, 'hmSub')}</p>

      <div className="chip-row hm-layers" role="group" aria-label={t(lang, 'hmLayers')}>
        {LAYERS.map((id) => (
          <button
            key={id}
            type="button"
            className={`chip hm-chip${layer === id ? ' is-active' : ''}`}
            aria-pressed={layer === id}
            onClick={() => setLayer(id)}
          >
            {t(lang, LAYER_LABEL[id])}
          </button>
        ))}
        <span className="hm-prov">{prov ? <Prov value={prov} /> : null}</span>
      </div>

      {loading ? (
        <p className="sub" role="status">{t(lang, 'h3WxChecking')}</p>
      ) : unavailable ? (
        <p className="sub" role="status">
          <Icon name="info" size={14} /> {t(lang, 'hmUnavailable')}
        </p>
      ) : (
        <div className="hm-map-wrap">
          <MapContainer
            className="hm-map"
            scrollWheelZoom
            attributionControl
            preferCanvas
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={12}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <FitBounds points={bounds} />
            <TileFallback />
            {heatReady && heatData.length > 0 && (
              <HeatLayer points={heatData} gradient={HEAT_GRADIENTS[layer]} />
            )}
            {districts.map((d) => (
              <CircleMarker
                key={d.district}
                center={[Number(d.latitude), Number(d.longitude)]}
                radius={6}
                pathOptions={{
                  color: markerColor(d),
                  fillColor: markerColor(d),
                  fillOpacity: 0.85,
                  weight: 1.5,
                }}
              >
                <Popup>
                  <div className="hm-popup">
                    <strong>{d.district}</strong>
                    {d.state ? <span className="hm-popup-state">{d.state}</span> : null}
                    <dl>
                      <div>
                        <dt>{t(lang, 'hmAlerts')}</dt>
                        <dd>{layerValue(d, 'alerts') || t(lang, 'h3Unavailable')}</dd>
                      </div>
                      <div>
                        <dt>{t(lang, 'hmWeather')}</dt>
                        <dd>{layerValue(d, 'weather') || t(lang, 'h3Unavailable')}</dd>
                      </div>
                      <div>
                        <dt>{t(lang, 'hmHealth')}</dt>
                        <dd>{layerValue(d, 'health')}</dd>
                      </div>
                    </dl>
                    {layer === 'weather' && range ? (
                      <p className="hm-popup-note">
                        {t(lang, 'hmRelativeNote')
                          .replace('{lo}', String(Math.round(range.min)))
                          .replace('{hi}', String(Math.round(range.max)))}
                      </p>
                    ) : null}
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      )}

      {!loading && !unavailable && (
        <p className="sub hm-foot">
          <Icon name="info" size={12} /> {t(lang, 'hmSchemaNote')}
        </p>
      )}
      {!heatReady && !loading && !unavailable && (
        <p className="sub" role="status">
          <Icon name="info" size={12} /> {t(lang, 'hmHeatMissing')}
        </p>
      )}
    </section>
  );
}
