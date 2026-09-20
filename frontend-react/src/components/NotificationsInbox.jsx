// NotificationsInbox — the alert lifecycle the user can scroll, grouped by
// alert. Each group is one warning's whole trail (issued -> active ->
// extended/updated -> ended) with an unread badge; tapping the header expands
// the timeline inline. Backed ONLY by what the server actually pushed
// (notification_service.log); nothing is invented here.
//
// HARBOUR SIGNAL: severity is always icon + word + color (SevStamp), sentence
// case, 44px targets, one primary action per screen. This component renders
// inside the notifications view — it does not own the view head or the nav.
import { useCallback, useEffect, useState } from 'react';
import { api, demoAlertApi, notificationsApi } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { saveNotificationSnapshot, readNotificationSnapshot } from '../offline';
import Icon from './icons';
import { Card, SevStamp } from './ui';
import { KIND_ICON, transitionKey, groupNotifications, groupTitle } from './inboxLogic';

function stamp(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return time;
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${time}`;
  } catch { return ''; }
}

function UpdatesWord({ n, lang }) {
  return <>{t(lang, 'inboxGroupUpdates').replace('{n}', String(n))}</>;
}

export default function NotificationsInbox({ initialAlertId = null, onOpenAlert = null }) {
  const { lang, loc, device, showToast, syncTick, speak } = useApp();
  const [items, setItems] = useState(null);
  const [offline, setOffline] = useState(false);
  const [tick, setTick] = useState(0);
  const [openKey, setOpenKey] = useState(initialAlertId || null);
  const [fetched, setFetched] = useState({}); // alertId -> demo bulletin (title/hazard)
  const [saving, setSaving] = useState({});

  useEffect(() => {
    let alive = true;
    notificationsApi.list(loc.district, device)
      .then((d) => {
        if (!alive) return;
        const list = d.notifications || [];
        setItems(list);
        setOffline(false);
        saveNotificationSnapshot(list);
      })
      .catch(() => {
        if (!alive) return;
        // Server unreachable: say so and fall back to what this phone saved.
        const snap = readNotificationSnapshot();
        setItems(snap ? snap.items : []);
        setOffline(true);
      });
    return () => { alive = false; };
  }, [loc.district, device, syncTick, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const markGroupRead = (group) => {
    const ids = group.items.filter((n) => !n.read).map((n) => n.id);
    if (!ids.length) return;
    setSaving((s) => ({ ...s, [group.key]: true }));
    api.notificationsRead({ ids, device })
      .then(() => {
        setItems((old) => (old || []).map((x) => (ids.includes(x.id) ? { ...x, read: true } : x)));
      })
      .catch(() => { showToast(t(lang, 'ntfActionFailed')); })
      .finally(() => setSaving((s) => { const c = { ...s }; delete c[group.key]; return c; }));
  };

  const groups = groupNotifications(items);

  // Lazily resolve demo bulletin titles for group headers. Official trails
  // never need a fetch — their hazard is in the key or the title stands alone.
  useEffect(() => {
    for (const g of groups) {
      if (g.demo && g.alertId && !fetched[g.alertId]) {
        demoAlertApi.get(g.alertId)
          .then((d) => {
            const a = d.alert || d || {};
            setFetched((f) => ({ ...f, [g.alertId]: { title: a.title, hazard: a.hazard } }));
          })
          .catch(() => {
            setFetched((f) => ({ ...f, [g.alertId]: {} }));
          });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.map((g) => g.key).join('|')]);

  const unread = groups.reduce((n, g) => n + g.unread, 0);

  return (
    <Card
      actions={unread > 0 && (
        <button
          type="button" className="btn btn-ghost sm"
          style={{ minHeight: 44 }}
          onClick={() => api.notificationsRead({ all: true, district: loc.district, device })
            .then(reload)
            .catch(() => { showToast(t(lang, 'ntfActionFailed')); })}
        >
          {t(lang, 'ntfReadAll')} ({unread})
        </button>
      )}
    >
      {!items ? <p className="mono" role="status">{t(lang, 'checking')}</p>
        : offline && items.length === 0 ? (
          <div className="offline-panel" role="status">
            <div className="display">{t(lang, 'ntfOfflineTitle')}</div>
            <p className="sub">{t(lang, 'ntfOfflineBody')}</p>
            <div className="row">
              <button type="button" className="btn sm" style={{ minHeight: 44 }} onClick={reload}>
                <Icon name="refresh" size={14} /> {t(lang, 'ntfRetry')}
              </button>
            </div>
          </div>
        )
        : groups.length === 0 ? <p className="sub">{t(lang, 'ntfEmpty')}</p>
        : (
          <div className="ntf-list" role="list">
            {groups.map((g) => {
              const open = openKey === g.key;
              const title = groupTitle(g, fetched[g.alertId], (k) => t(lang, k));
              const tag = g.demo ? t(lang, 'inboxDemoTag') : t(lang, 'inboxOfficialTag');
              return (
                <article key={g.key} className="inbox-group" role="listitem" data-sev={g.severity}>
                  <button
                    type="button"
                    className="inbox-group-head"
                    style={{ minHeight: 44 }}
                    aria-expanded={!!open}
                    onClick={() => setOpenKey(open ? null : g.key)}
                  >
                    <span className="sev-bar" aria-hidden="true" />
                    <span className="inbox-group-main">
                      <span className="inbox-group-title">
                        <SevStamp lang={lang} level={g.severity} />
                        <span>{title}</span>
                      </span>
                      <span className="inbox-group-meta mono">
                        <span className="chip">{tag}</span>
                        {g.items[0].district && <span>{g.items[0].district}</span>}
                        {' · '}<UpdatesWord n={g.items.length} lang={lang} />
                        {' · '}{stamp(g.latest.at)}
                      </span>
                    </span>
                    {g.unread > 0 && (
                      <span className="inbox-unread" aria-label={`${g.unread} unread`}>{g.unread}</span>
                    )}
                    <span style={open ? { transform: 'rotate(-90deg)', display: 'inline-flex' } : { display: 'inline-flex' }} aria-hidden="true">
                      <Icon name="chevron" size={18} />
                    </span>
                  </button>
                  {open && (
                    <div className="inbox-timeline">
                      <div className="kicker" style={{ marginBottom: 8 }}>{t(lang, 'inboxTimeline')}</div>
                      <ol className="inbox-steps">
                        {g.items.map((n) => (
                          <li key={n.id} className="inbox-step">
                            <Icon name={KIND_ICON[n.kind] || 'info'} size={16} aria-hidden />
                            <span className="inbox-step-label">{t(lang, transitionKey(n.kind))}</span>
                            <span className="inbox-step-time mono">{stamp(n.at)}</span>
                            {!n.read && <span className="ntf-stamp is-new">{t(lang, 'sbStampNew')}</span>}
                          </li>
                        ))}
                      </ol>
                      <div className="row" style={{ marginTop: 12 }}>
                        {onOpenAlert && g.alertId && !String(g.alertId).startsWith('official:') && !String(g.alertId).startsWith('cap:') && (
                          <button
                            type="button" className="btn btn-ghost sm" style={{ minHeight: 44 }}
                            onClick={() => onOpenAlert(g.alertId)}
                          >
                            {t(lang, 'inboxViewAlert')}
                          </button>
                        )}
                        {g.unread > 0 && (
                          <button
                            type="button" className="btn sm" style={{ minHeight: 44 }}
                            disabled={!!saving[g.key]}
                            onClick={() => markGroupRead(g)}
                          >
                            {t(lang, 'ntfMarkRead')}
                          </button>
                        )}
                        <button
                          type="button" className="btn btn-ghost sm" style={{ minHeight: 44 }}
                          onClick={() => speak(`${title}. ${g.latest.body || ''}`)}
                        >
                          <Icon name="speaker" size={14} /> {t(lang, 'alertsListen')}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
    </Card>
  );
}
