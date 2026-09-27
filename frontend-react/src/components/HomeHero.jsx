// HomeHero — the sky hero. A full-width condition band (the sky, the big
// number, the place) that frames REAL weather around what it means for
// safety: heat stress, rain/flood, wind — three plain-language lenses, not
// raw numbers alone.
//
// Honesty contract:
// - The backend verdict is the ONE severity — read, never derived. The lens
//   words ("Hot", "Breezy", "Heavy rain") are weather descriptions, never
//   safety severities; no icon+word+color stamp is ever attached to them.
// - Every value carries its provenance: LIVE / CACHED / DEMO / UNAVAILABLE,
//   taken from the API payload. Demo fixtures are never labelled LIVE.
// - Missing data renders "not available yet", never a fake all-clear.
// - Manual city fallback (text input + apply) appears whenever location is
//   denied or unavailable, wired to the existing location-search API and the
//   store's setDistrict — the hero only reads the location surface.
// - The ask entry below still submits through the store's ask() (Phase 0
//   behaviour) and scrolls to the chat composer; HomeChat itself is untouched.
// - Lens icon chips are tinted from the SKY weather palette (one per lens
//   type) — a weather cue, never a severity cue. The verdict stamp below the
//   dial is the only loud colour on this screen: solid priority colour with
//   icon + word, matching the SeverityDial's four arcs.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { t, DISTRICTS } from '../i18n';
import { useApp } from '../store';
import { formatCountdown, minutesSince, isExpired } from '../format';
import { saveWarningSnapshot, readWarningSnapshot, saveObservationSnapshot } from '../offline';
import Icon from './icons';
import LocationPrompt from './LocationPrompt';

// Condition word → the one glyph a non-reader recognises. Deliberately coarse:
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

// Sky-band treatment per condition: a gradient that feels like the sky, with
// a text colour that stays readable on it. No severity meaning here — this is
// weather, not the verdict.
const SKY = {
  sun:   { bg: 'linear-gradient(135deg,#F9DC9A 0%,#F0A95C 100%)', fg: '#2A2118' },
  cloud: { bg: 'linear-gradient(135deg,#DCE3EA 0%,#AEBBCA 100%)', fg: '#232A33' },
  rain:  { bg: 'linear-gradient(135deg,#A9BFD3 0%,#7C93AA 100%)', fg: '#1E2833' },
  storm: { bg: 'linear-gradient(135deg,#5B6575 0%,#333B48 100%)', fg: '#FFFFFF' },
  snow:  { bg: 'linear-gradient(135deg,#EFF5FA 0%,#CBDCE9 100%)', fg: '#243040' },
  fog:   { bg: 'linear-gradient(135deg,#E0DCCF 0%,#C2BAA7 100%)', fg: '#2B2820' },
  wind:  { bg: 'linear-gradient(135deg,#D3E6DA 0%,#A4C8B6 100%)', fg: '#1E2E26' },
  heat:  { bg: 'linear-gradient(135deg,#F7B26E 0%,#E57E35 100%)', fg: '#2E1D0E' },
};
const SKY_NONE = { bg: 'linear-gradient(135deg,#F6F1E7 0%,#E9E1D2 100%)', fg: '#2A2419' };

// Lens icon chips: each safety lens carries its own condition tint — the sky
// treatment for that lens type (weather colour, never severity colour — the
// honesty contract above). One visual cue per box, 2px ink borders retained.
const LENS_TONE = { heat: SKY.heat, rain: SKY.rain, wind: SKY.wind };

const fmt1 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : null;
};

// Plain weather descriptions for the three safety lenses. Buckets describe
// the air, not the danger — "Very hot" is what the thermometer says, the
// verdict dial says whether it is dangerous.
function heatWord(c, lang) {
  if (c == null) return null;
  if (c >= 35) return t(lang, 'heatVeryHot');
  if (c >= 30) return t(lang, 'heatHot');
  if (c >= 25) return t(lang, 'heatWarm');
  if (c >= 18) return t(lang, 'heatMild');
  return t(lang, 'heatCool');
}
function rainWord(r, lang) {
  if (r == null) return null;
  if (r <= 0) return t(lang, 'rainDry');
  if (r < 2.5) return t(lang, 'rainLight');
  if (r < 7.5) return t(lang, 'rainSteady');
  return t(lang, 'rainHeavy');
}
function windWord(w, lang) {
  if (w == null) return null;
  if (w < 12) return t(lang, 'windCalm');
  if (w < 25) return t(lang, 'windBreezy');
  if (w < 40) return t(lang, 'windWindy');
  return t(lang, 'windGusty');
}

