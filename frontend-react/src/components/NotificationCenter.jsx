// Notification Center — the alert lifecycle the user can scroll.
//
// The OS notification is fire-and-forget: it buzzes, it vanishes. This page is
// the durable trail — PRE-ALERT → ACTIVE → UPDATED → ENDED — with NEW/READ
// stamps, pending rows hatched until the server confirms, and tap-to-acknowledge
// for the delivery ledger. Backed ONLY by what the server actually pushed
// (notification_service.log); nothing is invented here to make the list look busy.
//
// HARBOUR SIGNAL: the fetch has a hard 5s timeout, a saved-on-this-phone
// fallback, and an explicit Retry. Simulated P2P relays are stamped as such.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { saveNotificationSnapshot, readNotificationSnapshot } from '../offline';
import { groupNotificationsByDay, filterNotifications, deliveryRatio, NOTIFICATION_FILTERS } from '../notificationUtils';
import Icon from './icons';
import { Card, SevStamp } from './ui';

const KIND_META = {
  'pre-alert': { icon: 'clock' },
  active: { icon: 'alert' },
  updated: { icon: 'refresh' },
  extended: { icon: 'clock' },
  ended: { icon: 'check' },
  cancelled: { icon: 'offline' },
  start: { icon: 'alert' },
  escalate: { icon: 'alert' },
  clear: { icon: 'check' },
  test: { icon: 'bell' },
  info: { icon: 'info' },
  'p2p-relay': { icon: 'radio' },
};

