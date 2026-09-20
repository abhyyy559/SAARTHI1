// Notification Center — the alert lifecycle the user can scroll.
//
// The OS notification is fire-and-forget: it buzzes, it vanishes. This page is
// the durable trail — PRE-ALERT → ACTIVE → UPDATED → ENDED — with read/unread
// state and "acknowledge" for the delivery ledger. Backed ONLY by what the
// server actually pushed (notification_service.log); nothing is invented here
// to make the list look busy.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import { Card } from './ui';

const KIND_META = {
  'pre-alert': { icon: 'clock', cls: 'pre' },
  active: { icon: 'alert', cls: 'active' },
  updated: { icon: 'refresh', cls: 'update' },
  extended: { icon: 'clock', cls: 'update' },
  ended: { icon: 'check', cls: 'ended' },
  cancelled: { icon: 'offline', cls: 'ended' },
  start: { icon: 'alert', cls: 'active' },
  escalate: { icon: 'alert', cls: 'active' },
  clear: { icon: 'check', cls: 'ended' },
  test: { icon: 'bell', cls: 'info' },
  info: { icon: 'info', cls: 'info' },
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

function NotificationRow({ n, onRead, onAck, acked }) {
  const { lang, speak, setView } = useApp();
  const meta = KIND_META[n.kind] || KIND_META.info;
  return (
    <article className={`ntf-row ${n.read ? 'is-read' : 'is-unread'} sev-${(n.severity || 'INFO').toLowerCase()}`}>
      <span className={`ntf-dot ${meta.cls}`} aria-hidden><Icon name={meta.icon} size={16} /></span>
      <div className="ntf-body">
        <div className="ntf-head">
          {!n.read && <span className="ntf-unread" title={t(lang, 'ntfUnread')} aria-label={t(lang, 'ntfUnread')} />}
          <b>{n.title}</b>
          <span className="ntf-when mono">{when(n.at)}</span>
        </div>
        <div className="ntf-text">{n.body}</div>
        <div className="ntf-meta mono">
          {n.district && <span>{n.district}</span>}
          {n.severity && <span className={`sev ${n.severity}`}>{n.severity}</span>}
          {n.push && typeof n.push.delivered === 'number' && (
            <span>push: {n.push.delivered}/{n.push.targeted}</span>
          )}
        </div>
        <div className="ntf-actions">
          <button type="button" className="btn ghost sm" onClick={() => speak(`${n.title}. ${n.body}`)}>
            <Icon name="speaker" size={14} /> {t(lang, 'alertsListen')}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setView('alerts')}>
            {t(lang, 'ntfViewAlerts')}
          </button>
          {!acked && !n.read && (
            <button type="button" className="btn sm" onClick={() => onRead(n)}>
              {t(lang, 'ntfMarkRead')}
            </button>
          )}
          {n.alert_id && (
            <button
              type="button" className="btn ghost sm" disabled={acked} title={t(lang, 'ntfAckTitle')}
              onClick={() => onAck(n)}
            >
              <Icon name="check" size={14} /> {acked ? t(lang, 'ntfAcked') : t(lang, 'ntfAck')}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function NotificationCenter() {
  const { lang, loc, syncTick, device } = useApp();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);
  const [acked, setAcked] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wgpt.acked') || '{}'); } catch { return {}; }
  });

  useEffect(() => {
    let alive = true;
    api.notifications(loc.district, device)
      .then((d) => { if (alive) { setItems(d.notifications || []); setErr(false); } })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [loc.district, device, syncTick, tick]);

  const reload = () => setTick((n) => n + 1);

  const markRead = (n) => {
    api.notificationsRead({ ids: [n.id], device })
      .catch(() => {})
      .finally(() => {
        setItems((old) => (old || []).map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        reload();
      });
  };

  const ack = (n) => {
    api.notificationsAck({ alert_id: n.alert_id, device })
      .catch(() => {})
      .finally(() => {
        setAcked((old) => {
          const next = { ...old, [n.alert_id]: true };
          try { localStorage.setItem('wgpt.acked', JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      });
  };

  const unread = (items || []).filter((n) => !n.read).length;

  // Timeline grouping: pure presentational derivation over the fetched items;
  // no data-flow or ordering change.
  const groups = [];
  for (const n of items || []) {
    const day = new Date(n.at).toDateString();
    const last = groups[groups.length - 1];
    if (last && last[0] === day) last[1].push(n);
    else groups.push([day, [n]]);
  }
  const dayLabel = (iso) => {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString()
      ? t(lang, 'ntfToday')
      : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };

  return (
    // The view head (ViewHead in views.jsx) already carries the title and
    // subtitle, so the card must not repeat them.
    <Card
      actions={unread > 0 && (
        <button
          type="button" className="btn ghost sm"
          onClick={() => api.notificationsRead({ all: true, district: loc.district, device })
            .catch(() => {}).then(reload)}
        >
          {t(lang, 'ntfReadAll')} ({unread})
        </button>
      )}
    >
      {!items ? <p className="mono">{t(lang, 'checking')}</p>
        : err ? <p className="sub">{t(lang, 'ntfLoadFailed')}</p>
          : items.length === 0 ? <p className="sub">{t(lang, 'ntfEmpty')}</p>
            : <div className="ntf-list ntf-timeline">
              {groups.map(([day, list]) => (
                <section className="ntf-group" key={day} aria-label={dayLabel(list[0].at)}>
                  <h3 className="eyebrow ntf-group-head">{dayLabel(list[0].at)}</h3>
                  {list.map((n) => (
                    <NotificationRow
                      key={n.id} n={n} onRead={markRead} onAck={ack} acked={!!acked[n.alert_id]}
                    />
                  ))}
                </section>
              ))}
            </div>}
    </Card>
  );
}
