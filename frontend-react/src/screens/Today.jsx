import { useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { keys, useApp } from '../lib/appState';
import { useData } from '../lib/useData';
import { condText, dayName, t } from '../lib/i18n';
import { CARD_ICON, ROLES, conditionIcon, hazardIcon, levelIcon, sourceLabel, toneOf } from '../lib/weather';
import { warmSpeech } from '../lib/voice';
import { Icon } from '../components/Icons';
import { Empty, Fresh, Skeleton, SpeakButton } from '../components/ui';

const r0 = (n) => (n == null ? '–' : Math.round(Number(n)));
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
  return { warn, now, fc, adv, cards };
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

function NowCard({ now }) {
  const { lang } = useApp();
  const c = now.data?.current;
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
  const { lang } = useApp();
  const { warn, now, fc, adv, cards } = useTodayData();
  const days = fc.data?.forecast?.days;
  const verdict = warn.data?.verdict;
  const current = now.data?.current;
  const summary = useMemo(() => (verdict ? summaryText(lang, verdict, current, days) : ''), [lang, verdict, current, days]);
  // Fetch the spoken summary in the background so the speaker answers
  // instantly, and keeps working offline.
  useEffect(() => { if (summary && warn.source === 'live') warmSpeech(summary, lang); }, [summary, lang, warn.source]);
  return (
    <div className="screen">
      <SafetyCard warn={warn} current={current} days={days} />
      <NowCard now={now} />
      <DaysCard fc={fc} />
      <ForYou adv={adv} cards={cards} />
      <p className="note center"><Icon name="sparkle" size={14} /> {t(lang, 'aiNote')}</p>
    </div>
  );
}
