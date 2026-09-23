// WeatherCard — the current-conditions readout on Home.
//
// Same data source HomeHero uses (api.current(lat, lon)): temperature, wind
// speed + direction, humidity and condition description. This card shows the
// raw values without the safety verdict. Honest labels only: any value the
// payload does not carry renders "Not available", never a guess — wind
// direction is not part of the observation model, so it will usually read
// UNAVAILABLE until the backend starts sending it. The provenance chip
// (LIVE / CACHED / DEMO / UNAVAILABLE) is read straight from the payload.
//
// Harbour Signal: paper card, 2px ink borders, system font, sentence case.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import { Prov } from './ui';
import './WeatherCard.css';

// 16-wind compass point for a degree heading. Null when the payload has no
// direction — the cell says so honestly instead of guessing.
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function compassPoint(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return null;
  return COMPASS[Math.round((((n % 360) + 360) % 360) / 22.5) % 16];
}

// Condition word → the one glyph a non-reader recognises. Coarse on purpose:
// the verdict dial carries severity, this carries the sky.
function conditionIcon(cond) {
  const c = String(cond || '').toLowerCase();
  if (/thunder|storm|lightning/.test(c)) return 'storm';
  if (/rain|drizzle|shower/.test(c)) return 'rain';
  if (/snow|hail|sleet/.test(c)) return 'snow';
  if (/fog|mist|haze|smoke/.test(c)) return 'fog';
  if (/wind|gust|squall/.test(c)) return 'wind';
  if (/clear|sun/.test(c)) return 'sun';
  if (/cloud|overcast/.test(c)) return 'cloud';
  if (/heat|hot/.test(c)) return 'heat';
  return 'cloud';
}

const finiteNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export default function WeatherCard() {
  const { lang, loc, locReady, syncTick } = useApp();
  const [current, setCurrent] = useState(null);
  const [prov, setProv] = useState(null);

  useEffect(() => {
    if (!locReady) return undefined;
    let alive = true;
    api.current(loc.lat, loc.lon)
      .then((d) => {
        if (!alive) return;
        setCurrent(d.current || null);
        setProv(d && d.provenance ? String(d.provenance).toUpperCase() : 'UNAVAILABLE');
      })
      .catch(() => {
        if (!alive) return;
        setCurrent(null);
        setProv('UNAVAILABLE');
      });
    return () => { alive = false; };
  }, [locReady, loc, syncTick]);

  const pending = !locReady || (current === null && prov === null);

  const temp = current ? finiteNum(current.temperature) : null;
  const wind = current ? finiteNum(current.wind_speed) : null;
  // The observation model carries no wind direction yet; check the usual
  // keys anyway so a future payload lights up without a code change.
  const dirDeg = current ? finiteNum(current.wind_direction_deg ?? current.wind_direction) : null;
  const dir = compassPoint(dirDeg);
  const hum = current ? finiteNum(current.humidity) : null;
  const cond = current && current.condition ? String(current.condition) : null;

  const na = t(lang, 'h3Unavailable');

  const cells = [
    {
      icon: 'thermometer', label: t(lang, 'h3WxTemp'),
      value: temp != null ? `${Math.round(temp)}°` : null, sub: null,
    },
    {
      icon: 'wind', label: t(lang, 'h3WxWind'),
      value: wind != null ? `${Math.round(wind)} ${t(lang, 'windKmh')}` : null,
      // Speed and direction are separate facts; a missing direction is a
      // missing fact, not a missing row.
      sub: wind != null ? (dir ? `${dir} · ${Math.round(dirDeg)}°` : `${t(lang, 'h3WxDir')}: ${na}`) : null,
    },
    {
      icon: 'drop', label: t(lang, 'h3WxHum'),
      value: hum != null ? `${Math.round(hum)}%` : null, sub: null,
    },
    {
      icon: conditionIcon(cond), label: t(lang, 'h3WxCond'),
      value: cond, sub: null,
    },
  ];

  return (
    <section aria-label={t(lang, 'h3WxTitle')} className="wx-card">
      <div className="wx-head">
        <h2 className="wx-title">{t(lang, 'h3WxTitle')}</h2>
        {prov ? <Prov value={prov} /> : <Prov value="UNAVAILABLE" />}
      </div>
      {pending ? (
        <p className="wx-pending" role="status">{t(lang, 'h3WxChecking')}</p>
      ) : (
        <div className="wx-grid" role="list">
          {cells.map((c) => (
            <div key={c.label} className="wx-cell" role="listitem">
              <span className="wx-icon" aria-hidden="true"><Icon name={c.icon} size={22} /></span>
              <span className="wx-text">
                <span className="wx-label">{c.label}</span>
                <span className="wx-value">{c.value != null ? c.value : na}</span>
                {c.sub ? <span className="wx-sub">{c.sub}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
