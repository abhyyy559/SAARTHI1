// Home hero: severity-themed summary driven ONLY by backend data.
// The severity comes from the backend's `verdict` block (one severity, decided
// once, server-side). This component never derives or invents one.
//
// WHY THIS LAYOUT LOOKS THE WAY IT DOES
// -------------------------------------
// The user may not read. The card has to land in 2-3 seconds with no reading, so
// the safety state is carried by three things, in this order of weight:
//
//   colour  - the official severity, straight from the backend, never re-graded
//   glyph   - WHAT the threat is (cyclone / rough sea / heavy rain / heat / flood)
//   word    - HOW BAD it is (Danger / Be alert / Be careful / All clear)
//
// The glyph is the biggest thing on the card because a fisherman recognises a
// cyclone before he reads a syllable. Temperature is a footnote behind a tap:
// this is a safety product, not a weather app, and temperature must never lead.
//
// HONESTY (non-negotiable, see docs/PROBLEM-STATEMENT-RULES.md §2)
//   - absence of data is never rendered as safety: `unavailable` shows an
//     "offline" glyph and the word "Cannot confirm" - never a green tick;
//   - a payload with no `verdict` block is treated as `unavailable`, not as
//     "no active warning", because we genuinely cannot read a severity from it;
//   - UNKNOWN fills no ladder bars, so it cannot be misread as a low level.
import { useEffect, useRef, useState } from 'react';
import './HeroCard.css';
import { api } from '../api';
import { t, PERSONA_LABELS } from '../i18n';
import { useApp } from '../store';
import { formatValidUntil, formatCountdown, minutesSince, isExpired, splitAdvisory } from '../format';
import { saveWarningSnapshot, readWarningSnapshot, saveObservationSnapshot } from '../offline';
import Icon from './icons';

// Hazard -> glyph. Matched on keywords rather than an exact enum because CAP
// `event` strings are free text ("Tropical Cyclone Warning", "Heavy Rain") and
// IMD `type` values vary. Order matters: the specific threat wins over generic.
// Every glyph below exists in ./icons.jsx - do not invent names, a missing name
// silently falls back to a generic activity icon.
const HAZARD_GLYPHS = [
  [/cyclon|tufan|toofan|typhoon|hurricane|storm surge|चक्रवात|तूफ़ान|तूफान|తుఫాను/, 'storm'],
  [/rough sea|high wave|swell|sea state|tide|tsunami|समुद्र|सागर|सुनामी|సముద్ర|అలలు|సునామీ/, 'wave'],
  [/flood|inundat|बाढ़|వరద/, 'flood'],
  [/rain|downpour|shower|बारिश|वर्षा|వర్ష/, 'rain'],
  [/heat|गर्मी|लू|ఎండ|వడగాలి/, 'heat'],
  [/thunder|lightning|squall|आंधी|बिजली|ఉరుము|పిడుగు/, 'storm'],
  [/wind|gale|हवा|గాలి/, 'wind'],
  [/snow|hail|बर्फ|ओले|మంచు|వడగండ్లు/, 'snow'],
  [/fog|smog|visibility|कोहरा|పొగమంచు/, 'fog'],
  [/landslide|avalanche|भूस्खलन|కొండచరియ/, 'mountain'],
  [/fire|flame|आग|మంట/, 'flame'],
];
const hazardGlyph = (hazard) => {
  const h = String(hazard || '').toLowerCase();
  if (!h) return null;
  const hit = HAZARD_GLYPHS.find(([re]) => re.test(h));
  return hit ? hit[1] : null;
};

