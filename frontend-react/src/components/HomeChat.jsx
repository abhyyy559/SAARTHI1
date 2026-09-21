// HomeChat — the Home-screen chat board. Ask merges into Home; there is no
// ask route, and this component never references one.
//
// ChatGPT/Gemini-style conversation, Harbour Signal dressed. Facts-only: this
// component never renders guidance — the escape to guidance is the
// onOpenAdvisory prop (the facts strip popover and the Open My advice
// buttons), which Agent 4 wires to the advisory view.
//
// Everything is injectable: onAsk(q) -> Promise<answer> carries the backend
// call, speak/stopSpeaking/speechState carry TTS, netState carries
// connectivity. Default fallbacks keep it runnable standalone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t, PERSONA_LABELS, PERSONA_QUESTIONS } from '../i18n';
import { api as defaultApi } from '../api';
import { useApp } from '../store';
import { queueQuery, readQueue, clearQueue, answerOffline } from '../offline';
import { useVoiceInput } from '../useVoiceInput';
import Icon from './icons';
import { sanitizeForTTS } from '../chatText';
import ChatMessage from './ChatMessage';
import './HomeChat.css';

// Streaming reveal: characters added per tick. A cheap phone animates
// transform/opacity only — here we just grow text, no layout thrash.
const STREAM_TICK_MS = 24;
const STREAM_CHARS_PER_TICK = 48;

