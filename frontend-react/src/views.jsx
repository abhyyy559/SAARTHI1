// SAARTHI v2 views.
import { useState, useEffect, useRef } from 'react';
import { api, HYD } from './api.js';
import { t, tp, useLang } from './i18n.jsx';
import { useApi, useLocalStorage, useNow } from './hooks.js';
import { agoParts, fmtWind, collectAlerts, sourceGroup, sourceDisplayName } from './lib.js';
import {
  I, SkyHero, GlassStat, SevBadge, StatusPill, ProofLine, Skeleton,
  SectionHead, EmptyState, RoleGrid, ForecastRail, AlertCard, toast,
} from './components.jsx';

/* ================= HOME ================= */
export function HomeView({ loc, go }) {
  const { lang } = useLang();
  const now = useNow();
  void now;
  const wx = useApi(() => api.current(loc.lat, loc.lon, { lang }), [loc.lat, loc.lon, lang]);
  const warn = useApi(() => api.warnings(loc.district || 'Hyderabad', loc.lat, loc.lon), [loc.district, loc.lat, loc.lon]);
  const fc = useApi(() => api.forecast(loc.lat, loc.lon), [loc.lat, loc.lon]);
  const src = useApi(() => api.sources(), []);

  const cur = wx.data?.current;
  const locName = wx.data?.location?.city || loc.city || loc.district;

  return (
    <div className="page">
      {wx.loading ? <Skeleton kind="hero" /> : wx.error ? (
        <div className="card"><EmptyState icon={I.cloud} title={t('loadError')} action={<button className="btn primary" onClick={wx.reload}>{t('retry')}</button>} /></div>
      ) : (
        <SkyHero condition={cur?.condition} temp={cur?.temperature} observedAt={cur?.observed_at}
          source={cur?.source} locationName={locName}>
          <div className="sky-stats">
            <GlassStat icon={I.wind} label={t('wind')} value={`${fmtWind(cur?.wind_speed)} ${t('windUnit')}`} />
            <GlassStat icon={I.drop} label={t('humidity')} value={`${Math.round(cur?.humidity ?? 0)}%`} />
            <GlassStat icon={I.umbrella} label={t('rainfall')} value={`${cur?.rainfall ?? 0} ${t('rainUnit')}`} />
          </div>
        </SkyHero>
      )}

      {/* Alert status with proof of check */}
      <section aria-label={t('alertCheck')}>
        {warn.loading ? <Skeleton /> : <AlertStatusCard data={warn.data} onOpen={() => go('alerts')} />}
      </section>

      {/* Role brief teaser */}
      {wx.data?.role_brief?.headline ? (
        <button className="card pressable" onClick={() => go('advice')} style={{ textAlign: 'left', width: '100%' }}>
          <span className="adv-kind">{t('forYou')}</span>
          <h3 style={{ fontSize: 'var(--fs-h3)', fontWeight: 800, margin: '4px 0' }}>{wx.data.role_brief.headline}</h3>
          <span className="link-btn" style={{ padding: 0 }}>{t('openAdvice')} <I.chevR /></span>
        </button>
      ) : null}

      {/* Ask teaser */}
      <section className="card" aria-label={t('askTitle')}>
        <div className="alert-status">
          <span className="as-icon info" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}><I.chat /></span>
          <div style={{ flex: 1 }}>
            <h3>{t('askTitle')}</h3>
            <p className="as-sub">{t('askSub')}</p>
            <div style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => go('chat')}><I.mic />{t('askCta')}</button>
            </div>
          </div>
        </div>
      </section>

      {/* Forecast */}
      <section aria-label={t('forecast')}>
        <SectionHead title={t('forecast')} />
        {fc.loading ? <Skeleton /> : fc.error ? (
          <div className="card"><EmptyState icon={I.cloud} title={t('loadError')} action={<button className="btn ghost" onClick={fc.reload}>{t('retry')}</button>} /></div>
        ) : <ForecastRail days={fc.data?.forecast?.days || fc.data?.days} lang={lang} />}
      </section>

      {/* Collapsed source strip */}
      <section aria-label={t('sources')}>
        {src.loading ? <Skeleton /> : src.data ? (
          <button className="card pressable" onClick={() => go('trust')} style={{ width: '100%', textAlign: 'left' }}>
            <div className="alert-status">
              <span className="as-icon muted"><I.db /></span>
              <div style={{ flex: 1 }}>
                <h3>{t('sources')}</h3>
                <p className="as-sub">{tp('sourcesLive', { n: liveCount(src.data.sources), m: (src.data.sources || []).length })}</p>
                <p className="as-sub" style={{ marginTop: 2 }}>{t('imdFirst')}</p>
              </div>
              <I.chevR style={{ color: 'var(--ink3)', flex: 'none', alignSelf: 'center' }} />
            </div>
          </button>
        ) : null}
      </section>
    </div>
  );
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