// Severity -> how many ladder bars are filled. A shape cue, not colour alone,
// so the gauge still reads for a colour-blind user.
const BAR_FILL = { CALM: 1, LOW: 2, MODERATE: 3, HIGH: 4, CRITICAL: 5 };

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
  const advKey = `${persona}:${lang}:${loc.district}`;

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
    api.profileAdvisory(loc, persona, lang)
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
  // CAP, and making it before we have sent a single request is simply false. A
  // first-run user was told "Warning service unreachable" on a perfectly healthy
  // backend, which is the exact failure this product exists to prevent: absence
  // of data rendered as a scary fact.
  const pending = !locReady;

  // The ONE big word. Verdict-first wording: the product is a verification
  // layer, not a thermometer, and the word is translated so a non-reader who
  // can read a single word still gets the answer.
  // "Cannot confirm" and "Not confirmed" are real answers and read differently
  // from "All clear" — they are reused from i18n.js so Home and Alerts agree.
  const verdictKey = pending ? 'verdictPending'
    : expired ? 'verdictExpired'
    : basis === 'unavailable' ? 'basisUnavailable'
    : basis === 'unverified_warning' ? 'basisUnverified'
    : displayState === 'CRITICAL' ? 'sevRed' : displayState === 'HIGH' ? 'sevOrange'
    : displayState === 'MODERATE' ? 'sevYellow' : displayState === 'UNKNOWN' ? 'sevUnknown' : 'sevGreen';
  const verdictWord = t(lang, verdictKey);

  // The tag names the BASIS of the verdict, not a guess. When the big word
  // already IS the basis, the tag would just repeat it on the same line, so it
  // is dropped rather than printed twice.
  const tagRepeatsWord = basis === 'unavailable' || basis === 'unverified_warning';
  const tag = tagRepeatsWord ? ''
    : expired ? `${t(lang, 'verdictExpired')} · ${verdictSource} · ${validUntil}`
    : basis === 'verified_warning' ? `${t(lang, 'basisOfficial')} · ${verdictSource}${aged ? ' · CACHED' : ''}`
    : basis === 'cap_alert' ? `${t(lang, 'basisCapAlert')} · ${verdictSource}`
    : t(lang, 'basisNone');

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

  // The glyph must describe the SAME hazard the hazard line prints, and only
  // when the backend confirmed it.
  const rawHazard = expired ? (w && w.hazard)
    : confirmed && (verdict.hazard || (w && w.hazard)) ? (verdict.hazard || (w && w.hazard))
    : null;
  // "Cannot check" and "not confirmed" get their own glyphs. A green tick is
  // reserved for a confirmed no-warning — nothing else may borrow it. A pending
  // card gets the location pin, because the missing thing is the place, not the
  // answer.
  const badgeGlyph = pending ? 'pin'
    : expired ? 'clock'
    : basis === 'unavailable' ? 'offline'
    : basis === 'unverified_warning' ? 'help'
    : confirmed && rawHazard ? (hazardGlyph(rawHazard) || 'alert')
    : confirmed ? 'check'
    : 'help';

  const barCount = BAR_FILL[displayState] || 0;
  const personaName = (PERSONA_LABELS[lang] && PERSONA_LABELS[lang][persona]) || persona;

  const speakHero = () => {
    speak(`${verdictWord}. ${hazardText}. ${advisory}`);
  };
  const advSplit = splitAdvisory(advisory);

  const fmt = (n, digits = 0) => (n == null ? '–' : Number(n).toFixed(digits));
  const obsLine = current
    ? `${fmt(current.temperature)}°C · ${current.condition || '—'} · ${t(lang, 'humidity')} ${fmt(current.humidity)}% · ${t(lang, 'windKmh')} ${fmt(current.wind_speed, 1)} · ${t(lang, 'rainMm')} ${fmt(current.rainfall, 1)}${aged ? ` · ${t(lang, 'staleMay')}` : ''}`
    : '';
  const evSource = (verdict && verdict.source) || (w && w.source) || (current && current.source) || '—';
  // The payload's own provenance, verbatim and machine-readable (never
  // translated). A LIVE warnings response carries `warning_provenance`; the DEMO
  // and unavailable payloads carry `provenance`. The status chip below uses this
  // same value, so the card can no longer say LIVE beside an evidence line that
  // says DEMO or CACHED.
  const payloadProv = (warn && (warn.provenance || warn.warning_provenance || warn.cap_provenance)) || 'LIVE';
  const evProv = pending ? '—'
    : aged ? 'CACHED'
    : basis === 'unavailable' ? 'UNAVAILABLE'
    : payloadProv;

  return (
    <section className={`wx-hero${sweep ? ' wx-sweep' : ''}`} data-sev={displayState} data-tour="verdict" aria-label={t(lang, 'homeSafety')}>
      <div className="wx-strip">
        <div className="wx-strip-loc">
          <span className="wx-live-dot" />
          <span>{!locReady ? '…' : aged ? t(lang, 'cachedTag') : basis === 'unavailable' ? t(lang, 'basisUnavailable') : payloadProv}</span>
          <span style={{ color: 'var(--ink-3)' }}>·</span>
          <span className="wx-loc-name"><Icon name="pin" size={13} /> {loc.district}</span>
        </div>
      </div>

      <div className="wx-verdict">
        {/* The 2-second read: colour + hazard glyph. Tapping it speaks. */}
        <button
          type="button"
          className="wx-glyph"
          onClick={speakHero}
          aria-label={`${t(lang, 'homeListen')} — ${t(lang, 'homeThreatLabel')}: ${verdictWord}`}
          title={t(lang, 'homeListen')}
        >
          <Icon name={badgeGlyph} size={64} />
          <span className="wx-glyph-speak" aria-hidden><Icon name="speaker" size={15} /></span>
        </button>
        <div className="wx-verdict-body">
          <div className="wx-eyebrow">
            <span>{personaName} · {loc.district}</span>
            {ageText && <span>· {ageText}{stale ? ` · ${t(lang, 'staleMay')}` : ''}</span>}
          </div>
          <div className="wx-hero-word">
            <span>{verdictWord}</span>
            {tag && <span className="wx-official-tag">{tag}</span>}
          </div>
          <div className="wx-hero-hazard">
            <span>{hazardText}</span>
          </div>

          {/* How serious, without a word: a 5-step ladder filled to the official
              level. UNKNOWN fills nothing — it must not be read as a level. */}
          <div
            className={`wx-ladder${barCount === 0 ? ' wx-unknown' : ''}`}
            role="img"
            aria-label={`${t(lang, 'homeSeverityLabel')}: ${verdictWord}`}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={`wx-ladder-bar${n <= barCount ? ' wx-on' : ''}`} />
            ))}
          </div>

          <div className="wx-actions">
            <button type="button" className="wx-speak-btn" onClick={speakHero}>
              <Icon name="speaker" size={14} />
              <span>{t(lang, 'homeListen')}</span>
            </button>
            {w && (
              <button type="button" className="wx-speak-btn" onClick={() => askFromHome(`${t(lang, 'homeAskAbout')}: ${w.hazard} in ${loc.district}`)}>
                <Icon name="chat" size={14} />
                <span>{t(lang, 'homeAskAbout')}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="wx-action">
        {/* "Checking…" is a claim that a check is in flight. Before location is
            set the card never even calls the advisory endpoint, so saying it here
            promised work that was not happening — and it never resolved, because
            nothing was going to. The verdict above already says "Not checked
            yet"; this line stays empty until there is something true to say. */}
        {advSplit.lead || (pending ? '' : t(lang, 'checking'))}
        {/* The persona-specific half of the advisory must be VISIBLE, not folded
            behind a disclosure. The server leads every occupational advisory
            with the same generic sentence ("...follow local authority and IMD
            instructions.") and puts the occupation-specific action in the
            second sentence, so a collapsed <details> made the profile switch
            look like a no-op: the on-screen text was byte-identical for
            farmer/driver/student/... and only the hidden line differed. */}
        {advSplit.detail && <p className="sub wx-action-detail">{advSplit.detail}</p>}
      </div>

      {/* Expiry countdown as a dedicated strip — same value, same keys,
          still inside the severity-tinted banner. */}
      {countdown && (
        <div className={`wx-count-strip${countdown === 'expired' ? ' is-expired' : ''}`} role="status">
          <Icon name="clock" size={14} />
          <span>{countdown === 'expired' ? t(lang, 'verdictExpired') : t(lang, 'expiresIn').replace('{t}', countdown)}</span>
        </div>
      )}

      {/* Provenance stays visible (product constraint). The weather numbers do
          not: they are the footnote, behind a tap, never the headline.
          Nothing is checked yet before location is set, so there is no source to
          name and no provenance to report — an empty "SRC — · —" strip would be
          noise pretending to be evidence. */}
      {!pending && (
        <div className="wx-evidence mono">
          <span><Icon name="database" size={13} /> SRC {evSource}</span>
          <span>·</span>
          <span>{evProv}</span>
        </div>
      )}
      {obsLine && (
        <details className="wx-obs">
          <summary className="mono"><Icon name="thermometer" size={14} /> {t(lang, 'moreDetail')}</summary>
          <p className="mono">{obsLine}</p>
        </details>
      )}

      {result && result.structured_fallback && (
        <div className="wx-evidence mono" style={{ marginBottom: 0 }}>
          <span className="wx-ai-chip wx-on">AI OFFLINE</span>
        </div>
      )}
    </section>
  );
}
