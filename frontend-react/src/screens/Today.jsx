import { useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { keys, readPref, useApp } from '../lib/appState';
import { useData } from '../lib/useData';
import { condText, dayName, t } from '../lib/i18n';
import { CARD_ICON, ROLES, conditionIcon, hazardIcon, levelIcon, sourceLabel, toneOf } from '../lib/weather';
import { speak, warmSpeech } from '../lib/voice';
import { Icon } from '../components/Icons';
import { Empty, Fresh, Skeleton, SpeakButton } from '../components/ui';

const r0 = (n) => (n == null ? '–' : Math.round(Number(n)));
const SPOKEN = new Set(); // auto-spoken this session: place|language|level
const r1 = (n) => (n == null ? '–' : Math.round(Number(n) * 10) / 10);

// What the big speaker on the safety card says.
export function summaryText(lang, verdict, current, days) {
  const parts = [t(lang, `lv${verdict?.level || 'UNKNOWN'}`)];
  if (verdict?.hazard && verdict.level !== 'LOW') parts.push(verdict.hazard);
  if (!verdict || verdict.level === 'UNKNOWN') parts.push(t(lang, 'lvUNKNOWNsub'));
  if (current) parts.push(`${t(lang, 'now')} ${r0(current.temperature)}°C, ${condText(current.condition, lang)}`);
  const tm = days && days[1];
  if (tm) parts.push(`${t(lang, 'tomorrow')} ${t(lang, 'rain')} ${r1(tm.rainfall)} mm`);
  return parts.join('. ');
}

export function useTodayData() {
  const { loc, persona, lang } = useApp();
  const warn = useData(keys.warnings(loc), () => api.warnings(loc));
  const now = useData(keys.current(loc), () => api.current(loc));
  const fc = useData(keys.forecast(loc), () => api.forecast(loc));
  const adv = useData(keys.advisory(loc, persona, lang), () => api.advisory(loc, persona, lang));
  const cards = useData(keys.cards(loc, persona, lang), () => api.cards(loc, persona, lang));
  const models = useData(keys.models(loc), () => api.models(loc), { refreshMs: 30 * 60 * 1000, maxAgeMs: 30 * 60 * 1000 });
  const climate = useData(keys.climate(loc), () => api.climate(loc), { refreshMs: 0, maxAgeMs: 24 * 3600 * 1000 });
  const nowcast = useData(keys.nowcast(loc), () => api.nowcast(loc));
  // Sea card: fishermen anywhere not known to be inland, and anyone on the coast.
  const wantSea = loc.coastal === true || (persona === 'fisherman' && loc.coastal !== false);
  const marine = useData(wantSea ? keys.marine(loc) : null, () => api.marine(loc), { maxAgeMs: 20 * 60 * 1000 });
  return { warn, now, fc, adv, cards, models, climate, nowcast, marine, wantSea };
}

function SafetyCard({ warn, current, days }) {
  const { lang } = useApp();
  const verdict = warn.data?.verdict;
  if (!verdict) {
    if (warn.loading) return <Skeleton h={190} />;
    return <Empty lang={lang} offline={!navigator.onLine} onRetry={warn.reload} />;
  }
  const tone = toneOf(verdict);
  const checked = verdict.checked_sources || [];
  const unchecked = verdict.unchecked_sources || [];
  const text = summaryText(lang, verdict, current, days);
  return (
    <section className={`safety tone-${tone}`} aria-live="polite">
      <div className="safety-top">
        <Icon name={levelIcon(verdict)} size={72} className="safety-icon" />
        <div className="safety-words">
          <h1>{t(lang, `lv${verdict.level}`)}</h1>
          {verdict.hazard && verdict.level !== 'LOW' ? (
            <p className="safety-hazard"><Icon name={hazardIcon(verdict.hazard)} size={26} /> {verdict.hazard}</p>
          ) : null}
          {verdict.level === 'UNKNOWN' ? <p className="safety-sub">{t(lang, 'lvUNKNOWNsub')}</p> : null}
        </div>
      </div>
      <SpeakButton text={text} lang={lang} id="safety" big />
      <div className="safety-foot">
        {checked.map((s) => (
          <span key={s} className="src-chip ok"><Icon name="check" size={14} />{t(lang, 'checked')}: {sourceLabel(s)}</span>
        ))}
        {unchecked.map((s) => (
          <span key={s} className="src-chip off"><Icon name="close" size={14} />{sourceLabel(s)} {t(lang, 'notConnected')}</span>
        ))}
        {verdict.source && !checked.length ? <span className="src-chip ok">{sourceLabel(verdict.source)}</span> : null}
        <Fresh {...warn} lang={lang} />
      </div>
    </section>
  );
}

function NowCard({ now, nowcast }) {
  const { lang } = useApp();
  const c = now.data?.current;
  const p3 = nowcast?.data?.nowcast?.next_3h_precip_probability_max;
  if (!c) return now.loading ? <Skeleton h={150} /> : <Empty lang={lang} offline={!navigator.onLine} onRetry={now.reload} />;
  const said = `${t(lang, 'now')}: ${r0(c.temperature)}°C, ${condText(c.condition, lang)}. ${t(lang, 'rain')} ${r1(c.rainfall)} mm. ${t(lang, 'wind')} ${r0(c.wind_speed)} km/h. ${t(lang, 'humidity')} ${r0(c.humidity)}%.`;
  return (
    <section className="card now">
      <div className="card-head">
        <h2>{t(lang, 'now')}</h2>
        <Fresh {...now} lang={lang} />
      </div>
      <div className="now-main">
        <Icon name={conditionIcon(c.condition, c.rainfall)} size={92} />
        <div>
          <div className="temp">{r0(c.temperature)}°</div>
          <div className="cond">{condText(c.condition, lang)}</div>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><Icon name="drop" size={30} /><b>{r1(c.rainfall)}</b><span>mm · {t(lang, 'rain')}</span></div>
        <div className="stat"><Icon name="wind" size={30} /><b>{r0(c.wind_speed)}</b><span>km/h · {t(lang, 'wind')}</span></div>
        <div className="stat"><Icon name="humidity" size={30} /><b>{r0(c.humidity)}%</b><span>{t(lang, 'humidity')}</span></div>
      </div>
      {p3 != null ? (
        <p className="next3h"><Icon name={p3 >= 50 ? 'rain' : 'drizzle'} size={26} /> {t(lang, 'next3h', { p: r0(p3) })}</p>
      ) : null}
      <div className="card-foot">
        <span className="src-note">{t(lang, 'source')}: {sourceLabel(c.source)}</span>
        <SpeakButton text={said} lang={lang} id="now" />
      </div>
    </section>
  );
}

function DaysCard({ fc }) {
  const { lang } = useApp();
  const days = (fc.data?.forecast?.days || []).slice(0, 3);
  if (!days.length) return fc.loading ? <Skeleton h={150} /> : null;
  const said = days.map((d, i) => `${dayName(d.date, lang, i)}: ${condText(d.condition, lang)}, ${t(lang, 'rain')} ${r1(d.rainfall)} mm, ${r0(d.max_temperature)}°C`).join('. ');
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t(lang, 'nextDays')}</h2>
        <Fresh {...fc} lang={lang} />
      </div>
      <div className="days">
        {days.map((d, i) => (
          <div className="day" key={d.date}>
            <span className="day-name">{dayName(d.date, lang, i)}</span>
            <Icon name={conditionIcon(d.condition, d.rainfall)} size={54} />
            <span className="day-rain"><Icon name="drop" size={16} />{r1(d.rainfall)} mm</span>
            <span className="day-temp"><b>{r0(d.max_temperature)}°</b> {r0(d.min_temperature)}°</span>
          </div>
        ))}
      </div>
      <div className="card-foot">
        <span className="src-note">{t(lang, 'forecastBy')}: {sourceLabel(fc.data?.forecast?.source)}</span>
        <SpeakButton text={said} lang={lang} id="days" />
      </div>
    </section>
  );
}

