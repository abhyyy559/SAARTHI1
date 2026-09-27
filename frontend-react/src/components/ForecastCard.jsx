// ForecastCard — the 7-day forecast section on Home.
//
// GET /api/v1/weather/forecast?lat&lon → { location, forecast: { source,
// issued_at, days: [{ date, condition, min_temperature, max_temperature,
// rainfall, rain_chance }] }, provenance: "LIVE"|"CACHED"|"UNAVAILABLE",
// generated_at }. rain_chance is precipitation probability, 0-100.
//
// Harbour Signal: paper card, 2px ink borders, system font, sentence case.
// Condition is icon + word — never color alone. A failed or UNAVAILABLE
// payload renders the honest "couldn't check" panel, never fake numbers.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import { Prov } from './ui';
import { finiteNum, conditionIconName, dayLabel } from './forecastUtils';
import './ForecastCard.css';

function DayRow({ day, index, lang, na }) {
  const tt = (k) => t(lang, k);
  const { main, sub } = dayLabel(day.date, index, lang, tt);
  const cond = day.condition ? String(day.condition) : null;
  const max = finiteNum(day.max_temperature);
  const min = finiteNum(day.min_temperature);
  const chance = finiteNum(day.rain_chance);
  const rainMm = finiteNum(day.rainfall);
  return (
    <div className="fc-row" role="listitem">
      <span className="fc-day">
        <span className="fc-dayname">{main}</span>
        {sub ? <span className="fc-date">{sub}</span> : null}
      </span>
      <span className="fc-cond">
        <span className="fc-icon" aria-hidden="true"><Icon name={conditionIconName(cond)} size={20} /></span>
        <span className="fc-cond-word">{cond || na}</span>
      </span>
      <span className="fc-temps">
        <span className="fc-hi" title={tt('fcHigh')}>{max != null ? `${Math.round(max)}°` : na}</span>
        <span className="fc-lo" title={tt('fcLow')}>{min != null ? `${Math.round(min)}°` : na}</span>
      </span>
      <span className="fc-rain" title={tt('fcRainChance')}>
        <span className="fc-icon" aria-hidden="true"><Icon name="drop" size={16} /></span>
        <span className="fc-rain-v">{chance != null ? `${Math.round(chance)}%` : '–'}</span>
        {rainMm != null && <span className="fc-rain-mm">{rainMm} {tt('rainMm')}</span>}
      </span>
    </div>
  );
}

export default function ForecastCard() {
  const { lang, loc, locReady, syncTick } = useApp();
  const [days, setDays] = useState(null); // null = loading
  const [prov, setProv] = useState(null);
  const [source, setSource] = useState(null);
  const [tick, setTick] = useState(0);

  const locKey = locReady ? `${loc.lat}|${loc.lon}` : 'pending';

  useEffect(() => {
    if (!locReady) return undefined;
    let alive = true;
    setDays(null);
    setProv(null);
    setSource(null);
    api.forecast(loc.lat, loc.lon)
      .then((d) => {
        if (!alive) return;
        const list = d && d.forecast && Array.isArray(d.forecast.days) ? d.forecast.days : [];
        const provValue = d && d.provenance ? String(d.provenance).toUpperCase() : 'UNAVAILABLE';
        // Empty days with a non-UNAVAILABLE provenance is still not a
        // forecast we can show: say so honestly instead of an empty list.
        if (list.length === 0 || provValue === 'UNAVAILABLE') {
          setDays([]);
          setProv('UNAVAILABLE');
        } else {
          setDays(list.slice(0, 7));
          setProv(provValue);
          setSource(d.forecast.source ? String(d.forecast.source) : null);
        }
      })
      .catch(() => {
        if (!alive) return;
        setDays([]);
        setProv('UNAVAILABLE');
        setSource(null);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locReady, locKey, syncTick, tick]);

  const pending = !locReady || days === null;
  const failed = !pending && (days.length === 0 || prov === 'UNAVAILABLE');
  const na = t(lang, 'h3Unavailable');

  return (
    <section aria-label={t(lang, 'fcTitle')} className="fc-card" id="forecast-week">
      <div className="fc-head">
        <h2 className="fc-title">{t(lang, 'fcTitle')}</h2>
        {source && !pending && !failed ? <span className="fc-source mono">{source}</span> : null}
        {prov ? <Prov value={prov} /> : <Prov value="UNAVAILABLE" />}
      </div>
      {pending ? (
        <p className="fc-pending" role="status">{t(lang, 'fcChecking')}</p>
      ) : failed ? (
        <div className="fc-off" role="status">
          <p className="fc-off-title">{t(lang, 'fcUnavailableTitle')}</p>
          <p className="fc-off-body">{t(lang, 'fcUnavailableBody')}</p>
          <button type="button" className="btn btn-ghost sm" onClick={() => setTick((x) => x + 1)}>
            <Icon name="refresh" size={14} aria-hidden="true" /> {t(lang, 'fcRetry')}
          </button>
        </div>
      ) : (
        <>
          <div className="fc-list" role="list">
            {days.map((d, i) => (
              <DayRow key={String(d.date || i)} day={d} index={i} lang={lang} na={na} />
            ))}
          </div>
          {prov === 'CACHED' ? <p className="fc-stale sub">{t(lang, 'fcStale')}</p> : null}
        </>
      )}
    </section>
  );
}