function when(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return time;
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${time}`;
  } catch { return ''; }
}

/** Visual push-delivery ratio (e.g. 12/15) — a bar, not a number to decode. */
function DeliveryBar({ n }) {
  const r = deliveryRatio(n);
  if (!r.has) return null;
  const tone = r.pct >= 90 ? 'good' : r.pct >= 60 ? 'mid' : 'low';
  return (
    <span className="ntf-delivery" title={`${r.delivered}/${r.targeted}`}>
      <span className={`ntf-delivery-track tone-${tone}`} aria-hidden="true">
        <span className="ntf-delivery-fill" style={{ width: `${r.pct}%` }} />
      </span>
      <span className="mono">{r.delivered}/{r.targeted}</span>
    </span>
  );
}

function NotificationRow({ n, onRead, onAck, acked, saving, savedTag }) {
  const { lang, speak } = useApp();
  const meta = KIND_META[n.kind] || KIND_META.info;
  const sev = n.severity || 'INFO';
  const isSimulated = n.kind === 'p2p-relay' || n.channel === 'p2p-simulated';
  return (
    <article className={`ntf-row${saving ? ' is-pending' : ''}`} data-sev={sev}>
      <span className={`ntf-stamp ${n.read ? 'is-read' : 'is-new'}`}>
        {n.read ? t(lang, 'sbStampRead') : t(lang, 'sbStampNew')}
      </span>
      <div className="ntf-body">
        <div className="ntf-title">
          <Icon name={meta.icon} size={16} aria-hidden />
          {' '}{n.title}
        </div>
        <div className="ntf-meta mono">
          {n.district && <span>{n.district}</span>}
          {' · '}{when(n.at)}
          {n.severity && <> · <SevStamp lang={lang} level={sev} /></>}
          <DeliveryBar n={n} />
        </div>
        {isSimulated && <p className="ntf-sim">{t(lang, 'ntfSimulatedTag')}</p>}
        <p className="sub">{n.body}</p>
        <div className="row">
          <button type="button" className="btn btn-ghost sm" onClick={() => speak(`${n.title}. ${n.body}`)}>
            <Icon name="speaker" size={14} /> {t(lang, 'alertsListen')}
          </button>
          {!n.read && (
            <button type="button" className="btn sm" onClick={() => onRead(n)} disabled={!!saving}>
              {saving ? t(lang, 'sbSending') : t(lang, 'ntfMarkRead')}
            </button>
          )}
          {n.alert_id && (
            <button
              type="button" className="btn btn-ghost sm" disabled={acked || !!saving} title={t(lang, 'ntfAckTitle')}
              onClick={() => onAck(n)}
            >
              <Icon name="check" size={14} /> {acked ? t(lang, 'ntfAcked') : t(lang, 'sbTapToAck')}
            </button>
          )}
        </div>
        {savedTag && <span className="warn-chip">{savedTag}</span>}
      </div>
    </article>
  );
}

export default function NotificationCenter() {
  const { lang, loc, syncTick, device, showToast } = useApp();
  const [items, setItems] = useState(null);
  const [offline, setOffline] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState({}); // id -> true while a write is in flight
  const [filter, setFilter] = useState('all');
  const [acked, setAcked] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wgpt.acked') || '{}'); } catch { return {}; }
  });

  useEffect(() => {
    let alive = true;
    api.notifications(loc.district, device)
      .then((d) => {
        if (!alive) return;
        const list = d.notifications || [];
        setItems(list);
        setOffline(false);
        setSavedAt(null);
        saveNotificationSnapshot(list);
      })
      .catch(() => {
        if (!alive) return;
        // Server unreachable within the timeout: say so in plain words and
        // fall back to what this phone saved — never an infinite spinner.
        const snap = readNotificationSnapshot();
        setItems(snap ? snap.items : []);
        setSavedAt(snap ? snap.at : null);
        setOffline(true);
      });
    return () => { alive = false; };
  }, [loc.district, device, syncTick, tick]);

  const reload = () => { setOffline(false); setTick((n) => n + 1); };

  // The read state is a server claim — it only flips after the POST
  // succeeds. While the write is in flight the row is hatched as pending; a
  // failed write leaves the row unread and says so.
  const markRead = (n) => {
    setSaving((s) => ({ ...s, [n.id]: true }));
    api.notificationsRead({ ids: [n.id], device })
      .then(() => {
        setItems((old) => (old || []).map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        reload();
      })
      .catch(() => { showToast(t(lang, 'ntfActionFailed')); })
      .finally(() => setSaving((s) => { const c = { ...s }; delete c[n.id]; return c; }));
  };

  // Same honesty rule as markRead — the acknowledgement is only
  // recorded locally after the server confirms it.
  const ack = (n) => {
    setSaving((s) => ({ ...s, [n.alert_id]: true }));
    api.notificationsAck({ alert_id: n.alert_id, device })
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

  const unread = (items || []).filter((n) => !n.read).length;

  // Filters + Today/Yesterday/Earlier grouping: pure derivations over the
  // fetched items (notificationUtils.js), no data-flow or ordering change.
  const visible = filterNotifications(items || [], filter);
  const groups = groupNotificationsByDay(visible, (k) => t(lang, k));

  const savedTag = offline ? `${t(lang, 'ntfSavedTag')}${savedAt ? ` · ${when(savedAt)}` : ''}` : '';

  return (
    // The view head (ViewHead in views.jsx) already carries the title and
    // subtitle, so the card must not repeat them.
    <Card
      actions={(
        <>
          <div className="ntf-filters" role="group" aria-label={t(lang, 'ntfFilterAll')}>
            {NOTIFICATION_FILTERS.map((f) => (
              <button
                key={f.id} type="button" className={`btn btn-ghost sm${filter === f.id ? ' is-active' : ''}`}
                aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
              >
                {t(lang, f.key)}
              </button>
            ))}
          </div>
          {unread > 0 && (
            <button
              type="button" className="btn btn-ghost sm"
              onClick={() => api.notificationsRead({ all: true, district: loc.district, device })
                .then(reload)
                .catch(() => { showToast(t(lang, 'ntfActionFailed')); })}
            >
              {t(lang, 'ntfReadAll')} ({unread})
            </button>
          )}
        </>
      )}
    >
      {!items ? <p className="mono" role="status">{t(lang, 'checking')}</p>
        : offline ? (
          <div className="offline-panel" role="status">
            <div className="display">{t(lang, 'ntfOfflineTitle')}</div>
            <p className="sub">{t(lang, 'ntfOfflineBody')}</p>
            <div className="row">
              <button type="button" className="btn sm" onClick={reload}>
                <Icon name="refresh" size={14} /> {t(lang, 'ntfRetry')}
              </button>
            </div>
            {items.length > 0 && (
              <div className="ntf-list">
                {items.map((n) => (
                  <NotificationRow key={n.id} n={n} onRead={markRead} onAck={ack}
                    acked={!!acked[n.alert_id]} saving={!!saving[n.id] || !!saving[n.alert_id]}
                    savedTag={savedTag} />
                ))}
              </div>
            )}
          </div>
        )
          : items.length === 0 ? <p className="sub">{t(lang, 'ntfEmpty')}</p>
            : <div className="ntf-list">
              {groups.map((g) => (
                <section key={g.key} aria-label={g.label}>
                  <div className="alert-sec-title">
                    <span className="kicker">{g.label}</span>
                  </div>
                  {g.items.map((n) => (
                    <NotificationRow
                      key={n.id} n={n} onRead={markRead} onAck={ack}
                      acked={!!acked[n.alert_id]} saving={!!saving[n.id] || !!saving[n.alert_id]}
                    />
                  ))}
                </section>
              ))}
            </div>}
    </Card>
  );
}
