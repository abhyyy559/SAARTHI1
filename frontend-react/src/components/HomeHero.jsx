// HomeHero — the wow moment. Designed for zero reading ability:
// WHAT is happening in the sky  → one giant condition icon (110px)
// HOW BAD is it                 → a signal-mast severity dial + stamp (icon+word+color)
// WHAT do I do next             → one short impact line + two 44px buttons
//
// Honesty contract (same as the old HeroCard): the backend verdict is the ONE
// severity, never re-derived; missing data renders as "can't check", never an
// all-clear; UNKNOWN stays grey.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { t, DISTRICTS, PERSONA_LABELS } from '../i18n';
import { useApp } from '../store';
import { formatCountdown, minutesSince, isExpired } from '../format';
import { saveWarningSnapshot, readWarningSnapshot, saveObservationSnapshot } from '../offline';
import Icon from './icons';
import LocationPrompt from './LocationPrompt';

// Condition word → the one glyph a non-reader recognises. Deliberately coarse:
// the dial carries severity, this carries the sky.
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

// Severity → dial needle angle (degrees, 180 = calm left, 0 = severe right).
const DIAL_ANGLE = { LOW: 180, MODERATE: 135, HIGH: 90, CRITICAL: 45 };

// Profile-first metrics: the dashboard re-prioritizes WHAT it surfaces per
// role, from the same current-weather object. A farmer sees rain first; a
// fisherman sees wind + rain; aviation gets the full briefing on Home
// (Home.jsx) and surface wind here. The severity verdict above stays
// universal — safety is never personalized away.
const PROFILE_FOCUS = {
  farmer: ['rain', 'humidity'],
  fisherman: ['wind', 'rain'],
  aviation: ['wind', 'rain'],
  driver: ['rain', 'wind'],
};
const DEFAULT_FOCUS = ['humidity', 'wind'];

const FOCUS_DEF = {
  rain: { icon: 'rain', unitKey: 'rainMm', get: (c) => c.rainfall },
  wind: { icon: 'wind', unitKey: 'windKmh', get: (c) => c.wind_speed },
  humidity: { icon: 'drop', unitKey: 'humidity', get: (c) => c.humidity },
};

const fmt1 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : null;
};

function SeverityDial({ level, word }) {
  const known = DIAL_ANGLE[level] !== undefined;
  const angle = known ? DIAL_ANGLE[level] : 90;
  const rad = (angle * Math.PI) / 180;
  const cx = 90; const cy = 84; const r = 64;
  const nx = cx + r * Math.cos(rad);
  const ny = cy - r * Math.sin(rad);
  // Four fixed arcs: green → yellow → orange → red, left to right.
  const arc = (a0, a1, color) => {
    const p0 = [cx + r * Math.cos((a0 * Math.PI) / 180), cy - r * Math.sin((a0 * Math.PI) / 180)];
    const p1 = [cx + r * Math.cos((a1 * Math.PI) / 180), cy - r * Math.sin((a1 * Math.PI) / 180)];
    return <path d={`M ${p0[0]} ${p0[1]} A ${r} ${r} 0 0 1 ${p1[0]} ${p1[1]}`} fill="none" stroke={color} strokeWidth={13} strokeLinecap="round" />;
  };
  return (
    <svg className="hh-dial" data-tour="verdict" width="180" height="96" viewBox="0 0 180 96" role="img" aria-label={word}>
      {arc(180, 135, 'var(--sev-green)')}
      {arc(135, 90, 'var(--sev-amber)')}
      {arc(90, 45, 'var(--sev-orange)')}
      {arc(45, 0, 'var(--sev-red)')}
      {known ? (
        <g>
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--ink)" strokeWidth={5} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={9} fill="var(--ink)" />
        </g>
      ) : (
        <g>
          <circle cx={cx} cy={cy - 30} r={10} fill="var(--sev-unknown)" />
          <text x={cx} y={cy + 2} textAnchor="middle" fontSize={11} fontWeight={800} fill="var(--ink-soft)">?</text>
        </g>
      )}
    </svg>
  );
}

