// Notifications side panel — the ONE notifications home.
//
// The topbar bell opens this panel; the push enable/disable switch lives
// inside it. Escape, the scrim, or the close button shuts it. Opening moves
// focus to the close button and closing restores focus to the opener.
//
// The list is backed ONLY by /api/notifications (the server's push log —
// nothing is invented to look busy), newest-first, with read/unread stamps.
// Tapping a row marks it read and opens the relevant alert in-app
// (?view=alerts); mark-all-read and per-alert acknowledgement follow the
// server-confirmed honesty pattern (the row only flips after the POST
// succeeds). The push switch calls the store's toggleNotify — the enable
// logic itself is owned elsewhere and is NOT reimplemented here.
//
// This panel supersedes NotificationCenter (flat page) and
// NotificationsInbox (grouped page); their fetch/read/ack/snapshot logic was
// refactored in here. inboxLogic.js (pure grouping helpers) is reused as-is.
//
// HARBOUR SIGNAL: paper #F6F1E7, white cards, 2px ink borders, system fonts,
// sentence case. Severity is always icon + word + color (SevStamp), never
// color alone.
import { useEffect, useRef, useState } from 'react';
import { notificationsApi } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { pushReasonKey } from '../notify';
import { saveNotificationSnapshot, readNotificationSnapshot } from '../offline';
import Icon from './icons';
import { SevStamp } from './ui';
import { KIND_ICON } from './inboxLogic';

