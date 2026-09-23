// VoiceMode — the hands-free voice loop overlay (Workstream D, 2026-09-23).
//
// Dictation today is one-shot: mic → text box → the user taps send. Voice
// mode closes the loop: STT → ask → TTS answer → auto-listen again, until
// the user taps Stop or presses Escape.
//
// The ask path is the SAME one HomeChat uses: the injected onAsk contract
// when present, otherwise the default backend call — body
// { message, latitude, longitude, language, user_type } over
// apiClient.chatStream with an apiClient.chat fallback (see HomeChat ask()).
// Loc/lang/persona context is carried exactly as HomeChat builds it.
//
// Safety:
// - Never auto-loops on error: an STT error or an empty transcript parks on
//   a "couldn't hear" state that re-listens only on a user tap.
// - One Stop control is always visible; Escape closes the overlay.
// - Sound-off (the store's wgpt.sound contract) is respected: answers show
//   as text and the loop does not auto-continue.
// - Offline: explains it cannot fetch answers and offers nothing fake.
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { api as defaultApi } from '../api';
import { useVoiceInput } from '../useVoiceInput';
import { sanitizeForTTS } from '../chatText';
import Icon from './icons';
import './VoiceMode.css';

// Phases: idle → listening → thinking → speaking → listening …
// 'error' parks on "couldn't hear" (re-listen only on tap).
// 'offline' and 'soundoff' are informational, never auto-looping.

// The store's sound-off contract (store.jsx speak()): localStorage
// 'wgpt.sound' === '0' means user-muted sound. VoiceMode reads the same
// setting so its loop obeys the toggle.
const isSoundOff = () => {
  try { return localStorage.getItem('wgpt.sound') === '0'; } catch { return false; }
};

