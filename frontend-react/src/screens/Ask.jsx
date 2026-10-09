import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { keys, useApp } from '../lib/appState';
import { useOnline } from '../lib/useData';
import { ago, t } from '../lib/i18n';
import { speak, useMic } from '../lib/voice';
import { sourceLabel, toneOf } from '../lib/weather';
import { Icon } from '../components/Icons';
import { SpeakButton } from '../components/ui';
import { summaryText } from './Today';

const MAX_HISTORY = 40;

const CHIPS = {
  general: [['rain', 'qRain'], ['warning', 'qWarn'], ['heat', 'qHeat']],
  farmer: [['rain', 'qRain'], ['farmer', 'qCrop'], ['warning', 'qWarn']],
  fisherman: [['boat', 'qSea'], ['warning', 'qWarn'], ['wind', 'qRain']],
  driver: [['truck', 'qRoad'], ['warning', 'qWarn'], ['rain', 'qRain']],
};

// Plain text from markdown-ish answers (bold, headings, bullets).
function Answer({ text }) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <div className="answer-text">
      {lines.map((l, i) => {
        const clean = l.replace(/\*\*/g, '').replace(/^#+\s*/, '');
        if (/^#+\s/.test(l)) return <h4 key={i}>{clean}</h4>;
        if (/^[-•]\s/.test(l)) return <p key={i} className="bullet">{clean.replace(/^[-•]\s*/, '')}</p>;
        return <p key={i}>{clean}</p>;
      })}
    </div>
  );
}

// No network: answer from what is saved on the phone, clearly labelled.
function offlineReply(lang, loc) {
  const warn = cache.read(keys.warnings(loc));
  const now = cache.read(keys.current(loc));
  const fc = cache.read(keys.forecast(loc));
  if (!warn && !now) return { text: t(lang, 'nothingSaved'), savedAt: null };
  const body = summaryText(lang, warn?.data?.verdict, now?.data?.current, fc?.data?.forecast?.days);
  const savedAt = Math.min(...[warn, now].filter(Boolean).map((e) => e.savedAt));
  return { text: `${t(lang, 'offlineAnswer')} (${ago(savedAt, lang)})\n${body}`, savedAt };
}