/* ================= CHAT ================= */
export function ChatView({ loc }) {
  const { lang } = useLang();
  const [role] = useLocalStorage('saarthi:role', 'general');
  const [msgs, setMsgs] = useState([{ role: 'bot', text: t('greeting') }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs]);

  const push = (m) => setMsgs((xs) => [...xs, m]);

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    push({ role: 'user', text: q });
    setBusy(true);
    const body = { message: q, lat: loc.lat, lon: loc.lon, district: loc.district, language: lang, user_type: role };
    // Try streaming first, fall back to plain POST.
    try {
      let got = false;
      const botIdx = { i: -1 };
      for await (const line of api.chatStream(body)) {
        if (line.type === 'token' && line.text) {
          got = true;
          if (botIdx.i === -1) {
            setMsgs((xs) => { botIdx.i = xs.length; return [...xs, { role: 'bot', text: '' }]; });
          }
          const txt = line.text;
          setMsgs((xs) => xs.map((m, i) => (i === botIdx.i ? { ...m, text: m.text + txt } : m)));
        } else if (line.type === 'final' && line.answer) {
          got = true;
          const fin = line.answer;
          setMsgs((xs) => {
            if (botIdx.i === -1) return [...xs, { role: 'bot', text: fin, evidence: line.evidence }];
            return xs.map((m, i) => (i === botIdx.i ? { ...m, text: fin, evidence: line.evidence } : m));
          });
        }
      }
      if (!got) throw new Error('empty stream');
    } catch {
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

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast(t('noMic'), 'warn'); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
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

  function speak(text) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'hi' ? 'hi-IN' : lang === 'te' ? 'te-IN' : 'en-IN';
      speechSynthesis.speak(u);
    } catch { /* no TTS */ }
  }

  return (
    <div className="page">
      <div className="view-head"><h1>{t('chatTitle')}</h1><p>{t('voiceFallback')}</p></div>
      <div className="chat-log" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
            {m.role === 'bot' && m.text ? (
              <span className="m-ev">
                <button className="link-btn" onClick={() => speak(m.text)} aria-label={t('listen')}><I.mic />{t('listen')}</button>
              </span>
            ) : null}
          </div>
        ))}
        {busy ? <div className="msg bot"><span className="typing"><i /><i /><i /></span></div> : null}
        <div ref={bottomRef} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <button type="button" className="icon-btn" onClick={toggleMic}
          aria-label={listening ? t('micStop') : t('micStart')}
          style={listening ? { background: 'var(--bad)', borderColor: 'var(--bad)' } : null}>
          <I.mic />
        </button>
        <input name="message" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={t('ph')} aria-label={t('ph')} autoComplete="off" maxLength={500} />
        <button type="submit" className="send-btn" disabled={busy || !input.trim()} aria-label={t('chatSend')}>
          <I.send />
        </button>
      </form>
    </div>
  );
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
