// Chat: the main feature. Questions carry WHO the user is (persona) and WHERE
// they are (district) - the backend answers for that person in that place, in
// the selected language. Spoken answers are OFF by default - the user must
// explicitly enable them. Question chips match the persona; a demo-safe example
// row is shown on an empty chat.
//
// FACTS-ONLY: the strip at the top says so, and the escape link to My advice
// sits right beside it. Ask never gives guidance; it answers from official
// bulletins.
//
// Trust console, not a chatbot: every answer shows which source grounded which
// fact, the source's provenance verbatim, and the ONE server verdict for the
// turn. Nothing here re-derives severity, and an unreachable warning service is
// never rendered as a calm.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { t, PERSONA_LABELS, PERSONA_QUESTIONS } from '../i18n';
import { useApp } from '../store';
import { answerOffline, queueQuery, readQueue, clearQueue, readObservationSnapshot } from '../offline';
import { minutesSince } from '../format';
import { useVoiceInput } from '../useVoiceInput';
import Icon from './icons';
import RichText from './RichText';
import { SevStamp } from './ui';

// Provenance is a fixed, machine-readable vocabulary. Never translate it, never
// map one value onto another — styles.css colours each class.
const PROV = ['LIVE', 'CACHED', 'DEMO', 'COMMUNITY', 'UNAVAILABLE', 'UNCONFIGURED'];

const provClass = (p) => (PROV.includes(p) ? `prov ${p}` : 'prov');

// What each evidence entry actually grounds: a glyph plus a short label, so the
// fact-to-source link reads before any word does.
const TYPE_META = {
  current_observation: { icon: 'thermometer', key: 'evCurrent' },
  city_forecast: { icon: 'cloud', key: 'evForecast' },
  district_warning: { icon: 'alert', key: 'evWarning' },
  cap_alert: { icon: 'bell', key: 'evAlert' },
};
const typeMeta = (type) => TYPE_META[type] || { icon: 'file', key: 'evOther' };

// Sanitize text for TTS — strips markdown, URLs, emoji, comments
function sanitizeForTTS(text, maxChars = 600) {
  if (!text) return '';
  let t = String(text);
  t = t.replace(/https?:\/\/\S+/g, '');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
  t = t.replace(/(\*|_)(.*?)\1/g, '$2');
  t = t.replace(/`{1,3}(.*?)`{1,3}/gs, '$1');
  t = t.replace(/~~(.*?)~~/g, '$1');
  t = t.replace(/^>\s*/gm, '');
  t = t.replace(/^[-*_]{3,}\s*$/gm, '');
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  t = t.replace(/^\/\/.*$/gm, '');
  t = t.replace(/\s\/\/.*$/gm, '');
  t = t.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2500}-\u{2BEF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F926}-\u{1F937}]+/gu, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > maxChars) {
    const truncated = t.slice(0, maxChars);
    const lastEnd = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
    if (lastEnd > maxChars * 0.5) {
      t = truncated.slice(0, lastEnd + 1);
    } else {
      t = truncated.replace(/\s+\S*$/, '') + '...';
    }
  }
  return t;
}

// "2026-09-17T22:30:00+05:30" -> "17/09 22:30". Anything unparseable is shown
// as-is rather than hidden — an odd timestamp still carries provenance.
function stamp(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : String(iso);
}

function ProvBadge({ value }) {
  if (!value) return null;
  return <span className={provClass(value)}>{value}</span>;
}