export default function Ask() {
  const { lang, loc, persona, pendingQuestion, clearPending } = useApp();
  const online = useOnline();
  const [msgs, setMsgs] = useState(() => cache.read(keys.chat)?.data || []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const listEnd = useRef(null);
  const abort = useRef(null);
  const screen = useRef(null);
  const composer = useRef(null);

  // The composer is pinned above the tab bar; the thread reserves its exact
  // height so the newest answer (and its Listen button) is never hidden.
  // Opening the screen shows the newest messages once that space is known
  // (this runs after the app's scroll-to-top on every tab change).
  useEffect(() => {
    const el = composer.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let first = true;
    const ro = new ResizeObserver(() => {
      screen.current?.style.setProperty('--composer-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
      if (first) { first = false; listEnd.current?.scrollIntoView({ block: 'end' }); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const persist = (list) => cache.save(keys.chat, list.slice(-MAX_HISTORY));

  useEffect(() => { listEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);
  useEffect(() => () => abort.current?.abort(), []);

  const ask = useCallback(async (question, { spoken = false } = {}) => {
    const q = question.trim();
    if (!q || busy) return;
    const id = Date.now();
    const userMsg = { id, role: 'user', text: q };
    if (!navigator.onLine) {
      const queue = cache.read(keys.queue)?.data || [];
      cache.save(keys.queue, [...queue, { q, lang, persona, loc }].slice(-5));
      const off = offlineReply(lang, loc);
      const reply = { id: id + 1, role: 'bot', text: `${off.text}\n\n${t(lang, 'queued')}`, offline: true, savedAt: off.savedAt };
      setMsgs((m) => { const next = [...m, userMsg, reply]; persist(next); return next; });
      if (spoken) speak(off.text, lang, `msg-${reply.id}`);
      return;
    }
    const botId = id + 1;
    setMsgs((m) => [...m, userMsg, { id: botId, role: 'bot', text: '', pending: true }]);
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let text = '';
    let verdict = null;
    let failed = false;
    let sources = [];
    let ruleBased = false;
    try {
      for await (const ev of api.chatStream({
        message: q, language: lang, user_type: persona, latitude: loc.lat, longitude: loc.lon,
      }, ctrl.signal)) {
        if (ev.type === 'meta') {
          verdict = ev.verdict || null;
          sources = [...new Set([...(verdict?.checked_sources || []), ...(ev.evidence || []).map((e) => e.source)]
            .map(sourceLabel).filter((s) => s && !/^(LIVE|CACHED|DEMO)$/.test(s)))];
        }
        if (ev.type === 'done') ruleBased = !!ev.structured_fallback;
        else if (ev.type === 'token') text += ev.text || '';
        else if (ev.type === 'final') text = ev.answer || text;
        if (ev.type !== 'done') {
          const snap = text;
          setMsgs((m) => m.map((x) => (x.id === botId ? { ...x, text: snap, verdict } : x)));
        }
      }
    } catch {
      failed = true;
    }
    setBusy(false);
    if (failed && !text) {
      const off = offlineReply(lang, loc);
      text = off.text;
    }
    setMsgs((m) => {
      const next = m.map((x) => (x.id === botId ? { ...x, text, verdict, sources, ruleBased, pending: false, offline: failed } : x));
      persist(next);
      return next;
    });
    if (spoken && text) speak(text, lang, `msg-${botId}`);
  }, [busy, lang, loc, persona]);

  // Questions asked offline go out when the network is back.
  useEffect(() => {
    if (!online || busy) return;
    const queue = cache.read(keys.queue)?.data || [];
    if (!queue.length) return;
    cache.remove(keys.queue);
    ask(queue[queue.length - 1].q);
  }, [online, busy, ask]);

  // A question handed over from another screen ("Explain this alert").
  useEffect(() => {
    if (pendingQuestion) { clearPending(); ask(pendingQuestion); }
  }, [pendingQuestion, clearPending, ask]);

  const mic = useMic(lang, (text) => ask(text, { spoken: true }));
  const micLabel = mic.state === 'listening' ? t(lang, 'listening')
    : mic.state === 'working' ? t(lang, 'working')
      : mic.error === 'denied' ? t(lang, 'micDenied')
        : mic.error === 'nomic' ? t(lang, 'micNone')
          : mic.error ? t(lang, 'micFailed') : t(lang, 'askHint');

  return (
    <div className="screen ask" ref={screen}>
      <div className="thread" aria-live="polite">
        {msgs.length === 0 ? (
          <div className="ask-intro">
            <Icon name="chat" size={40} />
            <p>{t(lang, 'askHint')}</p>
          </div>
        ) : null}
        {msgs.map((m) => (m.role === 'user' ? (
          <div key={m.id} className="bubble me"><p>{m.text}</p></div>
        ) : (
          <div key={m.id} className={`bubble bot ${m.verdict ? `edge-${toneOf(m.verdict)}` : ''} ${m.offline ? 'is-offline' : ''}`}>
            {m.pending && !m.text ? <div className="typing"><i /><i /><i /></div> : <Answer text={m.text} />}
            {!m.pending && !m.offline && (m.sources?.length || m.ruleBased) ? (
              <div className="grd">
                <Icon name="shield-ok" size={18} />
                {m.sources?.length ? <span>{t(lang, 'grdBased')}: {m.sources.join(' · ')}</span> : null}
                {m.ruleBased ? <span className="grd-tag">{t(lang, 'grdTemplate')}</span> : null}
                <span className="grd-rule">{t(lang, 'grdRule')}</span>
              </div>
            ) : null}
            {!m.pending ? (
              <div className="bubble-foot">
                {m.offline ? <span className="fresh fresh-saved"><Icon name="offline" size={14} /></span> : null}
                <SpeakButton text={m.text} lang={lang} id={`msg-${m.id}`} />
              </div>
            ) : null}
          </div>
        )))}
        <div ref={listEnd} className="thread-end" />
      </div>

      <div className="composer" ref={composer}>
        <div className="chips">
          {(CHIPS[persona] || CHIPS.general).map(([icon, key]) => (
            <button key={key} type="button" className="chip" disabled={busy} onClick={() => ask(t(lang, key))}>
              <Icon name={icon} size={30} /><span>{t(lang, key)}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`mic mic-${mic.state}`}
          onClick={() => (mic.state === 'error' ? (mic.reset(), mic.start()) : mic.start())}
          disabled={busy || mic.state === 'working'}
          aria-label={micLabel}
        >
          <Icon name={mic.state === 'listening' ? 'stop' : 'mic'} size={44} />
          {mic.state === 'listening' ? <span className="mic-secs">{mic.seconds}s</span> : null}
        </button>
        <p className={`mic-label ${mic.error ? 'is-error' : ''}`}>{micLabel}</p>
        <form className="type-row" onSubmit={(e) => { e.preventDefault(); ask(draft); setDraft(''); }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t(lang, 'typeHere')}
            aria-label={t(lang, 'typeHere')} enterKeyHint="send" />
          <button type="submit" className="send" disabled={!draft.trim() || busy} aria-label={t(lang, 'send')}>
            <Icon name="send" size={22} />
          </button>
        </form>
      </div>
    </div>
  );
}
