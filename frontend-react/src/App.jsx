// SAARTHI v2 app shell: top bar, bottom nav, SOS, sheets, view routing.
import { useState, useCallback } from 'react';
import { api, HYD } from './api.js';
import { LangProvider, useLang, t } from './i18n.jsx';
import { useApi, useLocalStorage } from './hooks.js';
import { I, TopBar, BottomNav, SosFab, Sheet, ToastHost, toast, EmptyState } from './components.jsx';
import { HomeView, AdviceView, AlertsView, TrustView, ChatView, MoreView } from './views.jsx';

const DEFAULT_LOC = { lat: HYD.lat, lon: HYD.lon, district: 'Hyderabad', city: 'Hyderabad', state: 'Telangana' };

function deviceId() {
  try {
    let id = localStorage.getItem('saarthi:device');
    if (!id) { id = `web-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem('saarthi:device', id); }
    return id;
  } catch { return 'web-unknown'; }
}

function Shell() {
  const { lang, setLang } = useLang();
  const [view, setView] = useState('home');
  const [loc, setLoc] = useLocalStorage('saarthi:loc', DEFAULT_LOC);
  const [sheet, setSheet] = useState(null); // 'loc' | 'sos' | 'notif' | null

  const status = useApi(() => api.status(), []);
  const unreadQ = useApi(
    () => api.notificationsUnread(loc.district, deviceId()).catch(() => ({ unread: 0 })),
    [loc.district],
  );
  const unread = unreadQ.data?.unread || 0;
  const tone = status.data
    ? (String(status.data.state).toUpperCase() === 'LIVE' ? 'ok' : 'warn')
    : 'muted';

  const go = useCallback((v) => {
    setView(v);
    window.scrollTo({ top: 0 });
  }, []);

  const views = {
    home: <HomeView loc={loc} go={go} />,
    alerts: <AlertsView loc={loc} />,
    advice: <AdviceView loc={loc} />,
    chat: <ChatView loc={loc} />,
    more: <MoreView loc={loc} onOpenTrust={() => go('trust')} />,
    trust: <TrustView />,
  };

  return (
    <div className="app">
      <TopBar
        locName={loc.city || loc.district}
        statusTone={tone}
        unread={unread}
        onLocation={() => setSheet('loc')}
        onBell={() => setSheet('notif')}
        lang={lang}
        onLang={setLang}
      />
      <main>{views[view] || views.home}</main>
      <SosFab onClick={() => setSheet('sos')} />
      <BottomNav view={view === 'trust' ? 'more' : view} onNav={go} />
      <ToastHost />
      {sheet === 'loc' ? <LocationSheet loc={loc} onPick={(l) => { setLoc(l); setSheet(null); }} onClose={() => setSheet(null)} /> : null}
      {sheet === 'notif' ? <NotifSheet district={loc.district} onClose={() => { setSheet(null); unreadQ.reload(); }} onOpenAlerts={() => { setSheet(null); go('alerts'); }} /> : null}
      {sheet === 'sos' ? <SosSheet loc={loc} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

/* ---------------- Location sheet ---------------- */
function LocationSheet({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  async function search(v) {
    setQ(v);
    if (v.trim().length < 2) { setResults([]); return; }
    setBusy(true);
    try {
      const r = await api.searchLocation(v.trim());
      setResults(r || []);
    } catch { setResults([]); }
    finally { setBusy(false); }
  }

  function gps() {
    if (!navigator.geolocation) { toast(t('locError'), 'warn'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        try {
          const l = await api.resolveLocation(p.coords.latitude, p.coords.longitude);
          onPick({ lat: p.coords.latitude, lon: p.coords.longitude, district: l.district || '', city: l.city || l.district || '', state: l.state || '' });
        } catch { toast(t('locError'), 'warn'); }
        finally { setBusy(false); }
      },
      () => { setBusy(false); toast(t('locError'), 'warn'); },
      { timeout: 8000 },
    );
  }

  return (
    <Sheet title={t('changeLocation')} onClose={onClose}>
      <div className="search-input">
        <I.search />
        <input name="location-search" value={q} onChange={(e) => search(e.target.value)}
          placeholder={t('searchPh')} aria-label={t('searchPh')} autoComplete="off" />
      </div>
      <button className="btn ghost block" onClick={gps} disabled={busy} style={{ marginBottom: 8 }}>
        <I.pin />{busy ? t('locating') : t('useGps')}
      </button>
      {results.map((r, i) => (
        <button key={i} className="result-row" onClick={() => onPick({
          lat: r.lat ?? r.latitude, lon: r.lon ?? r.longitude,
          district: r.district || r.name || '', city: r.city || r.name || '', state: r.state || '',
        })}>
          <I.pin />
          <span>{r.city || r.name || r.district}<span className="rr-sub">{[r.district, r.state].filter(Boolean).join(', ')}</span></span>
        </button>
      ))}
      {q.trim().length >= 2 && !busy && results.length === 0 ? <p style={{ color: 'var(--ink2)', padding: '0.6rem 0' }}>{t('noMatch')}</p> : null}
    </Sheet>
  );
}

/* ---------------- Notifications sheet ---------------- */
function NotifSheet({ district, onClose, onOpenAlerts }) {
  const n = useApi(() => api.notifications(district, deviceId()), [district]);
  const items = n.data?.notifications || [];

  async function markAll() {
    try { await api.notificationsRead({ district, device: deviceId() }); } catch { /* best effort */ }
    n.reload();
  }

  return (
    <Sheet title={t('notifications')} onClose={onClose}
      sub={items.length ? undefined : undefined}>
      {n.loading ? <p style={{ color: 'var(--ink2)' }}>{t('loading')}</p>
        : items.length === 0 ? (
          <EmptyState icon={I.bell} title={t('noNotifications')}
            action={<button className="btn primary" onClick={onOpenAlerts}>{t('openAlerts')}</button>} />
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <button className="link-btn" onClick={markAll}>{t('markAllRead')}</button>
            </div>
            {items.map((x, i) => (
              <div className="card" key={x.id || i} style={{ marginBottom: 8, padding: '0.85rem 1rem' }}>
                <strong>{x.title || x.headline}</strong>
                {x.body || x.message ? <p style={{ color: 'var(--ink2)', fontSize: 'var(--fs-small)' }}>{x.body || x.message}</p> : null}
              </div>
            ))}
          </>
        )}
    </Sheet>
  );
}

/* ---------------- SOS sheet ---------------- */
function SosSheet({ loc, onClose }) {
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  async function send() {
    setSending(true);
    try {
      await api.sos({
        type: 'NEED_HELP',
        lat: loc.lat, lon: loc.lon,
        district: loc.district, city: loc.city,
        note: note.trim(),
        created_at: new Date().toISOString(),
      });
      setDone(true);
      toast(t('sent'), 'ok');
    } catch {
      toast(t('sosErr'), 'bad');
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet title={t('sosTitle')} sub={t('body')} onClose={onClose}>
      {done ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <EmptyState icon={I.check} title={t('sent')} />
          <p style={{ color: 'var(--ink2)', fontSize: 'var(--fs-small)', marginTop: 8 }}>{t('warn112')}</p>
          <div className="btn-row"><button className="btn primary" onClick={onClose}>{t('ok')}</button></div>
        </div>
      ) : (
        <>
          <div className="search-input">
            <I.chat />
            <input name="note" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePh')} aria-label={t('notePh')} maxLength={200} />
          </div>
          <p style={{ color: 'var(--warn)', fontSize: 'var(--fs-small)', margin: '8px 0 4px', display: 'flex', gap: 6, alignItems: 'center' }}>
            <I.alertTri style={{ width: 15, height: 15, flex: 'none' }} />{t('warn112')}
          </p>
          <div className="btn-row">
            <button className="btn ghost" onClick={onClose}>{t('cancel')}</button>
            <button className="btn danger" onClick={send} disabled={sending}>
              <I.phone />{sending ? t('sending') : t('sosSend')}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

export default function App() {
  return (
    <LangProvider>
      <Shell />
    </LangProvider>
  );
}