const CLEARED_KEY = 'wgpt.notifications-cleared';
// Notifications the user explicitly cleared on THIS device. Dismissal is
// local: the server log is the shared honest record, so clearing here must
// not delete anything for another device — it only hides rows on this one.
function loadCleared() {
  try { return new Set(JSON.parse(localStorage.getItem(CLEARED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveCleared(set) {
  try { localStorage.setItem(CLEARED_KEY, JSON.stringify([...set].slice(-500))); }
  catch { /* storage unavailable — worst case the list reappears */ }
}

// Client-side filters. "alerts" = carries an alert id (tap opens the alert);
// "info" = everything else. The server log stays the source of truth; the
// filter only decides what this view shows.
const FILTERS = ['all', 'unread', 'alerts', 'info'];
const FILTER_KEYS = {
  all: 'panelFilterAll',
  unread: 'panelFilterUnread',
  alerts: 'panelFilterAlerts',
  info: 'panelFilterInfo',
};

function stamp(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return time;
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${time}`;
  } catch { return ''; }
}

function PanelRow({ n, lang, speak, saving, acked, onOpen, onAck }) {
  const sev = n.severity || 'INFO';
  const isSimulated = n.kind === 'p2p-relay' || n.channel === 'p2p-simulated';
  const label = `${t(lang, 'panelOpenAlert')}: ${n.title || ''}`;
  return (
    <li className={`np-row${n.read ? ' is-read' : ''}${saving ? ' is-pending' : ''}`} data-sev={sev}>
      <button
        type="button"
        className="np-row-main"
        aria-label={label}
        onClick={() => onOpen(n)}
      >
        <span className="np-row-icon" aria-hidden="true">
          <Icon name={KIND_ICON[n.kind] || 'info'} size={18} />
        </span>
        <span className="np-row-body">
          <span className="np-row-title">
            {!n.read && <span className="np-dot" aria-hidden="true" />}
            {n.title}
          </span>
          <span className="np-row-meta mono">
            {n.district && <span>{n.district}</span>}
            {n.district && ' · '}
            {stamp(n.at)}
            {n.severity && <> · <SevStamp lang={lang} level={sev} /></>}
          </span>
          {isSimulated && <span className="np-sim">{t(lang, 'ntfSimulatedTag')}</span>}
          {n.body && <span className="np-row-text sub">{n.body}</span>}
          <span className={`ntf-stamp ${n.read ? 'is-read' : 'is-new'}`}>
            {n.read ? t(lang, 'sbStampRead') : t(lang, 'sbStampNew')}
          </span>
        </span>
      </button>
      <div className="np-row-actions">
        <button
          type="button"
          className="btn btn-ghost sm"
          onClick={(e) => { e.stopPropagation(); speak(`${n.title}. ${n.body || ''}`); }}
        >
          <Icon name="speaker" size={14} /> {t(lang, 'alertsListen')}
        </button>
        {n.alert_id && !acked && (
          <button
            type="button"
            className="btn btn-ghost sm"
            disabled={!!saving}
            title={t(lang, 'ntfAckTitle')}
            onClick={(e) => { e.stopPropagation(); onAck(n); }}
          >
            <Icon name="check" size={14} /> {t(lang, 'sbTapToAck')}
          </button>
        )}
        {n.alert_id && acked && (
          <span className="np-acked"><Icon name="check" size={14} /> {t(lang, 'ntfAcked')}</span>
        )}
      </div>
    </li>
  );
}

export default function NotificationsPanel({ open, onClose, onUnread }) {
  const {
    lang, loc, device, showToast, syncTick, setView, setSelectedAlert, speak,
    notifyOn, toggleNotify, notifyPerm, pushReady, pushMode, pushReason,
  } = useApp();
  const [items, setItems] = useState(null);
  const [offline, setOffline] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState('all');
  const [cleared, setCleared] = useState(loadCleared);
  const [saving, setSaving] = useState({}); // id -> true while a write is in flight
  const [acked, setAcked] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wgpt.acked') || '{}'); } catch { return {}; }
  });
  const closeRef = useRef(null);
  const openerRef = useRef(null);

  // Fetch the log when the panel opens (and on sync tick / manual retry).
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    notificationsApi.list(loc.district, device)
      .then((d) => {
        if (!alive) return;
        const list = (d.notifications || []).filter((n) => !loadCleared().has(n.id));
        setItems(list);
        setOffline(false);
        setSavedAt(null);
        saveNotificationSnapshot(list);
        if (onUnread) onUnread(list.filter((n) => !n.read).length);
      })
      .catch(() => {
        if (!alive) return;
        // Server unreachable: say so in plain words and fall back to what
        // this phone saved — never an infinite spinner.
        const snap = readNotificationSnapshot();
        const snapItems = (snap ? snap.items : []).filter((n) => !loadCleared().has(n.id));
        setItems(snapItems);
        setSavedAt(snap ? snap.at : null);
        setOffline(true);
        if (onUnread) onUnread(0);
      });
    return () => { alive = false; };
  }, [open, loc.district, device, syncTick, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus management + Escape + scroll lock while the panel is open.
  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement;
    const frame = requestAnimationFrame(() => { if (closeRef.current) closeRef.current.focus(); });
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (openerRef.current && openerRef.current.focus) openerRef.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const reload = () => { setTick((n) => n + 1); };

  // Read state is a server claim — the row only flips after the POST
  // succeeds. While the write is in flight the row is hatched as pending.
  const markRead = (n, silent) => {
    if (n.read) return;
    setSaving((s) => ({ ...s, [n.id]: true }));
    notificationsApi.markRead({ ids: [n.id], device })
      .then(() => {
        setItems((old) => {
          const next = (old || []).map((x) => (x.id === n.id ? { ...x, read: true } : x));
          if (onUnread) onUnread(next.filter((x) => !x.read).length);
          return next;
        });
        if (!silent) reload();
      })
      .catch(() => { showToast(t(lang, 'ntfActionFailed')); })
      .finally(() => setSaving((s) => { const c = { ...s }; delete c[n.id]; return c; }));
  };

  const markAllRead = () => {
    notificationsApi.markRead({ all: true, district: loc.district, device })
      .then(() => { if (onUnread) onUnread(0); reload(); })
      .catch(() => { showToast(t(lang, 'ntfActionFailed')); });
  };

  // Clear = mark everything read on the server, then dismiss the rows on this
  // device. The server only flips after the POST succeeds (same honesty rule
  // as mark-read); the dismissal itself is local, so another device keeps its
  // own log. A failed POST changes nothing — no silent partial clear.
  const clearAll = () => {
    const ids = (items || []).map((n) => n.id);
    if (ids.length === 0) return;
    notificationsApi.markRead({ all: true, district: loc.district, device })
      .then(() => {
        setCleared((old) => {
          const next = new Set(old);
          ids.forEach((id) => next.add(id));
          saveCleared(next);
          return next;
        });
        if (onUnread) onUnread(0);
        showToast(t(lang, 'panelCleared'));
      })
      .catch(() => { showToast(t(lang, 'ntfActionFailed')); });
  };

  const ack = (n) => {
    setSaving((s) => ({ ...s, [n.alert_id]: true }));
    notificationsApi.ack({ alert_id: n.alert_id, device })
      .then(() => {
        setAcked((old) => {
          const next = { ...old, [n.alert_id]: true };
          try { localStorage.setItem('wgpt.acked', JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      })
      .catch(() => { showToast(t(lang, 'ntfActionFailed')); })
      .finally(() => setSaving((s) => { const c = { ...s }; delete c[n.alert_id]; return c; }));
  };

  // Tapping a notification marks it read and opens the relevant content: an
  // alert-carrying notification opens the alerts view with that alert
  // selected (in-app state — the user is already here, so no URL round-trip);
  // anything else just marks read and closes.
  const openItem = (n) => {
    markRead(n, true);
    if (n.alert_id) {
      setSelectedAlert({ id: n.alert_id });
      setView('alerts');
    }
    onClose();
  };

  const visible = (items || []).filter((n) => !cleared.has(n.id));
  const filtered = visible.filter((n) => (
    filter === 'unread' ? !n.read
      : filter === 'alerts' ? !!n.alert_id
        : filter === 'info' ? !n.alert_id
          : true
  ));
  const sorted = [...filtered]
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const unread = visible.filter((n) => !n.read).length;

  // Honest push-state line under the switch: permission alone is not push.
  // In-app-only names the reason (same mapping as SettingsPanel, via the
  // shared pushReasonKey in notify.js) — the panel is the primary push UI,
  // so it must not show a vaguer line than Settings.
  const pushHint = !notifyOn
    ? t(lang, 'panelPushHint')
    : notifyPerm === 'denied' ? t(lang, 'notifyBlocked')
      : pushReady ? t(lang, 'notifyOnBackground')
        : pushMode === 'inapp'
          ? t(lang, 'setPushInAppWhy').replace('{reason}', t(lang, pushReasonKey(pushReason)))
          : t(lang, 'notifyNoPush');

  return (
    <>
      <button type="button" className="np-scrim" aria-label={t(lang, 'panelClose')} onClick={onClose} />
      <section
        className="npanel"
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, 'ntfTitle')}
      >
        <div className="np-head">
          <span className="np-title">
            <Icon name="bell" size={20} aria-hidden="true" />
            <span>{t(lang, 'ntfTitle')}</span>
            {unread > 0 && (
              <span className="np-unread">{t(lang, 'panelUnreadCount').replace('{n}', String(unread))}</span>
            )}
          </span>
          <button
            ref={closeRef}
            type="button"
            className="btn-icon"
            aria-label={t(lang, 'panelClose')}
            onClick={onClose}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* The enable/disable push switch lives here. toggleNotify is the
            store's enable logic — this panel only renders the switch. */}
        <div className="np-push">
          <div className="np-push-text">
            <span className="np-push-title">{t(lang, 'panelPushTitle')}</span>
            <span className="sub">{pushHint}</span>
            {/* Permission denied is the one push state the user can fix, but
                only in browser/app settings — say so and take them there.
                SettingsPanel itself is Crew G's; this only navigates. */}
            {notifyOn && notifyPerm === 'denied' && (
              <button
                type="button"
                className="btn btn-ghost sm"
                onClick={() => { onClose(); setView('settings'); }}
              >
                {t(lang, 'panelOpenSettings')}
              </button>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!notifyOn}
            aria-label={t(lang, 'panelPushTitle')}
            className={`np-switch${notifyOn ? ' is-on' : ''}`}
            onClick={() => toggleNotify()}
          >
            <span className="np-knob" aria-hidden="true" />
            <span className="np-switch-word">{t(lang, notifyOn ? 'panelPushOn' : 'panelPushOff')}</span>
          </button>
        </div>

        <div className="np-list-wrap">
          {!items ? <p className="mono" role="status">{t(lang, 'checking')}</p>
            : offline && items.length === 0 ? (
              <div className="offline-panel" role="status">
                <div className="display">{t(lang, 'ntfOfflineTitle')}</div>
                <p className="sub">{t(lang, 'ntfOfflineBody')}</p>
                <div className="row">
                  <button type="button" className="btn sm" onClick={reload}>
                    <Icon name="refresh" size={14} /> {t(lang, 'ntfRetry')}
                  </button>
                </div>
              </div>
            )
              : sorted.length === 0 ? <p className="sub">{t(lang, 'ntfEmpty')}</p>
                : (
                  <>
                    <div className="np-actions">
                      <div className="segmented" role="group" aria-label={t(lang, 'panelFilterLabel')}>
                        {FILTERS.map((f) => (
                          <button
                            key={f}
                            type="button"
                            className={`seg-opt${filter === f ? ' is-active' : ''}`}
                            aria-pressed={filter === f}
                            onClick={() => setFilter(f)}
                          >
                            {t(lang, FILTER_KEYS[f])}
                          </button>
                        ))}
                      </div>
                      {unread > 0 && (
                        <button type="button" className="btn btn-ghost sm" onClick={markAllRead}>
                          {t(lang, 'ntfReadAll')} ({unread})
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost sm" onClick={clearAll}>
                        {t(lang, 'panelClear')}
                      </button>
                    </div>
                    {offline && (
                      <p className="warn-chip">
                        {t(lang, 'ntfSavedTag')}{savedAt ? ` · ${stamp(savedAt)}` : ''}
                      </p>
                    )}
                    <ul className="np-list">
                      {sorted.map((n) => (
                        <PanelRow
                          key={n.id}
                          n={n}
                          lang={lang}
                          speak={speak}
                          saving={!!saving[n.id] || !!saving[n.alert_id]}
                          acked={!!acked[n.alert_id]}
                          onOpen={openItem}
                          onAck={ack}
                        />
                      ))}
                    </ul>
                  </>
                )}
        </div>
      </section>
    </>
  );
}