export default function VoiceMode({
  lang = 'en',
  persona = null,
  loc = null,
  netState = 'live',
  onAsk = null,
  api = null,
  speak = () => {},
  stopSpeaking = () => {},
  speechState = 'idle',
  onClose = () => {},
}) {
  const [phase, setPhase] = useState(netState === 'live' ? 'idle' : 'offline');
  const [heardText, setHeardText] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [errKey, setErrKey] = useState('vmNoHear');
  const activeRef = useRef(false);
  const abortRef = useRef(null);
  const voiceRef = useRef(null);

  const apiClient = api || defaultApi;

  // The answer fetch — the same ask path HomeChat uses (see its ask()):
  // injected onAsk keeps the non-streaming contract; the default backend call
  // streams tokens via chatStream, falling back to the non-streaming chat
  // endpoint exactly as HomeChat does when the stream fails to produce.
  const runAsk = useCallback(async (q) => {
    if (netState !== 'live') { setPhase('offline'); return; }
    setPhase('thinking');
    setAnswerText('');
    // Built exactly like HomeChat's ask(): loc/lang/persona context, same
    // field names, same user_type default.
    const body = {
      message: q,
      latitude: loc && loc.lat,
      longitude: loc && loc.lon,
      language: lang,
      user_type: persona || 'general',
    };
    const aborter = new AbortController();
    abortRef.current = aborter;
    let fullText = '';
    let failed = false;
    try {
      if (onAsk) {
        // Injected ask (tests/embeds): the original non-streaming contract.
        const r = await onAsk(q);
        fullText = (r && r.answer) || '';
      } else {
        // Default backend call: token streaming. Tokens accumulate; the final
        // event wins. On a failed/empty stream, fall back to chat() — the
        // same two-step shape HomeChat's ask() uses.
        let streamed = '';
        let streamFailed = false;
        try {
          for await (const ev of apiClient.chatStream(body, { signal: aborter.signal })) {
            if (!activeRef.current) return;
            if (ev && ev.type === 'token' && ev.text) streamed += ev.text;
            else if (ev && ev.type === 'final') streamed = ev.answer || '';
          }
        } catch (e) {
          streamFailed = !(e && e.name === 'AbortError');
        }
        if (streamed) {
          fullText = streamed;
        } else if (streamFailed) {
          try {
            const r = await apiClient.chat(body);
            fullText = (r && r.answer) || '';
          } catch { failed = true; }
        } else {
          failed = true; // aborted or empty stream with no failure detail
        }
      }
    } catch {
      failed = true;
    }
    abortRef.current = null;
    if (!activeRef.current) return;
    if (failed || !fullText.trim()) {
      // A fetch failure is stated, never faked and never auto-looped.
      setAnswerText('');
      setErrKey('vmError');
      setPhase('error');
      return;
    }
    setAnswerText(fullText);
    if (isSoundOff()) {
      // Sound-off: show the answer as text, no auto-loop.
      setPhase('soundoff');
      return;
    }
    setPhase('speaking');
    speak(sanitizeForTTS(fullText));
  }, [netState, onAsk, apiClient, loc, lang, persona, speak]);

  const handleFinal = useCallback((text) => {
    if (!activeRef.current) return;
    const q = (text || '').trim();
    if (!q) {
      // Empty transcript: never auto-loop — park on "couldn't hear".
      setErrKey('vmNoHear');
      setPhase('error');
      return;
    }
    setHeardText(text);
    void runAsk(q);
  }, [runAsk]);

  const handlePartial = useCallback((interim) => {
    setHeardText(interim || '');
  }, []);

  const voice = useVoiceInput(lang, handleFinal, handlePartial);
  // Published to the ref from an effect (never during render): the hook's
  // listen() identity changes every render, and startListen is called from
  // handlers/effects where this ref is always fresh.
  useEffect(() => { voiceRef.current = voice; }, [voice]);

  // Start (or continue) one listening turn. voiceRef is used because the
  // hook's listen() identity changes every render.
  const startListen = useCallback(() => {
    if (!activeRef.current) return;
    if (netState !== 'live') { setPhase('offline'); return; }
    setHeardText('');
    setAnswerText('');
    setPhase('listening');
    voiceRef.current.listen();
  }, [netState]);

  const start = useCallback(() => {
    activeRef.current = true;
    startListen();
  }, [startListen]);

  // Single Stop control: halts the loop, stops any TTS and any in-flight
  // turn, and closes the overlay.
  const handleStop = useCallback(() => {
    activeRef.current = false;
    try { if (voiceRef.current && voiceRef.current.listening) voiceRef.current.listen(); } catch { /* idle */ }
    try { if (abortRef.current) abortRef.current.abort(); } catch { /* idle */ }
    stopSpeaking();
    onClose();
  }, [stopSpeaking, onClose]);

  // Escape closes the overlay (same path as Stop).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleStop(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleStop]);

  // Unmount can never strand the loop: no auto-listen, no TTS, no fetch.
  useEffect(() => () => {
    activeRef.current = false;
    try { if (abortRef.current) abortRef.current.abort(); } catch { /* idle */ }
    try { stopSpeaking(); } catch { /* idle */ }
  }, [stopSpeaking]);

  // STT failure or empty transcript: the hook surfaces a note + errorCode and
  // returns to idle. Derived during render — never an auto-loop: the overlay
  // shows "couldn't hear" and re-listens only on a user tap. handleFinal
  // always moves phase off 'listening' in the same batch as the hook's
  // state updates, so a 'listening' phase with a hook note on the next
  // render can only be a failure.
  const sttFailed = phase === 'listening' && voice.state === 'idle'
    && (voice.errorCode !== '' || voice.note !== '');
  const shownPhase = sttFailed ? 'error' : phase;
  const shownErrKey = sttFailed
    ? (voice.note === t(lang, 'homeNoHear') ? 'vmNoHear' : 'vmError')
    : errKey;

  // The hands-free loop: when the spoken answer finishes (speechState back to
  // idle) and we are still the active speaker, listen for the next question.
  // speak() flips the store to 'loading' synchronously before the first
  // network await, so this cannot fire on the turn it started. This effect
  // syncs the external TTS-store state into the loop — the one place the
  // loop legitimately continues on its own.
  useEffect(() => {
    if (phase !== 'speaking') return;
    if (speechState === 'idle') startListen();
  }, [phase, speechState, startListen]);

  const statusKey = shownPhase === 'idle' ? 'vmTapToStart'
    : shownPhase === 'listening' ? 'vmListening'
    : shownPhase === 'thinking' ? 'vmThinking'
    : shownPhase === 'speaking' ? 'vmSpeaking'
    : shownPhase === 'offline' ? 'vmOffline'
    : shownPhase === 'soundoff' ? 'vmSoundOff'
    : shownErrKey; // 'error'

  return (
    <div className="vm-overlay" role="dialog" aria-modal="true" aria-label={t(lang, 'vmTitle')}>
      <div className="vm-card">
        <header className="vm-head">
          <h2 className="vm-title">{t(lang, 'vmTitle')}</h2>
          <button type="button" className="vm-iconbtn" onClick={handleStop} aria-label={t(lang, 'vmClose')}>
            <Icon name="close" size={20} />
          </button>
        </header>

        <div className={`vm-mic is-${shownPhase}`} aria-hidden="true">
          <span className="vm-mic-ring" />
          <Icon name="mic" size={44} className="vm-mic-icon" />
        </div>

        <p className="vm-status" role="status" aria-live="polite">{t(lang, statusKey)}</p>

        {heardText && (
          <p className="vm-transcript" aria-live="polite">{heardText}</p>
        )}

        {answerText && (
          <div className="vm-answer">
            <span className="vm-answer-label">
              <Icon name="speaker" size={16} />
              {t(lang, 'vmAnswerLabel')}
            </span>
            <p className="vm-answer-text">{answerText}</p>
          </div>
        )}

        {(shownPhase === 'idle' || shownPhase === 'listening') && (
          <p className="vm-hint">{t(lang, 'vmHint')}</p>
        )}

        <div className="vm-controls">
          {shownPhase === 'idle' && (
            <button type="button" className="vm-primary" onClick={start}>
              <Icon name="mic" size={20} />
              {t(lang, 'vmTapToStart')}
            </button>
          )}
          {shownPhase === 'error' && (
            <button type="button" className="vm-primary" onClick={start}>
              <Icon name="mic" size={20} />
              {t(lang, 'vmTapToRetry')}
            </button>
          )}
          {shownPhase === 'soundoff' && (
            <button type="button" className="vm-primary" onClick={start}>
              <Icon name="mic" size={20} />
              {t(lang, 'vmContinue')}
            </button>
          )}
          <button type="button" className="vm-stop" onClick={handleStop}>
            <Icon name="stop" size={18} />
            {t(lang, 'vmStop')}
          </button>
        </div>
      </div>
    </div>
  );
}
