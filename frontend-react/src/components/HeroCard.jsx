// Home hero — the verdict bulletin. A pinned paper notice: the backend's ONE
// verdict (backend/services/verdict_service.py) as a 56px banner word, a
// signal-bar + stamped severity, a one-line reason, and two chunky buttons.
// Advice never appears here — it lives in Advisory only.
//
// HONESTY (non-negotiable): absence of data is never rendered as safety;
// a payload with no `verdict` block is `unavailable`, never an all-clear;
// UNKNOWN severity gets the grey stamp, never a green one.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { t, PERSONA_LABELS } from '../i18n';
import { useApp } from '../store';
import { formatValidUntil, formatCountdown, minutesSince, isExpired } from '../format';
import { saveWarningSnapshot, readWarningSnapshot, saveObservationSnapshot } from '../offline';
import Icon from './icons';
import { sevWord } from './ui';

export default function HeroCard() {
  const { lang, persona, loc, locReady, speak, result, setView, setPendingAsk, syncTick, publishVerdict, offline } = useApp();
  const [warn, setWarn] = useState(null);
  const [current, setCurrent] = useState(null);
  // Stamped with the profile/language/district it was fetched for: switching
  // profile must not leave the previous profile's advice on screen under the
  // new profile's name while the new request is in flight.
  const [advisoryAt, setAdvisoryAt] = useState(null);
  const [sweep, setSweep] = useState(false);
  const prevKey = useRef(null);

  const askFromHome = (text) => {
    setPendingAsk(text);
    setView('ask');
  };

  const [stale, setStale] = useState(false);
  // While offline the fetch never runs, so the snapshot on screen is the last
  // one we had — and the component's own `stale` flag never flips, because no
  // request failed. Without this the card sat under an OFFLINE banner still
  // labelled LIVE · JUST NOW, which is the most misleading thing it could say.
  const aged = stale || offline;
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Freshness ticker: re-render every 30s so "verified Xm ago" and the
  // expiry countdown stay live without refetching.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Identity of the advisory this card should be showing. Compared at render
  // time (below) so a profile/language/district change drops the old advice
  // immediately, without a setState-in-effect.
  const advKey = `${persona || 'general'}:${lang}:${loc.district}`;

  useEffect(() => {
    if (!locReady) return undefined;
    let alive = true;
    api.warnings(loc.district, loc.lat, loc.lon)
      .then((d) => {
        if (!alive) return;
        setWarn(d);
        // Any answered request is current data, whatever it says. `stale` means
        // "we are showing a local snapshot because the request failed" — leaving
        // it set after a successful calm response kept a live reading labelled
        // CACHED for the rest of the session.
        setStale(false);
        if (d && d.status !== 'unavailable' && d.warning) {
          saveWarningSnapshot(d.warning, d.verified, loc.district);
        }
      })
      .catch(() => {
        if (!alive) return;
        // Offline: fall back to the last verified snapshot, stale-labelled.
        // A warning with a future valid_until is still actionable offline.
        const snap = readWarningSnapshot();
        if (snap && snap.warning && snap.district === loc.district) {
          setWarn({ status: 'ok', warning: snap.warning, verified: snap.verified, snapshotAt: snap.at });
          setStale(true);
        } else {
          setWarn({ status: 'unavailable' });
          setStale(false);
        }
      });
    api.current(loc.lat, loc.lon)
      .then((d) => {
        if (!alive) return;
        setCurrent(d.current || null);
        if (d.current) saveObservationSnapshot(d.current);
      })
      .catch(() => { if (alive) setCurrent(null); });
    // Kept stamped (contract): the Advisory view reuses the same endpoint and
    // the same key, so the bulletin and the dispatch cards can never disagree
    // about which profile the words were fetched for.
    api.profileAdvisory(loc, persona || 'general', lang)
      .then((d) => { if (alive) setAdvisoryAt({ key: advKey, text: d.advisory || '' }); })
      .catch(() => { if (alive) setAdvisoryAt({ key: advKey, text: '' }); });
    return () => { alive = false; };
  }, [locReady, loc, persona, lang, syncTick, advKey]);

  const advisory = advisoryAt && advisoryAt.key === advKey ? advisoryAt.text : '';

  // ONE severity, decided by the backend (backend/services/verdict_service.py).
  // This component must never re-derive it. Two views deriving severity
  // independently from the same payload is exactly how Home came to say
  // "All clear" while the Alerts page showed an active official alert.
  const verdict = (warn && warn.verdict) || null;
  const w = warn && warn.status !== 'unavailable' ? warn.warning : null;

  // Hand the verdict to the store so the notification watcher can see it. It
  // reacts to CHANGES only, so this firing on every poll is harmless and costs
  // no extra request — the data is already here.
  useEffect(() => {
    if (verdict) publishVerdict(verdict, loc.district);
  }, [verdict, loc.district, publishVerdict]);

  // A missing verdict (older payload, or a hard failure) falls back to UNKNOWN —
  // grey and honest. Never to LOW: a guessed calm is the one thing we cannot do.
  const level = (verdict && verdict.level) || 'UNKNOWN';
  // A payload with no `verdict` block gives us no severity to read. That is
  // "cannot confirm", never "no active warning" — so it falls to `unavailable`,
  // the one basis that can never render as an all-clear.
  const basis = (verdict && verdict.basis) || 'unavailable';
  const confirmed = !!(verdict && verdict.confirmed);
  const nearbyCount = (verdict && verdict.nearby_count) || 0;
  const verdictSource = (verdict && verdict.source) || (w && w.source) || 'IMD';

  const validUntil = formatValidUntil(w && w.valid_until);
  const countdown = w ? formatCountdown(w.valid_until, nowMs) : '';
  // RULE 2: a past valid_until demotes the warning to historical — grey,
  // timestamped, never rendered as active, even if it is all we have.
  const expired = w ? isExpired(w.valid_until, nowMs) : false;
  const displayState = expired ? 'UNKNOWN' : level;

  const warnKey = `${displayState}:${expired ? 'expired' : ''}:${(w && w.hazard) || ''}:${(w && w.valid_until) || ''}`;
  useEffect(() => {
    if (prevKey.current === null) {
      prevKey.current = warnKey; // first paint: no sweep
      return undefined;
    }
    if (prevKey.current !== warnKey) {
      prevKey.current = warnKey;
      setSweep(true);
      const tId = setTimeout(() => setSweep(false), 950);
      return () => clearTimeout(tId);
    }
    return undefined;
  }, [warnKey]);

  const generatedAt = (warn && (warn.generated_at || warn.snapshotAt)) || null;
  const ageMin = minutesSince(generatedAt, nowMs);
  const ageText = ageMin == null ? '' : ageMin < 1 ? t(lang, 'justNow') : t(lang, 'agoPattern').replace('{m}', ageMin);

  // Nothing has been asked yet: location is not set, so the fetch below has not
  // run. This is NOT "the service is unreachable" — that is a claim about IMD and
  // CAP, and making it before we have sent a single request is simply false.
  const pending = !locReady;

  // The ONE big word. Verdict-first wording: the product is a verification
  // layer, not a thermometer, and the word is translated so a non-reader who
  // can read a single word still gets the answer.
  const verdictKey = pending ? 'verdictPending'
    : expired ? 'verdictExpired'
    : basis === 'unavailable' ? 'basisUnavailable'
    : basis === 'unverified_warning' ? 'basisUnverified'
    : displayState === 'CRITICAL' ? 'sevRed' : displayState === 'HIGH' ? 'sevOrange'
    : displayState === 'MODERATE' ? 'sevYellow' : displayState === 'UNKNOWN' ? 'sevUnknown' : 'sevGreen';
  const verdictWord = t(lang, verdictKey);

  // Never print an all-clear while we could not check, and never swallow the
  // fact that official alerts are active elsewhere in the user's state.
  const hazardText = pending
    ? t(lang, 'homePendingNote')
    : expired
    ? `${(w && w.hazard) || ''}${validUntil ? ` · ${validUntil}` : ''}`
    : confirmed && (verdict.hazard || (w && w.hazard))
      ? `${verdict.hazard || w.hazard}${validUntil ? ` · ${validUntil}` : ''}`
      : basis === 'unavailable' ? (verdict && verdict.stale_cap ? t(lang, 'homeStaleCap') : t(lang, 'homeUnavailable'))
      : basis === 'unverified_warning' ? t(lang, 'unverifiedWarningNote')
      : nearbyCount > 0 ? t(lang, 'nearbyNote').replace('{n}', nearbyCount)
      : t(lang, 'homeNoWarning');

  const personaName = persona ? ((PERSONA_LABELS[lang] && PERSONA_LABELS[lang][persona]) || persona) : t(lang, 'roleNotSet');

  const speakHero = () => {
    speak(`${verdictWord}. ${hazardText}. ${advisory}`);
  };

  const fmt = (n, digits = 0) => (n == null ? '–' : Number(n).toFixed(digits));
  const obsLine = current
    ? `${fmt(current.temperature)}°C · ${current.condition || '—'} · ${t(lang, 'humidity')} ${fmt(current.humidity)}% · ${t(lang, 'windKmh')} ${fmt(current.wind_speed, 1)} · ${t(lang, 'rainMm')} ${fmt(current.rainfall, 1)}${aged ? ` · ${t(lang, 'staleMay')}` : ''}`
    : '';
  const evSource = (verdict && verdict.source) || (w && w.source) || (current && current.source) || '—';
  const payloadProv = (warn && (warn.provenance || warn.warning_provenance || warn.cap_provenance)) || 'LIVE';
  const evProv = pending ? '—'
    : aged ? 'CACHED'
    : basis === 'unavailable' ? 'UNAVAILABLE'
    : payloadProv;

  return (
    <section
      className={`verdict-bulletin${sweep ? ' is-sweep' : ''}`}
      data-sev={displayState}
      data-tour="verdict"
      aria-label={t(lang, 'homeSafety')}
    >
      <div className="vb-meta">
        <span className="kicker on-ink">{personaName} · {locReady && loc.district ? loc.district : t(lang, 'noDistrict')} · {lang.toUpperCase()}</span>
        <span className="sev-stamp"><Icon name={displayState === 'CRITICAL' || displayState === 'HIGH' ? 'alert' : displayState === 'UNKNOWN' ? 'help' : displayState === 'MODERATE' ? 'clock' : 'check'} size={14} aria-hidden="true" />{sevWord(lang, displayState)}</span>
      </div>
      <h2 className="vb-word">{verdictWord}</h2>
      <p className="vb-wordline">{hazardText}</p>
      <p className="vb-sub mono">
        {!locReady ? '…' : aged ? t(lang, 'cachedTag') : basis === 'unavailable' ? t(lang, 'basisUnavailable') : payloadProv}
        {ageText ? ` · ${ageText}${stale ? ` · ${t(lang, 'staleMay')}` : ''}` : ''}
        {countdown && countdown !== 'expired' ? ` · ${t(lang, 'expiresIn').replace('{t}', countdown)}` : ''}
        {countdown === 'expired' ? ` · ${t(lang, 'verdictExpired')}` : ''}
        {evSource !== '—' ? ` · ${evSource}` : ''}{` · ${evProv}`}
      </p>
      <div className="vb-act">
        <button type="button" className="btn btn-signal" onClick={speakHero}
          aria-label={`${t(lang, 'sbListenVerdict')} — ${verdictWord}`}>
          <Icon name="speaker" size={18} />
          {t(lang, 'sbListenVerdict')}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            askFromHome(
              w
                ? `${t(lang, 'homeAskAbout')}: ${w.hazard} in ${loc.district}`
                : `${t(lang, 'viewAsk')} — ${loc.district}`
            )
          }
        >
          {t(lang, 'homeAskAbout')}
          <Icon name="chevron" size={16} />
        </button>
      </div>
      {obsLine && (
        <details className="vb-obs">
          <summary className="mono"><Icon name="thermometer" size={14} /> {t(lang, 'moreDetail')}</summary>
          <p className="mono">{obsLine}</p>
        </details>
      )}
      {result && result.structured_fallback && (
        <p className="mono vb-sub"><span className="sev-stamp">AI OFFLINE</span></p>
      )}
    </section>
  );
}