// "3 of 4 models": the NWP comparison (GFS, ECMWF, GEM, ICON) as pictures.
// A rainy day is >= 2.5 mm, IMD's definition.
function ModelsCard({ models }) {
  const { lang } = useApp();
  const m = models.data?.comparison?.models;
  if (!m) return models.loading ? <Skeleton h={150} /> : null;
  const list = Object.entries(m).filter(([, v]) => v && v.rain_day1 != null);
  if (!list.length) return null;
  const rainy = list.filter(([, v]) => v.rain_day1 >= 2.5).length;
  const wet = rainy * 2 > list.length;
  const summary = t(lang, wet ? 'modelsRain' : 'modelsDry', { n: wet ? rainy : list.length - rainy, m: list.length });
  const temps = list.map(([, v]) => v.tmax_day1).filter((x) => x != null);
  const tempLine = temps.length ? t(lang, 'modelsTemp', { a: r0(Math.min(...temps)), b: r0(Math.max(...temps)) }) : '';
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t(lang, 'modelsTitle')}</h2>
        <Fresh {...models} lang={lang} />
      </div>
      <p className="models-sum"><Icon name={wet ? 'rain' : 'sun'} size={36} /> <b>{summary}</b></p>
      <div className="models">
        {list.map(([name, v]) => (
          <div className={`model ${v.rain_day1 >= 2.5 ? 'is-wet' : ''}`} key={name}>
            <Icon name={v.rain_day1 >= 2.5 ? 'rain' : v.rain_day1 > 0.2 ? 'drizzle' : 'sun'} size={40} />
            <b>{r1(v.rain_day1)}</b>
            <span>{name.replace('-IFS', '')}</span>
          </div>
        ))}
      </div>
      <div className="card-foot">
        <span className="src-note">{tempLine}{tempLine ? ' · ' : ''}{t(lang, 'modelsNote')}</span>
        <SpeakButton text={`${summary}. ${tempLine}`} lang={lang} id="models" />
      </div>
    </section>
  );
}

