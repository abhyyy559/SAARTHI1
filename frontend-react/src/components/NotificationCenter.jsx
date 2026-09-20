// Notification Center — the alert lifecycle the user can scroll.
//
// The OS notification is fire-and-forget: it buzzes, it vanishes. This page is
// the durable trail — PRE-ALERT → ACTIVE → UPDATED → ENDED — with NEW/READ
// stamps, pending rows hatched until the server confirms, and tap-to-acknowledge
// for the delivery ledger. Backed ONLY by what the server actually pushed
// (notification_service.log); nothing is invented here to make the list look busy.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import { Card } from './ui';

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

function NotificationRow({ n, onRead, onAck, acked, saving }) {
  const { lang, speak, setView } = useApp();
  const meta = KIND_META[n.kind] || KIND_META.info;
  const sev = n.severity || 'INFO';
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
          {n.severity && <> · <span className="sev-stamp" data-sev={sev}>{sev}</span></>}
          {n.push && typeof n.push.delivered === 'number' && (
            <span> · push {n.push.delivered}/{n.push.targeted}</span>
          )}
        </div>
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
      </div>
    </article>
  );
}

export default function NotificationCenter() {
  const { lang, loc, syncTick, device, showToast } = useApp();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState({}); // id -> true while a write is in flight
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
          type="button" className="btn btn-ghost sm"
          onClick={() => api.notificationsRead({ all: true, district: loc.district, device })
            .then(reload)
            .catch(() => { showToast(t(lang, 'ntfActionFailed')); })}
        >
          {t(lang, 'ntfReadAll')} ({unread})
        </button>
      )}
    >
      {!items ? <p className="mono" role="status">{t(lang, 'checking')}</p>
        : err ? <p className="sub">{t(lang, 'ntfLoadFailed')}</p>
          : items.length === 0 ? <p className="sub">{t(lang, 'ntfEmpty')}</p>
            : <div className="ntf-list">
              {groups.map(([day, list]) => (
                <section key={day} aria-label={dayLabel(list[0].at)}>
                  <div className="alert-sec-title">
                    <span className="kicker">{dayLabel(list[0].at)}</span>
                  </div>
                  {list.map((n) => (
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