function SeverityDial({ level, word }) {
  const DIAL_ANGLE = { LOW: 180, MODERATE: 135, HIGH: 90, CRITICAL: 45 };
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

const PROV_CHIP = {
  display: 'inline-block', background: '#fff', border: '2px solid var(--ink)',
  borderRadius: 999, padding: '2px 10px', fontWeight: 800, fontSize: 12,
  letterSpacing: '.05em',
};

function Lens({ icon, label, value, unit, note, missing, lang, tone }) {
  const chip = LENS_TONE[tone];
  return (
    <div role="listitem" style={{
      display: 'flex', gap: 12, alignItems: 'flex-start', background: '#fff',
      border: '2px solid var(--ink)', borderRadius: 12, padding: '10px 12px', flex: '1 1 0', minWidth: 150,
    }}>
      <span aria-hidden="true" style={{
        flexShrink: 0, marginTop: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 42, height: 42, borderRadius: 10, border: '2px solid var(--ink)',
        background: chip ? chip.bg : '#fff', color: chip ? chip.fg : 'var(--ink)',
      }}><Icon name={icon} size={24} /></span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, opacity: 0.75 }}>{label}</span>
        {missing ? (
          <span style={{ display: 'block', fontSize: 15, fontWeight: 800, marginTop: 2 }}>{t(lang, 'lensNA')}</span>
        ) : (
          <span>
            <span style={{ display: 'block', fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.15 }}>
              {value}{unit ? <span style={{ fontSize: 14, fontWeight: 700, opacity: 0.7 }}> {unit}</span> : null}
            </span>
            {note ? <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginTop: 2 }}>{note}</span> : null}
          </span>
        )}
      </span>
    </div>
  );
}