// 20 years of ERA5: last complete year against the earlier-years normal.
function ClimateCard({ climate }) {
  const { lang } = useApp();
  const tr = climate.data?.trends;
  const years = tr?.yearly || [];
  if (!tr || years.length < 6 || tr.latest_rain_mm == null || !tr.baseline_rain_mm) {
    return climate.loading ? <Skeleton h={140} /> : null;
  }
  const last = years[years.length - 1].year;
  const rainPct = Math.round(((tr.latest_rain_mm - tr.baseline_rain_mm) / tr.baseline_rain_mm) * 100);
  const dT = tr.temp_anomaly_c;
  const sign = (x) => (x > 0 ? '+' : '');
  const rainLine = t(lang, 'climateRain', { y: last, v: r0(tr.latest_rain_mm), n: r0(tr.baseline_rain_mm) });
  const tempLine = dT == null ? '' : t(lang, 'climateTemp', { y: last, d: `${sign(dT)}${r1(dT)}` });
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t(lang, 'climateTitle')}</h2>
        <Fresh {...climate} lang={lang} />
      </div>
      <div className="clim-row">
        <Icon name="drop" size={38} />
        <div><b className={`delta ${rainPct >= 0 ? 'wet' : 'dry'}`}>{sign(rainPct)}{rainPct}%</b><span>{rainLine}</span></div>
      </div>
      {dT != null ? (
        <div className="clim-row">
          <Icon name="thermo" size={38} />
          <div><b className={`delta ${dT > 0 ? 'hot' : 'cool'}`}>{sign(dT)}{r1(dT)}°C</b><span>{tempLine}</span></div>
        </div>
      ) : null}
      <div className="card-foot">
        <span className="src-note">{t(lang, 'climateNote', { a: years[0].year, b: years[Math.max(0, years.length - 6)].year })}</span>
        <SpeakButton text={`${rainLine}. ${tempLine}`} lang={lang} id="climate" />
      </div>
    </section>
  );
}

// Sea state for fishermen: model wave height + gusts, labelled as context,
// never as a warning. Unavailable is said, never shown as a calm sea.
function SeaCard({ marine }) {
  const { lang } = useApp();
  const d = marine.data?.marine;
  if (!d) {
    if (marine.loading) return <Skeleton h={160} />;
    return marine.data?.status === 'unavailable'
      ? <section className="card"><div className="card-head"><h2><Icon name="waves" size={24} /> {t(lang, 'seaTitle')}</h2></div><Empty lang={lang} offline={!navigator.onLine} /></section>
      : null;
  }
  const said = d.days.map((x, i) => t(lang, 'seaSpeak', { day: dayName(x.date, lang, i), h: x.wave_height_max_m ?? '–', g: x.gust_max_kmh ?? '–' })).join(' ');
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t(lang, 'seaTitle')}</h2>
        <Fresh {...marine} lang={lang} />
      </div>
      <div className="now-main">
        <Icon name="waves" size={84} />
        <div>
          <div className="temp">{d.current_wave_height_m ?? '–'}<small className="unit"> m</small></div>
          <div className="cond">{t(lang, 'seaWaves')}</div>
        </div>
      </div>
      <div className="days">
        {d.days.map((x, i) => (
          <div className="day" key={x.date}>
            <span className="day-name">{dayName(x.date, lang, i)}</span>
            <Icon name="waves" size={40} />
            <span className="day-temp"><b>{x.wave_height_max_m ?? '–'}</b> m</span>
            <span className="day-rain"><Icon name="wind" size={16} />{x.gust_max_kmh ?? '–'} km/h</span>
          </div>
        ))}
      </div>
      <div className="card-foot">
        <span className="src-note">{t(lang, 'seaNote')}</span>
        <SpeakButton text={said} lang={lang} id="sea" />
      </div>
    </section>
  );
}