export default function HomeChat({
  lang = 'en',
  persona = null,
  loc = null,
  onAsk = null,
  speak = () => {},
  stopSpeaking = () => {},
  speechState = 'idle',
  netState = 'live',
  api = null,
  onOpenAdvisory = () => {},
  // Optional: reports the mic phase ('idle' | 'permission' | 'recording' |
  // 'processing') so the app shell can show the global Listening popup.
  onVoiceState = () => {},
}) {
  const [log, setLog] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const [streamId, setStreamId] = useState(null);
  const [shown, setShown] = useState(0);
  // True token streaming (default backend path): the id of the bot message
  // currently receiving tokens. Unlike the typewriter `streamId` reveal (used
  // only for the injected-onAsk path), a live message grows as tokens arrive —
  // revealChars stays Infinity and the caret shows via `streaming`.
  const [liveId, setLiveId] = useState(null);
  // "Generating…" shows while busy AND no token has arrived yet; the moment
  // the first token streams in, the living answer replaces the indicator.
  const [streamTextStarted, setStreamTextStarted] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const popRef = useRef(null);
  const idRef = useRef(1);
  const nextId = () => idRef.current++;
  const apiClient = api || defaultApi;
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    []
  );
  // --- Voice-UX states (Crew B, voice-first rebuild) ---------------------------
  // Streaming STT: the hook's third arg (onPartial) fires with interim
  // words while the user is still speaking — they land LIVE in the input box,
  // no need to stop talking. The finalized text replaces the interim via
  // handleVoiceFinal and sits ready to send (never auto-sent).
  const handleVoicePartial = useCallback((interim) => { setInput(interim); }, []);
  const handleVoiceFinal = useCallback((text) => { setInput(text); }, []);
  // Mic-initiated turns: the mic press marks the turn so its answer
  // auto-plays TTS on arrival; typed turns stay tap-to-play. Consumed once
  // per send inside ask(); manual edits re-classify as a typed turn.
  const voiceTurnRef = useRef(false);
  // Abort the in-flight LLM stream when a new turn starts or this component
  // unmounts (navigation mid-generation). Without this the fetch and the
  // backend generation keep running for a dead view — wasted work per
  // abandoned turn.
  const streamAbortRef = useRef(null);

  const dictation = useVoiceInput(lang, handleVoiceFinal, handleVoicePartial);

  // The store's ask()/pendingAsk one-shot hand-off, owned by this component.
  // (Effects are registered after `ask` is defined, below.)

  // Mirror the mic phase to the shell for the global Listening popup.
  // Cleanup resets to idle so an unmount can never strand the popup.
  useEffect(() => {
    onVoiceState(dictation.state);
    return () => onVoiceState('idle');
  }, [dictation.state, onVoiceState]);

  // The injected ask, or the default backend call. The answer object follows
  // the /chat contract: { answer, evidence, risk, warning, verdict,
  // data_freshness, structured_fallback }.
  // speakFor is the single TTS entry point: tap-to-play on the speaker icon
  // (handleListen) and auto-play for mic-initiated turns (ask) both funnel
  // through it, so the injected store speak (chunked TTS) is the only
  // voice out. Chunking itself stays Crew C's — never duplicated here.
  const speakFor = useCallback((m) => {
    stopSpeaking();
    setSpeakingId(m.id);
    speak(sanitizeForTTS(m.text));
  }, [stopSpeaking, speak]);

  // (doAsk was folded into ask(): the injected onAsk keeps the non-streaming
  // contract; the default backend call streams tokens via apiClient.chatStream.)

  const enqueueOffline = useCallback((q) => {
    const n = queueQuery({
      text: q, lang, persona, lat: loc && loc.lat, lon: loc && loc.lon, district: loc && loc.district,
    });
    setLog((l) => [...l, {
      role: 'bot',
      text: answerOffline(q, lang),
      evidence: [],
      verdict: { level: 'UNKNOWN', confirmed: false, basis: 'unavailable' },
      queued: n,
      id: nextId(),
    }]);
  }, [lang, persona, loc]);

  const ask = useCallback(async (text, opts = {}) => {
    const q = (typeof text === 'string' && text ? text : input).trim();
    if (!q || busy) return;
    // Voice-UX turn classification: a mic-initiated turn auto-plays TTS on
    // the answer (spec §4); typed turns stay tap-to-play. The marker is
    // consumed here so every send re-decides the next turn.
    const voiceTurn = opts.voice === true || voiceTurnRef.current;
    voiceTurnRef.current = false;
    setInput('');
    setBusy(true);
    setStreamTextStarted(false);
    setLog((l) => [...l, { role: 'user', text: q, id: nextId() }]);
    if (netState !== 'live') {
      // Offline (§9): the question appears immediately with an honest queued
      // chip and replays on reconnect. Never a silent send.
      enqueueOffline(q);
      setBusy(false);
      return;
    }
    const body = {
      message: q,
      latitude: loc && loc.lat,
      longitude: loc && loc.lon,
      language: lang,
      user_type: persona || 'general',
    };
    const addBotFromResponse = (r) => {
      const bot = {
        role: 'bot',
        text: r.answer || '',
        evidence: r.evidence || [],
        risk: r.risk,
        warning: r.warning,
        verdict: r.verdict,
        fallback: !!r.structured_fallback,
        modelError: r.model_error || '',
        live: !!opts.live,
        id: nextId(),
      };
      setLog((l) => [...l, bot]);
      // Auto-play TTS for mic-initiated turns only — the speaker icon on
      // every bot message keeps tap-to-play for everything else.
      if (voiceTurn && bot.text) speakFor(bot);
      // Typewriter reveal — progressively, unless reduced motion is set.
      setShown(0);
      setStreamId(bot.id);
    };
    if (onAsk) {
      // Injected ask (tests/embeds): the original non-streaming contract.
      try {
        addBotFromResponse(await onAsk(q));
      } catch {
        enqueueOffline(q);
      }
      setBusy(false);
      return;
    }
    // Default backend call: TRUE token streaming. The bot shell lands instantly
    // with the live caret; "Generating…" shows only until the first token
    // arrives, then tokens stream in as the model produces them.
    const botId = nextId();
    setLog((l) => [...l, { role: 'bot', text: '', evidence: [], id: botId, fallback: false, live: !!opts.live }]);
    setLiveId(botId);
    // A new turn supersedes any still-running stream from a previous turn.
    if (streamAbortRef.current) { try { streamAbortRef.current.abort(); } catch { /* ignore */ } }
    const aborter = new AbortController();
    streamAbortRef.current = aborter;
    let fullText = '';
    let streamFailed = false;
    try {
      for await (const ev of apiClient.chatStream(body, { signal: aborter.signal })) {
        if (ev.type === 'meta') {
          setLog((l) => l.map((m) => (m.id === botId
            ? { ...m, evidence: ev.evidence || [], risk: ev.risk, warning: ev.warning, verdict: ev.verdict }
            : m)));
        } else if (ev.type === 'token' && ev.text) {
          fullText += ev.text;
          const t = fullText;
          setStreamTextStarted(true);
          setLog((l) => l.map((m) => (m.id === botId ? { ...m, text: t } : m)));
        } else if (ev.type === 'final') {
          fullText = ev.answer || '';
          const t = fullText;
          const fb = !!ev.structured_fallback;
          setLog((l) => l.map((m) => (m.id === botId ? { ...m, text: t, fallback: fb } : m)));
        } else if (ev.type === 'done') {
          const fb = !!ev.structured_fallback;
          setLog((l) => l.map((m) => (m.id === botId
            ? { ...m, fallback: m.fallback || fb, modelError: ev.model_error || m.modelError }
            : m)));
        }
      }
    } catch (e) {
      // An aborted stream (new turn / unmount) is a deliberate stop, not a
      // failure: never fall back or queue for a turn the user walked away from.
      streamFailed = !(e && e.name === 'AbortError');
    }
    setLiveId(null);
    setBusy(false);
    if (streamFailed && !fullText) {
      // The stream never produced anything: fall back to the non-streaming
      // endpoint (the pre-streaming behavior), then to the offline queue.
      // Hold busy through the fallback so the input stays locked and the
      // Generating… indicator keeps the turn visibly alive.
      setBusy(true);
      setLog((l) => l.filter((m) => m.id !== botId));
      try {
        addBotFromResponse(await apiClient.chat(body));
      } catch {
        enqueueOffline(q);
      }
      setBusy(false);
      return;
    }
    if (streamFailed) {
      // Partial stream: keep what arrived, honestly flagged as fallback.
      setLog((l) => l.map((m) => (m.id === botId ? { ...m, fallback: true } : m)));
    }
    if (voiceTurn && fullText) speakFor({ id: botId, text: fullText });
  }, [input, busy, netState, onAsk, apiClient, loc, lang, persona, enqueueOffline, speakFor]);

  // The store's ask()/pendingAsk one-shot hand-off, owned by this component:
  // - registerAsk publishes this chat's submit so any mounted caller (e.g.
  //   HomeHero's "ask about this") can submit a question directly.
  // - a pending question set just before navigating home (Advisor's "ask
  //   about this") is consumed once on mount, then cleared. Without this the
  //   buttons silently did nothing — the question never reached the chat.
  const { registerAsk, pendingAskRef, setView } = useApp();
  useEffect(() => {
    registerAsk(ask);
    return () => registerAsk(null);
  }, [ask, registerAsk]);
  // Abort any in-flight stream on unmount so navigation can't leak the fetch
  // or keep the backend generating for a dead view.
  useEffect(() => () => {
    if (streamAbortRef.current) { try { streamAbortRef.current.abort(); } catch { /* ignore */ } }
  }, []);
  useEffect(() => {
    const pending = pendingAskRef.current;
    if (pending) {
      pendingAskRef.current = null;
      ask(pending);
    }
    // One-shot on mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Streaming effect: grow the newest bot answer until fully revealed.
  useEffect(() => {
    if (streamId == null) return undefined;
    const msg = log.find((m) => m.id === streamId);
    if (!msg || !msg.text) { setStreamId(null); return undefined; }
    if (reducedMotion) { setShown(msg.text.length); setStreamId(null); return undefined; }
    const iv = setInterval(() => {
      setShown((s) => {
        const next = s + STREAM_CHARS_PER_TICK;
        if (next >= sanitizeForTTS(msg.text, Number.MAX_SAFE_INTEGER).length) {
          clearInterval(iv);
          setStreamId(null);
          return sanitizeForTTS(msg.text, Number.MAX_SAFE_INTEGER).length;
        }
        return next;
      });
    }, STREAM_TICK_MS);
    return () => clearInterval(iv);
  }, [streamId, log, reducedMotion]);

  // Replay queued queries once on reconnect, oldest first.
  useEffect(() => {
    if (netState !== 'live') return undefined;
    const q = readQueue();
    if (!q.length) return undefined;
    clearQueue();
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

  // Keep the latest message and the thinking dots in view.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [log, busy, reducedMotion]);

  // Escape popover: keep it inside the viewport. CSS anchors it to the
  // strip's inline end (max-width 86vw) so it can never cross the right
  // edge; this clamp keeps its left edge on screen at narrow widths.
  useEffect(() => {
    if (!popOpen) return undefined;
    const clamp = () => {
      const el = popRef.current;
      if (!el) return;
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      const under = 8 - r.left;
      const over = r.right - (window.innerWidth - 8);
      let dx = 0;
      if (under > 0) dx = under;
      else if (over > 0) dx = -over;
      if (dx) el.style.transform = `translateX(${dx}px)`;
    };
    clamp();
    window.addEventListener('resize', clamp);
    const onKey = (e) => { if (e.key === 'Escape') setPopOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', clamp);
      window.removeEventListener('keydown', onKey);
    };
  }, [popOpen]);

  // Mic press marks the turn as voice-initiated (auto-play on answer) and
  // toggles the hook's recording. Manual edits below re-classify as typed.
  const handleMicPress = useCallback(() => {
    voiceTurnRef.current = true;
    dictation.listen();
  }, [dictation]);

  const handleStop = useCallback(() => {
    stopSpeaking();
    setSpeakingId(null);
  }, [stopSpeaking]);

  // Tap-to-play: the speaker icon on every bot message. Toggles to Stop
  // while that message is speaking.
  const handleListen = useCallback((m) => {
    if (speakingId === m.id && speechState !== 'idle') handleStop();
    else speakFor(m);
  }, [speakingId, speechState, handleStop, speakFor]);

  const handleAskAbout = useCallback((m) => {
    // Facts-only follow-up: prefill the composer with the answer's lead so
    // the user completes the question themselves — nothing is sent silently.
    const lead = sanitizeForTTS(m.text, Number.MAX_SAFE_INTEGER).split(/\s+/).slice(0, 10).join(' ');
    setInput(lead ? `${lead} … ` : '');
    inputRef.current?.focus();
  }, []);

  const SUGGESTIONS = PERSONA_QUESTIONS[persona] || PERSONA_QUESTIONS.general;
  const personaLabel = persona ? ((PERSONA_LABELS[lang] && PERSONA_LABELS[lang][persona]) || persona) : t(lang, 'roleNotSet');

  // Mic denied: machine-readable flag from useVoiceInput (Crew C), with the
  // localized 'homeNoMic' note as fallback for older hook shapes.
  const micBlocked = dictation.state === 'idle' && (dictation.denied === true || dictation.note === t(lang, 'homeNoMic'));

  return (
    // Ask is the hero of Home (2026-09-21): the first thing the eye hits and
    // the largest element on the screen. Facts-only strip stays directly under
    // the header — the boundary, stated before the first message. The
    // data-tour="home-chat" hook on the composer is a selector contract with
    // OnboardingTour and must never move.
    <section className="hc is-hero" aria-label={t(lang, 'hcRegion')}>
      <header className="hc-hero-head">
        <span className="hc-hero-badge" aria-hidden="true"><Icon name="chat" size={30} /></span>
        <div className="hc-hero-titles">
          <h1 className="hc-hero-title">{t(lang, 'askHeroTitle')}</h1>
          <p className="hc-hero-sub">{t(lang, 'askHeroSub')}</p>
        </div>
      </header>
      {/* Facts-only strip: the boundary, stated before the first message. */}
      <div className="hc-facts">
        <span className="hc-facts-icon" aria-hidden="true"><Icon name="file" size={20} /></span>
        <div className="hc-facts-text">
          <div className="hc-facts-title">{t(lang, 'hcFactsTitle')}</div>
          <p className="hc-facts-sub">{t(lang, 'hcAs')} <b>{personaLabel}</b></p>
        </div>
        <button
          type="button"
          className="hc-facts-info"
          aria-expanded={popOpen}
          aria-label={t(lang, 'hcFactsMore')}
          onClick={() => setPopOpen((o) => !o)}
        >
          <Icon name="info" size={20} aria-hidden="true" />
        </button>
        {popOpen && (
          <div className="hc-escape-pop" ref={popRef} role="dialog" aria-label={t(lang, 'hcFactsMore')}>
            <p>{t(lang, 'hcFactsBody')}</p>
            <button type="button" className="hc-escape-cta" onClick={() => { setPopOpen(false); onOpenAdvisory(); }}>
              <Icon name="sun" size={16} aria-hidden="true" />
              {t(lang, 'hcFactsEscape')}
            </button>
            <button type="button" className="hc-escape-close" onClick={() => setPopOpen(false)}>
              {t(lang, 'hcFactsClose')}
            </button>
          </div>
        )}
      </div>

      {/* Facts-only card, rebuilt as icon-led rows with hierarchy. */}
      <div className="hc-facts-card">
        <div className="hc-facts-row">
          <span className="hc-facts-icon" aria-hidden="true"><Icon name="shield" size={20} /></span>
          <div className="hc-facts-row-body">
            <div className="hc-facts-row-title">{t(lang, 'hcFactsTitle')}</div>
            <p className="hc-facts-row-text">{t(lang, 'hcFactsBody')}</p>
          </div>
        </div>
        <div className="hc-facts-row">
          <span className="hc-facts-icon" aria-hidden="true"><Icon name="database" size={20} /></span>
          <div className="hc-facts-row-body">
            <div className="hc-facts-row-title">{t(lang, 'hcBasedOn')}</div>
            <p className="hc-facts-row-text">{t(lang, 'factsTitle')}</p>
          </div>
        </div>
        <div className="hc-facts-row">
          <span className="hc-facts-icon" aria-hidden="true"><Icon name="sun" size={20} /></span>
          <div className="hc-facts-row-body">
            <div className="hc-facts-row-title">{t(lang, 'hcFactsEscape')}</div>
          </div>
          <button type="button" className="hc-facts-row-cta" onClick={onOpenAdvisory}>
            {t(lang, 'hcOpenAdvisory')}
          </button>
        </div>
      </div>

      <div className="hc-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
        {log.length === 0 && !busy && (
          <p className="hc-facts-sub">{t(lang, 'hcEmptyLine')}</p>
        )}
        {log.map((m) => (
          <div className={`hc-msg ${m.role === 'user' ? 'is-user' : 'is-bot'}`} key={m.id}>
            {m.role === 'user' ? (
              <div className="hc-bubble">{m.text}</div>
            ) : (
              <ChatMessage
                lang={lang}
                message={m}
                revealChars={m.id === streamId ? shown : Infinity}
                streaming={m.id === streamId || m.id === liveId}
                speaking={speakingId === m.id && speechState !== 'idle'}
                onListen={() => handleListen(m)}
                onAskAbout={() => handleAskAbout(m)}
                onOpenAdvisory={onOpenAdvisory}
              />
            )}
            {/* Queued state in plain words — never a bare machine chip. */}
            {m.queued ? (
              <span className="hc-queued" role="status">
                <Icon name="clock" size={16} aria-hidden="true" />
                <span><b>{t(lang, 'hcQueuedChip')}</b> · {t(lang, 'hcQueuedText')}</span>
              </span>
            ) : null}
            {speakingId === m.id && speechState !== 'idle' && (
              <span className="hc-speaking">
                <Icon name="speaker" size={14} aria-hidden="true" />
                {t(lang, 'hcSpeaking')}
              </span>
            )}
          </div>
        ))}
        {busy && !streamTextStarted && (
          <div className="hc-msg is-bot" aria-live="polite">
            {/* Generating… — a living typing indicator, never a dead blank
                wait. Transform/opacity-only dots, honours reduced motion.
                Hidden the moment the first streamed token arrives: the living
                answer itself is the progress signal from there on. */}
            <div className="hc-bubble hc-typing" aria-label={t(lang, 'hcComposing')}>
              <span className="hc-typing-dot" aria-hidden="true" />
              <span className="hc-typing-dot" aria-hidden="true" />
              <span className="hc-typing-dot" aria-hidden="true" />
              <span className="hc-sr">{t(lang, 'hcComposing')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Voice-UX states: tap the mic → pulsing "Listening..."; pause /
          finalize → "Understanding your text..."; the permission request gets
          its own state too. All three are visually distinct, and each is
          announced to screen readers. */}
      {dictation.state !== 'idle' && (
        <div className={`hc-mic-status is-${dictation.state}`} role="status" aria-live="polite">
          <span className="hc-mic-pulse" aria-hidden="true" />
          <span className="hc-mic-status-text">
            {dictation.state === 'recording'
              ? t(lang, 'hcListening')
              : dictation.state === 'processing'
                ? t(lang, 'hcUnderstanding')
                : t(lang, 'hcMicPermission')}
          </span>
          {dictation.state === 'recording' && (
            <span className="hc-mic-timer" aria-hidden="true">{dictation.elapsed}s</span>
          )}
        </div>
      )}

      {/* Mic denied: kind, honest guidance with a way out — one tap to the
          Settings permissions screen. The raw hook note is suppressed while
          this card shows so the user does not read the same failure twice. */}
      {micBlocked && (
        <div className="hc-mic-blocked" role="alert">
          <span className="hc-mic-blocked-icon" aria-hidden="true"><Icon name="mic" size={20} /></span>
          <div className="hc-mic-blocked-body">
            <b className="hc-mic-blocked-title">{t(lang, 'hcMicBlockedTitle')}</b>
            <p className="hc-mic-blocked-text">{t(lang, 'hcMicBlockedBody')}</p>
          </div>
          <button
            type="button"
            className="hc-mic-blocked-open"
            onClick={() => setView('settings')}
          >
            {t(lang, 'hcMicBlockedOpen')}
          </button>
        </div>
      )}

      <form className="hc-composer" data-tour="home-chat" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <button
          className={`hc-mic${dictation.listening ? ' is-live' : ''}${dictation.state === 'processing' ? ' is-processing' : ''}`}
          type="button"
          onClick={handleMicPress}
          disabled={dictation.busy || dictation.unavailable || busy}
          aria-pressed={dictation.listening}
          aria-label={dictation.listening ? t(lang, 'hcMicStop') : t(lang, 'hcMicHint')}
          title={dictation.unavailable ? t(lang, 'voiceOffline') : t(lang, 'hcMicHint')}
        >
          <Icon name="mic" size={22} aria-hidden="true" />
          <span className="hc-sr">{dictation.listening ? `${dictation.elapsed}s` : t(lang, 'hcMicHint')}</span>
        </button>
        <input
          ref={inputRef}
          type="text"
          placeholder={t(lang, 'hcComposerHint')}
          value={input}
          onChange={(e) => { voiceTurnRef.current = false; setInput(e.target.value); }}
          aria-label={t(lang, 'hcComposerHint')}
          disabled={busy}
          aria-disabled={busy}
        />
        <button className="hc-send" type="submit" disabled={busy} aria-label={t(lang, 'hcSend')}>
          <Icon name="send" size={18} aria-hidden="true" />
          {busy ? '···' : t(lang, 'hcSend')}
        </button>
      </form>
      {dictation.note && !micBlocked && <p className="hc-composer-note">{dictation.note}</p>}

      <div className="hc-chips-label">{t(lang, 'hcSuggestionsHint')}</div>
      <div className="hc-chips-wrap">
        <ul className="hc-chips">
          {SUGGESTIONS.map((k) => (
            <li key={k}>
              <button type="button" className="hc-chip" onClick={() => ask(t(lang, k))} disabled={busy}>
                {t(lang, k)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