export default function HomeHero() {
  const { lang, loc, locReady, speak, setDistrict, setPendingAsk, syncTick, publishVerdict, offline, persona } = useApp();
  const [warn, setWarn] = useState(null);
  const [current, setCurrent] = useState(null);
  const [stale, setStale] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const prevKey = useRef(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!locReady) return undefined;
    let alive = true;
    api.warnings(loc.district, loc.lat, loc.lon)
      .then((d) => {
        if (!alive) return;
        setWarn(d);
        setStale(false);
        if (d && d.status !== 'unavailable' && d.warning) saveWarningSnapshot(d.warning, d.verified, loc.district);
      })
      .catch(() => {
        if (!alive) return;
        const snap = readWarningSnapshot();
        if (snap && snap.warning && snap.district === loc.district) {
          setWarn({ status: 'ok', warning: snap.warning, verified: snap.verified, snapshotAt: snap.at });
          setStale(true);
        } else setWarn({ status: 'unavailable' });
      });
    api.current(loc.lat, loc.lon)
      .then((d) => {
        if (!alive) return;
        setCurrent(d.current || null);
        if (d.current) saveObservationSnapshot(d.current);
      })
      .catch(() => { if (alive) setCurrent(null); });
    return () => { alive = false; };
  }, [locReady, loc, syncTick]);

  // The backend's ONE verdict — read, never derived.
  const verdict = (warn && warn.verdict) || null;
  const w = warn && warn.status !== 'unavailable' ? warn.warning : null;
  useEffect(() => {
    if (verdict) publishVerdict(verdict, loc.district);
  }, [verdict, loc.district, publishVerdict]);

  const level = (verdict && verdict.level) || 'UNKNOWN';
  const basis = (verdict && verdict.basis) || 'unavailable';
  const confirmed = !!(verdict && verdict.confirmed);
  const expired = w ? isExpired(w.valid_until, nowMs) : false;
  const displayState = expired ? 'UNKNOWN' : level;
  const pending = !locReady;
  const aged = stale || offline;

  // Attention pulse when the verdict changes into something severe.
  const warnKey = `${displayState}:${(w && w.hazard) || ''}`;
  useEffect(() => {
    if (prevKey.current === null) { prevKey.current = warnKey; return undefined; }
    if (prevKey.current !== warnKey) {
      prevKey.current = warnKey;
      setPulse(true);
      const tId = setTimeout(() => setPulse(false), 1200);
      return () => clearTimeout(tId);
    }
    return undefined;
  }, [warnKey]);

  const hazard = ((confirmed && (verdict.hazard || (w && w.hazard))) || (w && w.hazard) || '').trim();
  // Accuracy fix: a countdown ("38m"), never a bare time-of-day after "expires in".
  const countdown = formatCountdown(w && w.valid_until, nowMs);
  // The one-line impact: hazard + what to do. Short enough to read at a glance.
  let impactKey = 'heroImpactCantCheck';
  let impactArg = '';
  if (!pending && !expired && basis !== 'unavailable') {
    if (displayState === 'CRITICAL' || displayState === 'HIGH') { impactKey = 'heroImpactStayIn'; impactArg = hazard; }
    else if (displayState === 'MODERATE') { impactKey = 'heroImpactStayAlert'; impactArg = hazard; }
    else if (displayState === 'LOW') { impactKey = 'heroImpactGoodToGo'; }
  }
  const impactLine = impactArg ? `${impactArg} — ${t(lang, impactKey)}` : t(lang, impactKey);

  const temp = current && current.temperature != null ? Math.round(current.temperature) : null;
  const condIcon = conditionIcon(current && current.condition);
  const generatedAt = (warn && (warn.generated_at || warn.snapshotAt)) || null;
  const ageMin = minutesSince(generatedAt, nowMs);
  const ageText = ageMin == null ? '' : ageMin < 1 ? t(lang, 'justNow') : t(lang, 'agoPattern').replace('{m}', ageMin);
  const evProv = pending ? '—' : aged ? 'CACHED' : basis === 'unavailable' ? 'UNAVAILABLE' : ((warn && (warn.provenance || warn.warning_provenance || warn.cap_provenance)) || 'LIVE');

  // Profile-first metrics, computed from the same current-weather object the
  // hero already fetched — no second request. Missing values drop the chip
  // instead of rendering a dash.
  const focusKeys = PROFILE_FOCUS[persona] || DEFAULT_FOCUS;
  const focusItems = !current ? [] : focusKeys.map((k) => {
    const def = FOCUS_DEF[k];
    const val = fmt1(def.get(current));
    if (val == null) return null;
    return { key: k, icon: def.icon, value: val, unit: k === 'humidity' ? '%' : t(lang, def.unitKey) };
  }).filter(Boolean);
  const focusLabel = `${t(lang, 'heroFocus')}: ${PERSONA_LABELS[lang]?.[persona] || PERSONA_LABELS.en[persona] || PERSONA_LABELS.en.general}`;

  const askAbout = () => {
    setPendingAsk(w ? `${t(lang, 'homeAskAbout')}: ${hazard} in ${loc.district}` : `${loc.district}`);
    const el = document.querySelector('[data-tour="home-chat"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section className={`home-hero${pulse ? ' is-pulse' : ''}`} data-sev={displayState} data-tour="sky" aria-label={t(lang, 'heroSkyNow')}>
      <div className="hh-top">
        <div className="hh-sky">
          <span className="hh-icon" data-cond={condIcon} aria-hidden="true">
            <Icon name={condIcon} size={104} />
          </span>
          <span className="hh-temp" aria-label={`${t(lang, 'heroTempNow')} ${temp != null ? `${temp}°C` : '—'}`}>
            {temp != null ? `${temp}°` : '–'}
          </span>
        </div>
        <SeverityDial level={displayState} word={t(lang, `sev${displayState === 'CRITICAL' ? 'Red' : displayState === 'HIGH' ? 'Orange' : displayState === 'MODERATE' ? 'Yellow' : displayState === 'LOW' ? 'Green' : 'Unknown'}`)} />
      </div>

      <p className="hh-impact">
        <span className="sev-stamp" data-sev={displayState}>
          <Icon name={displayState === 'CRITICAL' || displayState === 'HIGH' ? 'alert' : displayState === 'UNKNOWN' ? 'help' : displayState === 'MODERATE' ? 'clock' : 'check'} size={15} aria-hidden="true" />
          {t(lang, `sev${displayState === 'CRITICAL' ? 'Red' : displayState === 'HIGH' ? 'Orange' : displayState === 'MODERATE' ? 'Yellow' : displayState === 'LOW' ? 'Green' : 'Unknown'}`)}
        </span>
        <span className="hh-impact-text">{impactLine}</span>
      </p>

      <div className="hh-place">
        <span className="hh-pin"><Icon name="pin" size={18} aria-hidden="true" /></span>
        <b>{locReady && loc.district ? loc.district : t(lang, 'noDistrict')}</b>
        <button type="button" className="btn btn-ghost sm" aria-expanded={placeOpen} onClick={() => setPlaceOpen((o) => !o)}>
          <Icon name="search" size={15} aria-hidden="true" />
          {t(lang, 'heroChangePlace')}
        </button>
      </div>
      {placeOpen && (
        <div className="hh-districts" role="group" aria-label={t(lang, 'heroChangePlace')}>
          {DISTRICTS.map((d) => (
            <button
              key={d.district}
              type="button"
              className={`chip${loc.district === d.district ? ' is-active' : ''}`}
              aria-pressed={loc.district === d.district}
              onClick={() => { setDistrict(d); setPlaceOpen(false); }}
            >
              {d.district}
            </button>
          ))}
        </div>
      )}
      {!locReady && <LocationPrompt />}

      <div className="hh-actions">
        <button type="button" className="btn btn-signal" onClick={() => speak(`${impactLine}. ${hazard}`)} aria-label={t(lang, 'heroListen')}>
          <Icon name="speaker" size={18} aria-hidden="true" />
          {t(lang, 'heroListen')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={askAbout}>
          <Icon name="chat" size={18} aria-hidden="true" />
          {t(lang, 'heroAskAnything')}
        </button>
      </div>

      {focusItems.length > 0 && (
        <div className="hh-focus" role="list" aria-label={focusLabel}>
          {focusItems.map((f) => (
            <span key={f.key} className="hh-focus-item" role="listitem">
              <Icon name={f.icon} size={17} aria-hidden="true" />
              <b>{f.value}</b>
              <span className="hh-focus-unit">{f.unit}</span>
            </span>
          ))}
        </div>
      )}

      <p className="hh-prov mono">
        {evProv}{ageText ? ` · ${ageText}` : ''}{aged ? ` · ${t(lang, 'staleMay')}` : ''}
        {countdown && countdown !== 'expired' && (displayState === 'HIGH' || displayState === 'CRITICAL') ? ` · ${t(lang, 'expiresIn').replace('{t}', countdown)}` : ''}
      </p>
    </section>
  );
}