function RolePicker() {
  const { lang, persona, setPersona } = useApp();
  return (
    <div className="roles" role="radiogroup" aria-label={t(lang, 'role')}>
      {ROLES.map((r) => (
        <button key={r.id} type="button" role="radio" aria-checked={persona === r.id}
          className={`role ${persona === r.id ? 'is-on' : ''}`} onClick={() => setPersona(r.id)}>
          <Icon name={r.icon} size={44} />
          <span>{t(lang, r.key)}</span>
        </button>
      ))}
    </div>
  );
}

function ForYou({ adv, cards }) {
  const { lang, persona } = useApp();
  const role = ROLES.find((r) => r.id === persona) || ROLES[0];
  const text = adv.data?.advisory;
  const list = cards.data?.cards || [];
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t(lang, 'forYou')}</h2>
        <Fresh {...adv} lang={lang} />
      </div>
      <RolePicker />
      {text ? (
        <div className="advice main-advice">
          <Icon name={role.icon} size={48} />
          <div>
            <p>{text}</p>
            <SpeakButton text={text} lang={lang} id="advice" />
          </div>
        </div>
      ) : adv.loading ? <Skeleton h={90} /> : null}
      {list.map((c) => (
        <div className="advice" key={c.id}>
          <Icon name={CARD_ICON[c.kind] || 'info'} size={40} />
          <div>
            <h3>{c.title}</h3>
            <p className="muted">{c.body}</p>
            <SpeakButton text={`${c.title}. ${c.body}`} lang={lang} id={`card-${c.id}`} />
          </div>
        </div>
      ))}
      <p className="note"><Icon name="info" size={14} /> {t(lang, 'adviceNote')}</p>
    </section>
  );
}

export default function Today() {
  const { lang, loc, persona } = useApp();
  const { warn, now, fc, adv, cards, models, climate, nowcast, marine, wantSea } = useTodayData();
  const fisher = persona === 'fisherman';
  const days = fc.data?.forecast?.days;
  const verdict = warn.data?.verdict;
  const current = now.data?.current;
  const summary = useMemo(() => (verdict ? summaryText(lang, verdict, current, days) : ''), [lang, verdict, current, days]);
  // Fetch the spoken summary in the background so the speaker answers
  // instantly, and keeps working offline.
  useEffect(() => { if (summary && warn.source === 'live') warmSpeech(summary, lang); }, [summary, lang, warn.source]);
  // Speak on open: read the safety card once per place/language/level, so a
  // person who cannot read hears it without finding the button. Browsers may
  // block sound before the first tap; the Listen button stays as the fallback.
  const level = verdict?.level;
  useEffect(() => {
    if (!summary || warn.loading || !readPref('autoSpeak', true)) return;
    const key = `${loc.district}|${lang}|${level}`;
    if (SPOKEN.has(key)) return;
    SPOKEN.add(key);
    speak(summary, lang, 'safety');
  }, [summary, warn.loading, lang, loc.district, level]);
  return (
    <div className="screen">
      <SafetyCard warn={warn} current={current} days={days} />
      {wantSea && fisher ? <SeaCard marine={marine} /> : null}
      <NowCard now={now} nowcast={nowcast} />
      <DaysCard fc={fc} />
      {wantSea && !fisher ? <SeaCard marine={marine} /> : null}
      <ModelsCard models={models} />
      <ForYou adv={adv} cards={cards} />
      <ClimateCard climate={climate} />
      <p className="note center"><Icon name="sparkle" size={14} /> {t(lang, 'aiNote')}</p>
    </div>
  );
}
