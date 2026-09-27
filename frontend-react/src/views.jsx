// SAARTHI v2 views.
import { useState, useEffect, useRef } from 'react';
import { api, HYD } from './api.js';
import { t, tp, useLang } from './i18n.jsx';
import { useApi, useLocalStorage, useNow } from './hooks.js';
import { agoParts, collectAlerts, sourceGroup, sourceDisplayName } from './lib.js';
import {
  I, SevBadge, StatusPill, ProofLine, Skeleton,
  SectionHead, EmptyState, RoleGrid, AlertCard, toast,
} from './components.jsx';

/* ================= HOME — SAARTHI conversational agent ================= */

// Source citations inside an answer — "(source: Open-Meteo)", "(स्रोत: …)",
// "(మూలం: …)" — are rendered distinctly so the grounding is visible, not
// buried in the paragraph. Plain text otherwise.
const CITE_RE = /\((source|स्रोत|మూలం):\s*[^)]+\)/g;
function renderCited(text) {
  if (!text || typeof text !== 'string') return text;
  CITE_RE.lastIndex = 0;
  let m = CITE_RE.exec(text);
  if (!m) return text;
  const out = [];
  let i = 0, k = 0;
  while (m) {
    if (m.index > i) out.push(text.slice(i, m.index));
    out.push(<span key={k++} className="m-cite">{m[0]}</span>);
    i = m.index + m[0].length;
    m = CITE_RE.exec(text);
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

export function HomeView({ loc, go }) {
  const { lang } = useLang();
  const [role] = useLocalStorage('saarthi:role', 'general');
  // Starter questions follow the user's profile (farmer, fisherman, …);
  // unknown values fall back to the general set.
  const chipRole = ['general', 'farmer', 'driver', 'fisherman', 'aviation', 'commuter', 'office'].includes(role) ? role : 'general';
  const wx = useApi(() => api.current(loc.lat, loc.lon, { lang }), [loc.lat, loc.lon, lang]);
  const warn = useApi(() => api.warnings(loc.district || 'Hyderabad', loc.lat, loc.lon), [loc.district, loc.lat, loc.lon]);
  const voice = useApi(() => api.voiceStatus().catch(() => null), []);

  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | recording | transcribing
  const [listening, setListening] = useState(false); // browser SpeechRecognition active
  const recRef = useRef(null);
  const mediaRef = useRef(null);
  const audioRef = useRef(null);
  // speak() generation: bumped by stopSpeak() and by each new speak(), so a
  // superseded in-flight TTS (fetch or queued chunk) can never start playback
  // after the user stopped it or asked for something else.
  const speakSeq = useRef(0);
  const bottomRef = useRef(null);
  const briefSeeded = useRef(false);
  const seedLang = useRef(null);

  const locName = wx.data?.location?.city || loc.city || loc.district;
  const briefReady = !wx.loading && !warn.loading;
  const brief = briefReady ? agentBrief(wx.data, warn.data, locName) : null;

  // The agent opens the conversation itself, with live data — not a static greeting.
  // If the language changes before the user has spoken, the opening brief is
  // re-seeded in the new language; an in-progress conversation is never wiped.
  // The brief carries the same source line as any answer: weather source +
  // the CAP feed when a warning is mentioned.
  useEffect(() => {
    if (!brief) return;
    if (!briefSeeded.current || seedLang.current !== lang) {
      briefSeeded.current = true;
      seedLang.current = lang;
      const ev = [];
      const wsrc = wx.data?.current?.source;
      if (wsrc) ev.push({ source: wsrc });
      const alerts = collectAlerts(warn.data);
      const top = alerts.find((a) => a.active);
      if (top) ev.push({ source: top.source || 'NDMA-Sachet-CAP' });
      setMsgs((xs) => (xs.some((m) => m.role === 'user')
        ? xs
        : [{ role: 'bot', text: brief, brief: true, evidence: ev }]));
    }
  }, [brief, lang]);
  // New location, new conversation.
  useEffect(() => {
    briefSeeded.current = false;
    setMsgs([]);
  }, [loc.lat, loc.lon]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  const sttLive = voice.data?.stt === 'sarvam-live';
  const userSaidSomething = msgs.some((m) => m.role === 'user');
  const push = (m) => setMsgs((xs) => [...xs, m]);

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    stopSpeak();
    setInput('');
    push({ role: 'user', text: q });
    setBusy(true);
    // Backend ChatRequest speaks latitude/longitude — sending lat/lon would be
    // silently dropped by Pydantic and every user would get Hyderabad's weather.
    const body = { message: q, latitude: loc.lat, longitude: loc.lon, district: loc.district, language: lang, user_type: role };
    let evMeta = null;
    const botIdx = { i: -1 };
    let finalSeen = false;
    try {
      let got = false;
      for await (const line of api.chatStream(body)) {
        if (line.type === 'meta' && line.evidence) {
          // Provenance for this turn; attached to the bot message on done.
          evMeta = line.evidence;
        } else if (line.type === 'token' && line.text) {
          got = true;
          if (botIdx.i === -1) {
            setMsgs((xs) => { botIdx.i = xs.length; return [...xs, { role: 'bot', text: '' }]; });
          }
          const txt = line.text;
          setMsgs((xs) => xs.map((m, i) => (i === botIdx.i ? { ...m, text: m.text + txt } : m)));
        } else if (line.type === 'final' && line.answer) {
          got = true;
          finalSeen = true;
          const fin = line.answer;
          setMsgs((xs) => {
            if (botIdx.i === -1) return [...xs, { role: 'bot', text: fin, evidence: evMeta }];
            return xs.map((m, i) => (i === botIdx.i ? { ...m, text: fin, evidence: evMeta || m.evidence } : m));
          });
        } else if (line.type === 'done' && botIdx.i !== -1 && evMeta) {
          setMsgs((xs) => xs.map((m, i) => (i === botIdx.i && !m.evidence ? { ...m, evidence: evMeta } : m)));
        }
      }
      if (!got) throw new Error('empty stream');
    } catch {
      if (finalSeen) {
        // The complete answer already landed via `final`; the break happened
        // after it — nothing to redo.
        return;
      }
      // A mid-stream break after partial tokens would otherwise leave a
      // half-rendered answer above the fallback's complete one — drop it.
      if (botIdx.i !== -1) {
        const drop = botIdx.i;
        setMsgs((xs) => xs.filter((_, i) => i !== drop));
      }
      try {
        const r = await api.chat(body);
        push({ role: 'bot', text: r.answer || t('chatErr'), evidence: r.evidence });
      } catch {
        push({ role: 'bot', text: t('chatErr') });
      }
    } finally {
      setBusy(false);
    }
  }

  function stopRecording() {
    try { mediaRef.current?.stop(); } catch { /* not recording */ }
    mediaRef.current = null;
    try { recRef.current?.stop(); } catch { /* not listening */ }
    setPhase('idle');
    setListening(false);
  }

  async function toggleMic() {
    // Any tap while recording / transcribing / listening stops; it must never
    // start a second recording over an in-flight one.
    if (phase !== 'idle' || listening) { stopRecording(); return; }
    stopSpeak();
    // Server-side STT (Sarvam) when live: record, then upload for transcription.
    // A server failure or empty transcript falls back to on-device recognition
    // rather than dead-ending with a toast.
    if (sttLive && navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
      try {
        setPhase('recording');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream);
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = async () => {
          stream.getTracks().forEach((tr) => tr.stop());
          setPhase('transcribing');
          try {
            const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
            const r = await api.transcribe(blob, lang);
            const txt = (r && r.text ? r.text : '').trim();
            setPhase('idle');
            if (txt) send(txt);
            else startBrowserSR();
          } catch {
            setPhase('idle');
            startBrowserSR();
          }
        };
        mediaRef.current = rec;
        rec.start();
        return;
      } catch { setPhase('idle'); /* fall through to browser speech */ }
    }
    // Browser fallback: on-device speech recognition.
    startBrowserSR();
  }

  function startBrowserSR() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast(t('noMic'), 'warn'); return; }
    try {
      const rec = new SR();
      rec.lang = lang === 'hi' ? 'hi-IN' : lang === 'te' ? 'te-IN' : 'en-IN';
      rec.interimResults = false;
      rec.onresult = (e) => {
        const txt = e.results[0][0].transcript;
        setListening(false);
        if (txt) send(txt);
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch { toast(t('noMic'), 'warn'); }
  }

  function browserSpeak(text) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      // Best-match a device voice for the UI language — setting only
      // utterance.lang can leave Hindi/Telugu read in a wrong-accent default
      // voice. getVoices() may still be empty on first call; then we keep the
      // previous behaviour (lang set, no explicit voice).
      const want = lang === 'hi' ? 'hi' : lang === 'te' ? 'te' : 'en';
      u.lang = want === 'hi' ? 'hi-IN' : want === 'te' ? 'te-IN' : 'en-IN';
      const voices = (speechSynthesis.getVoices && speechSynthesis.getVoices()) || [];
      const match = voices.find((v) => (v.lang || '').toLowerCase().startsWith(want))
        || voices.find((v) => (v.lang || '').toLowerCase().startsWith('en'));
      if (match) u.voice = match;
      speechSynthesis.speak(u);
    } catch { /* no TTS */ }
  }

  function stopSpeak() {
    speakSeq.current++; // invalidate any in-flight speak()
    try { speechSynthesis.cancel(); } catch { /* no TTS */ }
    try { audioRef.current?.pause(); } catch { /* no audio */ }
    audioRef.current = null;
  }

  async function speak(text) {
    stopSpeak();
    const gen = speakSeq.current;
    const alive = () => gen === speakSeq.current;
    // Progressive TTS: play sentence chunks as they arrive instead of waiting
    // for the whole answer. Without a server provider the backend answers with
    // honest browser-fallback JSON and we speak it on-device (never "Sarvam").
    const queue = [];
    let started = false;
    const playNext = () => {
      if (!alive()) return;
      const item = queue.shift();
      if (!item) { started = false; return; }
      started = true;
      const audio = new Audio(`data:${item.mime || 'audio/wav'};base64,${item.audio_base64}`);
      audioRef.current = audio;
      audio.onended = () => { audioRef.current = null; playNext(); };
      audio.onerror = () => { audioRef.current = null; playNext(); };
      audio.play().catch(() => { if (alive()) browserSpeak(text); });
    };
    try {
      for await (const chunk of api.speakStream(text, lang)) {
        if (!alive()) return; // superseded — never play stale audio
        if (chunk.done && chunk.client_speech) { browserSpeak(chunk.text || text); return; }
        if (chunk.audio_base64) { queue.push(chunk); if (!started) playNext(); }
        // Mid-stream provider-failure trailer: queued chunks keep playing;
        // we do NOT speak the text a second time over them.
      }
    } catch {
      if (alive()) browserSpeak(text);
    }
  }

  const voiceLabel = sttLive ? t('voiceSarvam') : t('voiceBrowser');

  return (
    <div className="page agent-page">
      {/* Slim safety banner: proof-of-check stays above the fold. */}
      <section aria-label={t('alertCheck')}>
        {warn.loading ? <Skeleton /> : <AlertStatusCard data={warn.data} onOpen={() => go('alerts')} />}
      </section>

      {/* The agent: identity first — the conversation is the product.
          The weather report is not a headline here; it lives in the
          conversation as SAARTHI's opening message below. */}
      <section className="agent-hero" aria-label="SAARTHI">
        <span className="agent-avatar big" aria-hidden="true"><I.chat /></span>
        <div className="agent-id">
          <h2>SAARTHI</h2>
          <p className="agent-tag">{t('agentTagline')}</p>
          <p className="agent-voice">{t('agentRole')} · {voiceLabel}</p>
        </div>
        <div className="agent-talk">
          <button type="button" className="talk-btn mic" onClick={toggleMic}
            aria-label={phase === 'recording' || listening ? t('micStop') : t('micStart')}
            data-active={phase === 'recording' || listening}
            disabled={busy || phase === 'transcribing'}>
            <I.mic />
          </button>
          {brief ? (
            <button type="button" className="talk-btn" onClick={() => speak(brief)} aria-label={t('listen')}>
              <I.speaker />
            </button>
          ) : null}
        </div>
      </section>

      {/* Starters until the user speaks up — shaped by their profile. */}
      {!userSaidSomething ? (
        <div className="chips" role="group" aria-label={t('askTitle')}>
          {[1, 2, 3].map((i) => {
            const c = t(`chip_${chipRole}_${i}`);
            return (
              <button key={c} type="button" className="chip" onClick={() => send(c)} disabled={busy || !briefReady}>
                {c}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* The conversation. */}
      <div className="chat-log" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {renderCited(m.text)}
            {m.role === 'bot' && m.text ? (
              <span className="m-ev">
                <button type="button" className="link-btn" onClick={() => speak(m.text)} aria-label={t('listen')}>
                  <I.speaker />{t('listen')}
                </button>
                {m.evidence && m.evidence.length ? (
                  <span className="m-src"><b>{t('srcLabel')}</b>{m.evidence.map((e) => e.source).filter(Boolean).join(' · ')}</span>
                ) : null}
              </span>
            ) : null}
          </div>
        ))}
        {busy ? <div className="msg bot"><span className="typing"><i /><i /><i /></span></div> : null}
        <div ref={bottomRef} />
      </div>

      {/* Composer, pinned above the dock. */}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <button type="button" className="icon-btn" onClick={toggleMic}
          aria-label={phase === 'recording' || listening ? t('micStop') : t('micStart')}
          disabled={busy || phase === 'transcribing'}
          style={phase === 'recording' || listening ? { background: 'var(--bad)', borderColor: 'var(--bad)' } : null}>
          <I.mic />
        </button>
        <input name="message" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={phase === 'recording' ? t('recording') : phase === 'transcribing' ? t('transcribing') : t('ph')}
          aria-label={t('ph')} autoComplete="off" maxLength={500}
          disabled={phase === 'recording' || phase === 'transcribing'} />
        <button type="submit" className="send-btn" disabled={busy || !input.trim()} aria-label={t('chatSend')}>
          <I.send />
        </button>
      </form>
    </div>
  );
}

/** The agent's opening brief: today's weather + warning state, in one breath. */
function agentBrief(wxData, warnData, locName) {
  const cur = wxData?.current;
  const parts = [];
  if (cur && cur.temperature != null) {
    parts.push(tp('briefNow', {
      temp: Math.round(cur.temperature),
      cond: String(cur.condition || '').toLowerCase(),
      loc: locName,
    }));
  } else {
    parts.push(t('briefNoData'));
  }
  const alerts = collectAlerts(warnData);
  const active = alerts.filter((a) => a.active);
  const unavailable = warnData?.status === 'unavailable' || warnData?.provenance === 'UNAVAILABLE';
  if (active.length > 0) {
    // A warning for a neighbouring district is context, not this district's
    // warning — say "nearby", never "active", for those.
    const direct = active.find((a) => !a.nearby);
    const top = direct || active[0];
    parts.push(tp(direct ? 'briefWarnActive' : 'briefWarnNearby', {
      sev: String(top.severity || '').toLowerCase(),
      hazard: top.hazard || top.title || '',
    }));
  } else if (unavailable) {
    parts.push(t('briefWarnUnknown'));
  } else {
    parts.push(t('briefWarnClear'));
  }
  return parts.join(' ');
}

function liveCount(sources) {
  return (sources || []).filter((s) => String(s.status).toUpperCase() === 'LIVE').length;
}

function AlertStatusCard({ data, onOpen }) {
  const alerts = collectAlerts(data);
  const active = alerts.filter((a) => a.active);
  const unavailable = data?.status === 'unavailable' || data?.provenance === 'UNAVAILABLE';

  if (unavailable && active.length === 0) {
    return (
      <div className="card">
        <div className="alert-status">
          <span className="as-icon muted"><I.info /></span>
          <div style={{ flex: 1 }}>
            <h3>{t('cannotCheck')}</h3>
            <p className="as-sub">{t('cannotCheckSub')}</p>
          </div>
        </div>
      </div>
    );
  }
  if (active.length > 0) {
    const top = active[0];
    return (
      <button className="card pressable" onClick={onOpen} style={{ width: '100%', textAlign: 'left' }} aria-label={t('viewAlerts')}>
        <div className="alert-status">
          <span className="as-icon warn"><I.alertTri /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3>{active.length === 1 ? t('activeOne') : tp('activeMany', { n: active.length })}</h3>
            <ProofLine at={data?.generated_at} />
            <p className="as-sub">{top.title}</p>
          </div>
          <I.chevR style={{ color: 'var(--ink3)', flex: 'none', alignSelf: 'center' }} />
        </div>
      </button>
    );
  }
  return (
    <button className="card pressable" onClick={onOpen} style={{ width: '100%', textAlign: 'left' }} aria-label={t('viewAlerts')}>
      <div className="alert-status">
        <span className="as-icon ok"><I.shield /></span>
        <div style={{ flex: 1 }}>
          <h3>{t('allClear')}</h3>
          <ProofLine at={data?.generated_at} />
          <p className="as-sub">{t('allClearSub')}</p>
        </div>
        <I.chevR style={{ color: 'var(--ink3)', flex: 'none', alignSelf: 'center' }} />
      </div>
    </button>
  );
}

/* ================= MY ADVICE ================= */
const ADVICE_ROLES = ['general', 'farmer', 'driver', 'fisherman', 'aviation', 'commuter', 'office'];

export function AdviceView({ loc }) {
  const { lang } = useLang();
  const [role, setRole] = useLocalStorage('saarthi:role', 'general');
  const cards = useApi(() => api.advisoryCards(loc, role, lang), [loc.lat, loc.lon, role, lang]);
  const prof = useApi(() => api.profileAdvisory(loc, role, lang), [loc.lat, loc.lon, role, lang]);

  const pick = (r) => {
    setRole(r);
    toast(t('roleSaved'), 'ok');
  };

  return (
    <div className="page">
      <div className="view-head"><h1>{t('adviceTitle')}</h1><p>{t('adviceSub')}</p></div>

      <section aria-label={t('pickRole')}>
        <SectionHead title={t('pickRole')} sub={t('pickRoleSub')} />
        <RoleGrid value={ADVICE_ROLES.includes(role) ? role : 'general'} onPick={pick} />
      </section>

      <section aria-label={t('briefing')}>
        {prof.loading ? <Skeleton kind="lines" /> : prof.error ? (
          <div className="card"><EmptyState icon={I.spark} title={t('loadError')} action={<button className="btn ghost" onClick={prof.reload}>{t('retry')}</button>} /></div>
        ) : prof.data?.advisory ? (
          <div className="card">
            <span className="adv-kind">{t('briefing')} · {t(`role_${role}`)}</span>
            <p style={{ marginTop: 8, fontSize: 'var(--fs-body)' }}>{prof.data.advisory}</p>
            {prof.data.weather_basis?.provenance ? (
              <p className="proof"><I.db />{prof.data.weather_basis.provenance} · {t('imdFirst')}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-label={t('cardsTitle')}>
        <SectionHead title={t('cardsTitle')} sub={t('cardsSub')} />
        {cards.loading ? <><Skeleton /><Skeleton /></> : cards.error ? (
          <div className="card"><EmptyState icon={I.spark} title={t('loadError')} action={<button className="btn ghost" onClick={cards.reload}>{t('retry')}</button>} /></div>
        ) : (cards.data?.cards || []).length === 0 ? (
          <div className="card"><EmptyState icon={I.check} title={t('noCards')} /></div>
        ) : (
          <div className="cols-2">
            {(cards.data.cards || []).map((c) => (
              <article className="card adv-card" key={c.id}>
                <span className="adv-kind">{c.kind}</span>
                <h3>{c.title}</h3>
                <p className="adv-body">{c.body}</p>
                <div className="adv-meta">
                  <SevBadge severity={c.severity_word} />
                  {c.valid_for ? <span className="pill muted"><I.clock />{c.valid_for}</span> : null}
                </div>
                {c.basis && c.basis.length ? (
                  <details className="adv-basis">
                    <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 44, display: 'flex', alignItems: 'center' }}>{t('basis')}</summary>
                    <ul>{c.basis.map((b, i) => <li key={i}>{b}</li>)}</ul>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
export { HYD };

/* ================= ALERTS ================= */
export function AlertsView({ loc }) {
  const { lang } = useLang();
  const [openId, setOpenId] = useState(null);
  const w = useApi(() => api.warnings(loc.district || 'Hyderabad', loc.lat, loc.lon), [loc.district, loc.lat, loc.lon]);

  const alerts = collectAlerts(w.data);
  const active = alerts.filter((a) => a.active);
  const expired = alerts.filter((a) => !a.active);
  const unavailable = w.data && (w.data.status === 'unavailable' || w.data.provenance === 'UNAVAILABLE') && alerts.length === 0;

  return (
    <div className="page">
      <div className="view-head"><h1>{t('alertsTitle')}</h1><p>{t('alertsSub')}</p></div>

      {w.loading ? <><Skeleton /><Skeleton /></> : w.error ? (
        <div className="card"><EmptyState icon={I.alertTri} title={t('loadError')} action={<button className="btn primary" onClick={w.reload}>{t('retry')}</button>} /></div>
      ) : unavailable ? (
        <div className="card">
          <EmptyState icon={I.info} title={t('cannotCheck')} sub={t('cannotCheckSub')}
            action={<button className="btn primary" onClick={w.reload}><I.refresh />{t('recheck')}</button>} />
        </div>
      ) : alerts.length === 0 ? (
        <div className="card">
          <div className="alert-status" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <span className="as-icon ok" style={{ width: 76, height: 76 }}><I.shield /></span>
            <h3 style={{ fontSize: 'var(--fs-h2)' }}>{t('none')}</h3>
            <p className="as-sub">{t('noneSub')}</p>
            <ProofLine at={w.data?.generated_at} />
          </div>
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <section aria-label={t('active')}>
              <SectionHead title={t('active')} sub={active.length === 1 ? t('activeOne') : tp('activeMany', { n: active.length })} />
              <div className="cols-2">
                {active.map((a) => (
                  <AlertCard key={a.id} alert={a} lang={lang}
                    open={openId === a.id}
                    onToggle={() => setOpenId(openId === a.id ? null : a.id)} />
                ))}
              </div>
            </section>
          ) : (
            <div className="card">
              <div className="alert-status">
                <span className="as-icon ok"><I.shield /></span>
                <div><h3>{t('none')}</h3><p className="as-sub">{t('noneSub')}</p><ProofLine at={w.data?.generated_at} /></div>
              </div>
            </div>
          )}
          {expired.length > 0 ? (
            <section aria-label={t('expired')}>
              <SectionHead title={t('expired')} />
              <div className="cols-2">
                {expired.map((a) => (
                  <AlertCard key={a.id} alert={a} lang={lang}
                    open={openId === a.id}
                    onToggle={() => setOpenId(openId === a.id ? null : a.id)} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ================= TRUST ================= */
const GROUP_ICONS = { gWeather: I.cloud, gAlerts: I.bell, gVoice: I.mic, gMore: I.db };

export function TrustView() {
  const s = useApi(() => api.sources(), []);
  const sources = s.data?.sources || [];
  const groups = ['gWeather', 'gAlerts', 'gVoice', 'gMore']
    .map((g) => ({ g, items: sources.filter((x) => sourceGroup(x.name) === g) }))
    .filter((x) => x.items.length > 0);
  const live = sources.filter((x) => String(x.status).toUpperCase() === 'LIVE').length;

  return (
    <div className="page">
      <div className="view-head"><h1>{t('trustViewTitle')}</h1><p>{t('trustViewSub')}</p></div>

      <div className="card">
        <div className="alert-status">
          <span className="as-icon info"><I.shield /></span>
          <div style={{ flex: 1 }}>
            <h3>{tp('liveOf', { n: live, m: sources.length })}</h3>
            <p className="as-sub">{t('imdFirst')}</p>
          </div>
          <button className="btn ghost" onClick={s.reload} disabled={s.loading} style={{ flex: 'none' }}>
            <I.refresh />{t('recheck')}
          </button>
        </div>
      </div>

      {s.loading ? <><Skeleton /><Skeleton /></> : s.error ? (
        <div className="card"><EmptyState icon={I.shield} title={t('loadError')} action={<button className="btn primary" onClick={s.reload}>{t('retry')}</button>} /></div>
      ) : groups.map(({ g, items }) => {
        return (
          <section className="card" key={g} aria-label={t(g)}>
            <SectionHead title={t(g)} />
            {items.map((x) => {
              const key = sourceDisplayName(x.name);
              const name = key ? t(key) : x.name;
              const SIcon = GROUP_ICONS[sourceGroup(x.name)] || I.db;
              return (
                <div className="src-row" key={x.name}>
                  <span className="sr-icon"><SIcon /></span>
                  <div className="sr-main">
                    <div className="sr-top">
                      <span className="sr-name">{name}</span>
                      <StatusPill status={x.status} />
                    </div>
                    <p className="sr-detail">{x.detail || t('noDetail')}</p>
                    {x.updated_at ? <p className="sr-time"><Ago at={x.updated_at} /></p> : null}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function Ago({ at }) {
  const now = useNow();
  const parts = agoParts(at, now);
  if (!parts) {
    try { return <span>{new Date(at).toLocaleString()}</span>; } catch { return null; }
  }
  if (parts.key === 'justNow') return <span>{t('updatedJustNow')}</span>;
  return <span>{tp('updatedAgo', { t: tp(parts.key, parts.params) })}</span>;
}

/* ================= MORE ================= */
export function MoreView({ onOpenTrust }) {
  const { lang, setLang } = useLang();
  const [pushOn, setPushOn] = useLocalStorage('saarthi:push', false);

  async function togglePush() {
    if (pushOn) { setPushOn(false); return; }
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      toast(t('pushUnsupported'), 'warn'); return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast(t('pushDenied'), 'warn'); return; }
      const vapid = await api.pushVapid().catch(() => null);
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapid?.publicKey ? urlB64(vapid.publicKey) : undefined,
      }).catch(() => null);
      if (sub) await api.pushSubscribe(sub.toJSON()).catch(() => {});
      setPushOn(true);
      toast(t('on'), 'ok');
    } catch { toast(t('pushUnsupported'), 'warn'); }
  }

  return (
    <div className="page">
      <div className="view-head"><h1>{t('moreTitle')}</h1></div>

      <section className="card" aria-label={t('language')}>
        <div className="set-row">
          <span className="sr-icon" style={{ width: 42, height: 42 }}><I.globe /></span>
          <div className="sr-main">
            <div className="sr-title">{t('language')}</div>
            <div className="sr-sub">{t('langSub')}</div>
          </div>
          <div className="lang-seg" role="group" aria-label={t('language')}>
            {[['en', 'EN'], ['hi', 'हिंदी'], ['te', 'తెలుగు']].map(([code, label]) => (
              <button key={code} aria-pressed={lang === code} onClick={() => setLang(code)} lang={code}>{label}</button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <span className="sr-icon" style={{ width: 42, height: 42 }}><I.bell /></span>
          <div className="sr-main">
            <div className="sr-title">{t('notifications')}</div>
            <div className="sr-sub">{t('notifSub')}</div>
          </div>
          <button className="switch" role="switch" aria-checked={pushOn} aria-label={t('notifications')} onClick={togglePush} />
        </div>
      </section>

      <button className="card pressable" onClick={onOpenTrust} style={{ width: '100%', textAlign: 'left' }}>
        <div className="alert-status">
          <span className="as-icon info"><I.shield /></span>
          <div style={{ flex: 1 }}>
            <h3>{t('trustOpen')}</h3>
            <p className="as-sub">{t('trustSub')}</p>
          </div>
          <I.chevR style={{ color: 'var(--ink3)', alignSelf: 'center' }} />
        </div>
      </button>

      <section className="card" aria-label={t('about')}>
        <SectionHead title={t('about')} />
        <p style={{ color: 'var(--ink2)' }}>{t('aboutBody')}</p>
        <p className="proof"><I.info />{t('version')}</p>
        <div className="btn-row">
          <a className="btn danger" href="tel:112" style={{ textDecoration: 'none' }}><I.phone />{t('call112')}</a>
        </div>
      </section>
    </div>
  );
}

function urlB64(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