// Read the server's verdict for display. This SELECTS server fields, it never
// grades anything: `level` and `severity` come from the payload verbatim.
//
// The one trap: the payload carries severity "GREEN" even when the warning
// service was unreachable, so a bare severity must never be shown unless the
// server confirmed it (`verdict.confirmed`, or `warning.active` on an older
// backend). Otherwise "we could not check" would render as green safety.
function verdictView(lang, m) {
  const v = m.verdict || {};
  const w = m.warning || {};
  const level = v.level || (m.risk && m.risk.level) || 'UNKNOWN';
  const confirmed = typeof v.confirmed === 'boolean' ? v.confirmed : w.active === true;
  const unreachable = v.basis === 'unavailable' || w.status === 'unavailable';
  const basis = v.basis || '';
  return {
    level,
    confirmed,
    unreachable,
    basis,
    severity: confirmed ? (v.severity || w.severity || null) : null,
    hazard: confirmed ? (v.hazard || w.hazard || null) : null,
    nearby: typeof v.nearby_count === 'number' ? v.nearby_count : 0,
    detail: v.detail || '',
    say: unreachable ? t(lang, 'warnUnreachable')
      : !confirmed ? t(lang, 'warnUnconfirmed')
        : basis === 'none' ? t(lang, 'warnNone')
          : t(lang, 'warnConfirmed'),
  };
}

function VerdictBanner({ lang, view }) {
  return (
    <div className="verdict-mini" data-sev={view.level} role="status">
      <span className="sev-bar" aria-hidden="true" />
      <div className="vm-body">
        <div className="bc-head">
          <SevStamp lang={lang} level={view.level} />
          {!view.confirmed && <span className="warn-chip">{t(lang, 'warnUnconfirmed')}</span>}
        </div>
        {view.hazard && <div className="vm-haz">{view.hazard}</div>}
        <div className="vm-say">{view.say}{view.basis ? ` · ${t(lang, 'verdictBasis')}: ${view.basis}` : ''}</div>
      </div>
    </div>
  );
}

// Backend unreachable: the same UNKNOWN/unavailable shape the server returns
// when it cannot reach the warning service, so the banner says "cannot confirm"
// instead of letting an empty answer read as an all-clear.
const OFFLINE_VERDICT_BASE = {
  level: 'UNKNOWN', basis: 'unavailable', confirmed: false,
};
const offlineVerdict = (lang) => ({
  ...OFFLINE_VERDICT_BASE,
  detail: t(lang, 'offlineVerdictDetail'),
});