export default function HomeHero() {
  const { lang, loc, locReady, speak, setDistrict, ask, syncTick, publishVerdict, offline } = useApp();
  const [warn, setWarn] = useState(null);
  const [current, setCurrent] = useState(null);
  const [wxProv, setWxProv] = useState(null);
  const [stale, setStale] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [cityQ, setCityQ] = useState('');
  const [cityBusy, setCityBusy] = useState(false);
  const [cityErr, setCityErr] = useState('');
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
        setWxProv(d && d.provenance ? d.provenance : 'UNAVAILABLE');
        if (d.current) saveObservationSnapshot(d.current);
      })
      .catch(() => { if (alive) { setCurrent(null); setWxProv('UNAVAILABLE'); } });
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

  // Sky band: real data only. Missing → the honest "not available yet" state.
  const temp = current && current.temperature != null ? Math.round(current.temperature) : null;
  const hum = current && current.humidity != null ? Math.round(current.humidity) : null;
  const rain = current && current.rainfall != null ? Number(current.rainfall) : null;
  const wind = current && current.wind_speed != null ? Number(current.wind_speed) : null;
  const condKey = current ? conditionIcon(current.condition) : null;
  const sky = (condKey && SKY[condKey]) || SKY_NONE;
  const condWord = current && current.condition ? current.condition : '';
  const wxProvLabel = pending ? null : (wxProv || 'UNAVAILABLE');

  // Safety lenses: heat stress, rain/flood, wind — the raw values plus a
  // plain description of what the air is doing. Missing → lensNA.
  const heatNote = [heatWord(temp, lang), hum != null ? `${hum}% ${t(lang, 'humidity')}` : null].filter(Boolean).join(' · ');
  const lenses = [
    { icon: 'thermometer', tone: 'heat', label: t(lang, 'lensHeat'), value: temp != null ? `${temp}°` : null, unit: null, note: heatNote || null, missing: temp == null },
    { icon: 'rain', tone: 'rain', label: t(lang, 'lensRain'), value: rain != null ? fmt1(rain) : null, unit: rain != null ? t(lang, 'rainMm') : null, note: rainWord(rain, lang), missing: rain == null },
    { icon: 'wind', tone: 'wind', label: t(lang, 'lensWind'), value: wind != null ? String(Math.round(wind)) : null, unit: wind != null ? t(lang, 'windKmh') : null, note: windWord(wind, lang), missing: wind == null },
  ];

  const generatedAt = (warn && (warn.generated_at || warn.snapshotAt)) || null;
  const ageMin = minutesSince(generatedAt, nowMs);
  const ageText = ageMin == null ? '' : ageMin < 1 ? t(lang, 'justNow') : t(lang, 'agoPattern').replace('{m}', ageMin);
  const evProv = pending ? '—' : aged ? 'CACHED' : basis === 'unavailable' ? 'UNAVAILABLE' : ((warn && (warn.provenance || warn.warning_provenance || warn.cap_provenance)) || 'LIVE');

  const askAbout = () => {
    // HomeChat is mounted on this view and publishes its submit to the store,
    // so the question is asked immediately — not dropped into a dead ref.
    ask(w ? `${t(lang, 'homeAskAbout')}: ${hazard} in ${loc.district}` : `${loc.district}`);
    const el = document.querySelector('[data-tour="home-chat"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Manual city fallback: location denied or unavailable. Uses the existing
  // location-search API (read-only) and routes the pick through the store's
  // setDistrict, which carries real coordinates — never guessed.
  const applyCity = () => {
    const q = cityQ.trim();
    if (!q || cityBusy) return;
    setCityBusy(true);
    setCityErr('');
    api.searchLocation(q)
      .then((results) => {
        const first = results && results[0];
        if (first && (first.district || first.city) && (first.latitude != null || first.lat != null)) {
          setDistrict(first);
          setCityQ('');
        } else {
          setCityErr(t(lang, 'cityNoMatch'));
        }
      })
      .catch(() => setCityErr(t(lang, 'cityFailed')))
      .finally(() => setCityBusy(false));
  };

  return (
    <section className={`home-hero${pulse ? ' is-pulse' : ''}`} data-sev={displayState} data-tour="sky" aria-label={t(lang, 'heroSkyNow')}>
      {/* Sky band — the creative weather hero: gradient sky, big number. */}
      <div data-cond={condKey || 'none'} style={{
        background: sky.bg, color: sky.fg, border: '2px solid var(--ink)',
        borderRadius: 14, padding: '12px 14px 14px', marginBottom: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.8 }}>
            {t(lang, 'heroSkyNow')}
          </span>
          {wxProvLabel ? <span style={PROV_CHIP}>{wxProvLabel}</span> : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {condKey ? (
            <span aria-hidden="true" style={{ flexShrink: 0, lineHeight: 0 }}>
              <Icon name={condKey} size={88} />
            </span>
          ) : null}
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 64, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}
              aria-label={`${t(lang, 'heroTempNow')} ${temp != null ? `${temp}°C` : '—'}`}>
              {temp != null ? `${temp}°` : '–'}
            </span>
            {condWord ? (
              <span style={{ display: 'block', fontSize: 20, fontWeight: 700, marginTop: 2 }}>{condWord}</span>
            ) : null}
            {!current && !pending ? (
              <span style={{ display: 'block', fontSize: 15, fontWeight: 700, marginTop: 4 }}>{t(lang, 'wxUnavailable')}</span>
            ) : null}
          </span>
        </div>
      </div>

      {/* Verdict strip — the backend's safety verdict, compact under the sky. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <SeverityDial level={displayState} word={t(lang, `sev${displayState === 'CRITICAL' ? 'Red' : displayState === 'HIGH' ? 'Orange' : displayState === 'MODERATE' ? 'Yellow' : displayState === 'LOW' ? 'Green' : 'Unknown'}`)} />
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <p className="hh-impact">
            <span className="sev-stamp" data-sev={displayState}>
              <Icon name={displayState === 'CRITICAL' || displayState === 'HIGH' ? 'alert' : displayState === 'UNKNOWN' ? 'help' : displayState === 'MODERATE' ? 'clock' : 'check'} size={15} aria-hidden="true" />
              {t(lang, `sev${displayState === 'CRITICAL' ? 'Red' : displayState === 'HIGH' ? 'Orange' : displayState === 'MODERATE' ? 'Yellow' : displayState === 'LOW' ? 'Green' : 'Unknown'}`)}
            </span>
            <span className="hh-impact-text">{impactLine}</span>
          </p>
          <p className="hh-prov mono">
            {evProv}{ageText ? ` · ${ageText}` : ''}{aged ? ` · ${t(lang, 'staleMay')}` : ''}
            {countdown && countdown !== 'expired' && (displayState === 'HIGH' || displayState === 'CRITICAL') ? ` · ${t(lang, 'expiresIn').replace('{t}', countdown)}` : ''}
          </p>
        </div>
      </div>

      {/* Safety lenses — what the conditions mean: heat, rain, wind. */}
      <p style={{ fontSize: 13, fontWeight: 800, margin: '0 0 8px' }}>{t(lang, 'lensTitle')}</p>
      <div role="list" aria-label={t(lang, 'lensTitle')} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {lenses.map((l) => (
          <Lens key={l.icon} icon={l.icon} tone={l.tone} label={l.label} value={l.value} unit={l.unit} note={l.note} missing={l.missing} lang={lang} />
        ))}
      </div>

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
      {!locReady && (
        <div style={{ marginTop: 10, background: '#fff', border: '2px solid var(--ink)', borderRadius: 12, padding: '10px 12px' }}>
          <p style={{ fontSize: 14, fontWeight: 800, margin: '0 0 8px' }}>{t(lang, 'cityTitle')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={cityQ}
              onChange={(e) => setCityQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyCity(); }}
              placeholder={t(lang, 'cityPh')}
              aria-label={t(lang, 'cityPh')}
              style={{ flex: 1, minWidth: 0, fontSize: 16, padding: '10px 12px', border: '2px solid var(--ink)', borderRadius: 8, background: '#fff', color: 'var(--ink)' }}
            />
            <button type="button" className="btn btn-signal" onClick={applyCity} disabled={cityBusy || !cityQ.trim()}>
              {cityBusy ? '…' : t(lang, 'cityApply')}
            </button>
          </div>
          {cityErr ? <p role="alert" style={{ fontSize: 13, fontWeight: 700, margin: '8px 0 0', color: 'var(--sev-red)' }}>{cityErr}</p> : null}
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
    </section>
  );
}
