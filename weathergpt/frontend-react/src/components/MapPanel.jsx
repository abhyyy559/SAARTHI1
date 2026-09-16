import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { api, HYD } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';

const SEV_COLOR = { RED: '#f87171', ORANGE: '#fb923c', YELLOW: '#f59e0b', GREEN: '#34d399' };

export default function MapPanel() {
  const { lang } = useApp();
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current).setView([HYD.lat, HYD.lon], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    L.marker([HYD.lat, HYD.lon]).addTo(map).bindPopup('Hyderabad').openPopup();
    mapRef.current = map;

    let alive = true;
    api.warnings(HYD.district, HYD.lat, HYD.lon)
      .then((d) => {
        if (!alive) return;
        setInfo(d);
        const sev = d.warning?.severity || d.verified?.severity;
        if (sev && d.warning) {
          L.circle([HYD.lat, HYD.lon], {
            radius: 25000,
            color: SEV_COLOR[sev] || '#64748b',
            fillColor: SEV_COLOR[sev] || '#64748b',
            fillOpacity: 0.22,
          }).addTo(map).bindPopup(`${sev} - ${d.warning.hazard || ''}`);
        }
      })
      .catch(() => { if (alive) setInfo({ status: 'unavailable' }); });

    return () => { alive = false; };
  }, []);

  const sev = info?.warning?.severity;
  const alt = sev
    ? `Map of Hyderabad showing an official ${sev} warning zone for ${info.warning.hazard}.`
    : 'Map of Hyderabad with the user position marker. No active warning geometry.';

  return (
    <section className="card">
      <h2>{t(lang, 'map')}</h2>
      <p className="sub">
        {sev ? (
          <>Official warning zone: <span className={`sev ${sev}`}>{sev}</span> {info.warning.hazard}</>
        ) : (
          info?.status === 'unavailable'
            ? 'Warning geography temporarily unavailable.'
            : 'No active warning geometry.'
        )}
      </p>
      <div id="wmap" className="map" ref={divRef} role="img" aria-label={alt} />
      <div className="legend">
        <span>User GPS position</span>
        <span>Warning radius (district proxy - CAP polygons render here when the feed is live)</span>
      </div>
    </section>
  );
}