export default function ChatPanel() {
  const { lang, persona, handleResult, registerAsk, pendingAskRef, speak, stopSpeaking, loc, locReady, netState, showToast, setView } = useApp();
  const [log, setLog] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // Auto-speak is OFF by default - answers stay silent until the user enables
  // spoken answers with the toggle below.
  const [muted, setMuted] = useState(true);
  const logRef = useRef(null);
  const SUGGESTIONS = PERSONA_QUESTIONS[persona] || PERSONA_QUESTIONS.general;
  // Dictate-then-send mic: speech fills the input as editable text, nothing
  // is sent until the user hits enter — like OS dictation (Win+H). This is the
  // ONLY mic affordance in this component; everything else here is speaker
  // output (replay, mute), not input.
  const dictation = useVoiceInput(lang, (text) => setInput(text));
  // Demo-safe example prompts shown on an empty chat; tapping one sends it.
  const EXAMPLE_CHIPS = ['chipHyd', 'chipCyclone', 'chipMumbai'];

  const ask = useCallback(async (text, opts = {}) => {
    const q = (typeof text === 'string' && text ? text : input).trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    setLog((l) => [...l, { role: 'user', text: q }]);
    try {
      const t0 = Date.now();
      const r = await api.chat({
        message: q, latitude: loc.lat, longitude: loc.lon, language: lang, user_type: persona || 'general',
      });
      const ms = Date.now() - t0;
      setLog((l) => [...l, {
        role: 'bot', text: r.answer, evidence: r.evidence || [],
        risk: r.risk, warning: r.warning, verdict: r.verdict,
        dataFreshness: r.data_freshness,
        fallback: !!r.structured_fallback,
        live: !!opts.live, ms, id: Date.now(),
      }]);
      handleResult({ ...r, _context: `${lang}:${persona}:${loc.district}` });
      try {
        localStorage.setItem('wgpt-queries', String(Math.min(99, Number(localStorage.getItem('wgpt-queries') || 0) + 1)));
      } catch { /* engagement heuristic best-effort */ }
      // Voice-first but opt-in: spoken answers only when the user has enabled
      // them (Sarvam when configured, browser voice otherwise). Muted by default.
      if (!muted) speak(sanitizeForTTS(r.answer));
    } catch {
      // Offline (§5): cached observation card if we have one, honest
      // no-data message otherwise — never the LLM on an empty package.
      // The query is queued (capped) for replay on reconnect.
      const snap = readObservationSnapshot();
      const ageMin = snap ? minutesSince(snap.at, Date.now()) : null;
      const n = queueQuery({ text: q, lang, persona, lat: loc.lat, lon: loc.lon, district: loc.district });
      if (snap && snap.obs) {
        setLog((l) => [...l, {
          role: 'bot', structured: snap.obs, verdict: offlineVerdict(lang),
          cachedAge: ageMin, stale: ageMin != null && ageMin > 30,
          queued: n, id: Date.now(),
        }]);
      } else {
        const off = answerOffline(q, lang);
        setLog((l) => [...l, {
          role: 'bot', text: off,
          evidence: [], verdict: offlineVerdict(lang), queued: n, id: Date.now(),
        }]);
      }
    }
    setBusy(false);
  }, [input, busy, lang, persona, handleResult, speak, muted, loc]);

  // Replay queued queries once on reconnect, oldest first.
  useEffect(() => {
    if (netState !== 'live') return;
    const q = readQueue();
    if (!q.length) return;
    clearQueue();
    showToast(t(lang, 'reconnected'));
    let i = 0;
    const next = () => {
      if (i >= q.length) return;
      const item = q[i++];
      ask(item.text, { live: true });
      setTimeout(next, 1200);
    };
    const tId = setTimeout(next, 600);
    return () => clearTimeout(tId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netState]);

  // Keep the latest message and the thinking dots in view as the chat grows.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [log, busy]);

  // Publish this handler for the voice panel and the safety probe. Registered from
  // an EFFECT (never during render) - which is also what kept it off the lint list.
  useEffect(() => {
    registerAsk(ask);
    return () => registerAsk(null);
  }, [ask, registerAsk]);

  // A question raised on Home (tap or voice) is consumed once here on mount.
  useEffect(() => {
    if (!pendingAskRef.current) return undefined;
    const text = pendingAskRef.current;
    pendingAskRef.current = null;
    ask(text);
    return undefined;
  }, [pendingAskRef, ask]);

  return (
    <section aria-label={t(lang, 'chatRegion')}>
      {/* The facts-only boundary, stated before the first message. */}
      <div className="facts-strip">
        <span className="facts-icon"><Icon name="file" size={20} /></span>
        <div>
          <p>{t(lang, 'sbFactsOnly')}</p>
          <p className="sub">{t(lang, 'askAs')} <b>{persona ? ((PERSONA_LABELS[lang] && PERSONA_LABELS[lang][persona]) || persona) : t(lang, 'roleNotSet')}</b> · {locReady && loc.district ? loc.district : t(lang, 'noDistrict')}</p>
        </div>
        <button type="button" className="facts-escape" onClick={() => setView('advisory')}>
          <Icon name="sun" size={16} />
          {t(lang, 'askAdviceHint')}
        </button>
      </div>

      {/* Spoken answers: the slab switch lives here, above the conversation, so
          it is found in seconds. Muted by default; toggling never changes what
          is fetched, only whether the answer is read aloud. */}
      <div className="hear-row">
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={!muted}
          aria-label={t(lang, 'askHearAnswers')}
          onClick={() => { stopSpeaking(); setMuted((m) => !m); }}
        >
          <span className="switch-track"><span className="switch-thumb" /></span>
        </button>
        <span className="switch-label">{t(lang, 'askHearAnswers')}</span>
        <span className="sub mono">{muted ? t(lang, 'muted') : t(lang, 'soundOn')}</span>
      </div>

      <div className="chat" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
        {log.length === 0 && !busy && (
          <>
            <p className="sub">{t(lang, 'chatEmpty')}</p>
            <div className="chip-row">
              {EXAMPLE_CHIPS.map((k) => (
                <button key={k} type="button" className="chip" onClick={() => ask(t(lang, k))} disabled={busy}>
                  {t(lang, k)}
                </button>
              ))}
            </div>
          </>
        )}
        {log.map((m, i) => {
          const view = m.role === 'bot' && (m.verdict || m.risk || m.warning) ? verdictView(lang, m) : null;
          // Freshness of the whole answer: the server's own field, falling back
          // to the first evidence entry's provenance (same fact, older build).
          const fresh = m.dataFreshness || (m.evidence && m.evidence[0] && m.evidence[0].provenance) || '';
          return (
            <div className={`msg ${m.role === 'bot' ? 'is-assistant' : 'is-user'}`} key={i}>
              {m.live && <div className="mono sub">{t(lang, 'liveNote')}</div>}
              {/* Verdict first: the answer's trustworthiness should land before
                  the prose does. */}
              {view && <VerdictBanner lang={lang} view={view} />}
              <div className="bubble">
                {m.role === 'bot' && m.structured ? (
                  <div className="evbox">
                    <div className="evrow"><span className="k">temp</span><span>{m.structured.temperature ?? '–'}°C · {m.structured.condition || '—'}</span></div>
                    <div className="evrow"><span className="k">rain</span><span>{m.structured.rainfall ?? '–'} mm · wind {m.structured.wind_speed ?? '–'} km/h</span></div>
                    <div className="evrow">
                      <span className="k">{t(lang, 'freshness')}</span>
                      <span>
                        {m.cachedAge != null ? `${m.cachedAge}m` : ''}
                        {m.stale ? ` · ${t(lang, 'staleTag')}` : ''} <ProvBadge value="CACHED" />
                      </span>
                    </div>
                  </div>
                ) : (m.role === 'bot' ? <RichText text={m.text} /> : m.text)}
              </div>
              {m.fallback && <span className="mono sub">AI OFFLINE</span>}
              {m.role === 'bot' && (
                <div className="msg-meta">
                  {fresh && (<><span>{t(lang, 'freshness')}</span><ProvBadge value={fresh} /></>)}
                  {m.ms != null && <span className="mono">{(m.ms / 1000).toFixed(1)}s</span>}
                  {/* B4: the queued state in plain words — never a bare machine
                      chip. The query is already in localStorage via
                      queueQuery and replays on reconnect. */}
                  {m.queued ? <span className="warn-chip">{t(lang, 'queuedWaiting')}</span> : null}
                  {m.text && (
                    <button
                      type="button" className="speak-btn" aria-label={t(lang, 'replay')}
                      title={t(lang, 'replay')} onClick={() => speak(sanitizeForTTS(m.text))}
                    >
                      <Icon name="speaker" size={14} /> {t(lang, 'replay')}
                    </button>
                  )}
                </div>
              )}
              {m.role === 'bot' && m.evidence && m.evidence.length > 0 && (
                <div className="evbox" style={{ maxWidth: 'min(640px, 100%)' }}>
                  <div className="bc-head" style={{ marginBottom: 6 }}>
                    <span className="kicker"><Icon name="database" size={14} /> {t(lang, 'factsTitle')}</span>
                  </div>
                  <div className="chip-row" style={{ marginBottom: 8 }}>
                    {m.evidence.map((e, k) => {
                      const meta = typeMeta(e.type);
                      return (
                        <span className="chip" key={k} title={`${e.type || ''} · ${e.source || ''}`}>
                          <Icon name={meta.icon} size={14} />
                          <span>{t(lang, meta.key)} · {e.source}</span>
                          <ProvBadge value={e.provenance} />
                        </span>
                      );
                    })}
                  </div>
                  <details>
                    <summary className="mono"><Icon name="eye" size={14} /> {t(lang, 'why')}</summary>
                    {m.evidence.map((e, k) => (
                      <div className="evrow" key={k}>
                        <span className="k">{t(lang, typeMeta(e.type).key)} · {e.source} · {e.type}</span>
                        <span>
                          {e.issued_at ? `${t(lang, 'evIssued')} ${stamp(e.issued_at)}` : ''}
                          {e.valid_until ? ` · ${t(lang, 'evValidTo')} ${stamp(e.valid_until)}` : ''}
                          {' '}<ProvBadge value={e.provenance} />
                        </span>
                      </div>
                    ))}
                    {fresh && (
                      <div className="evrow">
                        <span className="k">{t(lang, 'freshness')}</span>
                        <span><ProvBadge value={fresh} /></span>
                      </div>
                    )}
                    {view && (
                      <div className="evrow">
                        <span className="k">{t(lang, 'verdictTitle')}</span>
                        <span>
                          <span className="sev-stamp" data-sev={view.level}>{view.level}</span>
                          {view.basis ? ` · ${view.basis}` : ''}
                        </span>
                      </div>
                    )}
                    {view && view.severity && (
                      <div className="evrow">
                        <span className="k">{t(lang, 'verdictOfficial')}</span>
                        <span className="sev-stamp" data-sev={view.severity}>{view.severity}</span>
                      </div>
                    )}
                    {view && view.nearby > 0 && (
                      <div className="evrow">
                        <span className="k">{t(lang, 'nearby')}</span>
                        <span>{view.nearby}</span>
                      </div>
                    )}
                    {m.risk && m.risk.level && (
                      <div className="evrow">
                        <span className="k">{t(lang, 'riskNote')}</span>
                        <span>{m.risk.level}{m.risk.reason ? ` · ${m.risk.reason}` : ''}</span>
                      </div>
                    )}
                    <div className="evrow">
                      <span className="k">{t(lang, 'aiRole')}</span>
                      <span>{t(lang, 'aiRoleValue')}</span>
                    </div>
                    {view && view.detail && <p className="sub">{view.detail}</p>}
                  </details>
                </div>
              )}
            </div>
          );
        })}
        {/* Thinking dots come AFTER the question they answer — never above it. */}
        {busy && log.length > 0 && log[log.length - 1].role === 'user' && (
          <div className="msg is-assistant" aria-live="polite">
            <div className="bubble"><span className="mono" aria-label={t(lang, 'voiceWorking')}>···</span></div>
          </div>
        )}
      </div>

      <form className="composer" data-tour="chatbox" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <button
          className={`mic-btn${dictation.listening ? ' is-live' : ''}`} type="button" onClick={dictation.listen}
          data-tour="mic"
          disabled={dictation.busy || dictation.unavailable}
          aria-pressed={dictation.listening} aria-label={t(lang, 'listen')}
          title={dictation.unavailable ? t(lang, 'voiceOffline') : t(lang, 'micHint')}
        >
          <Icon name="mic" size={22} />
          <span className="sr-only">
            {dictation.listening ? `${dictation.elapsed}s` : t(lang, 'listen')}
          </span>
        </button>
        <input
          className="input"
          type="text"
          placeholder={t(lang, 'askPh')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label={t(lang, 'askPh')}
        />
        <button className="btn" type="submit" disabled={busy} aria-label={t(lang, 'send')}>
          <Icon name="send" size={18} />{busy ? '···' : t(lang, 'send')}
        </button>
      </form>
      {dictation.note && <p className="mono sub">{dictation.note}</p>}
      <div className="suggestions">
        {SUGGESTIONS.map((k) => (
          <button key={k} type="button" className="chip" onClick={() => ask(t(lang, k))} disabled={busy}>
            {t(lang, k)}
          </button>
        ))}
      </div>
    </section>
  );
}
