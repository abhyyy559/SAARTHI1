// Admin / Demo Control Panel — the stage console for Round 2.
//
// Every button here drives the SAME pipeline a real alert would travel: the
// demo store's state machine → immediate push → notification log → delivery
// ledger. Nothing on this page is a frontend-only animation; if a button moved
// a state without a notification, the notification center would visibly miss
// it, and the demo would be a lie.
//
// Visible only in demo mode (the backend 403s every route outside it anyway).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { Card } from './ui';
import Icon from './icons';

const SEVERITIES = ['GREEN', 'YELLOW', 'ORANGE', 'RED'];
const STATE_WORD = {
  UPCOMING: 'upcoming', 'PRE-ALERT': 'preAlert', ACTIVE: 'active',
  UPDATED: 'updated', EXTENDED: 'extended', ENDED: 'ended', CANCELLED: 'cancelled',
};
const NEXT_ACTIONS = {
  UPCOMING: [['pre-alert', 'actPre'], ['activate', 'actActivate'], ['cancel', 'actCancel']],
  'PRE-ALERT': [['activate', 'actActivate'], ['cancel', 'actCancel']],
  ACTIVE: [['update', 'actUpdate'], ['extend', 'actExtend'], ['end', 'actEnd']],
  UPDATED: [['extend', 'actExtend'], ['end', 'actEnd']],
  EXTENDED: [['update', 'actUpdate'], ['end', 'actEnd']],
};
const SCENARIOS = [
  { id: 'thunderstorm', label: '⛈ Thunderstorm', hint: 'Hyderabad · ORANGE' },
  { id: 'heatwave', label: '🔥 Heat wave', hint: 'Warangal · YELLOW' },
  { id: 'rain', label: '🌧 Heavy rain', hint: 'Visakhapatnam · ORANGE' },
  { id: 'cyclone', label: '🌀 Cyclone', hint: 'Kakinada · RED' },
];

function StateChip({ state }) {
  const { lang } = useApp();
  const key = STATE_WORD[state] || state;
  return <span className={`demo-state st-${state.toLowerCase().replace(/[^a-z]/g, '')}`}>{t(lang, `st${String(key).charAt(0).toUpperCase() + String(key).slice(1)}`) || state}</span>;
}

function HistoryTimeline({ history }) {
  const { lang } = useApp();
  if (!history || history.length === 0) return null;
  return (
    <div className="demo-history">
      <div className="demo-history-label">{t(lang, 'demoHistory')}</div>
      <div className="demo-history-chain">
        {history.map((h, i) => (
          <div key={i} className="demo-history-step">
            <span className="demo-history-time">
              {new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className="demo-history-arrow" aria-hidden="true">
              <Icon name="chevron" size={10} />
            </span>
            <span className={`demo-history-state st-${String(h.state).toLowerCase()}`}>
              {t(lang, `st${String(STATE_WORD[h.state] || h.state).charAt(0).toUpperCase() + String(STATE_WORD[h.state] || h.state).slice(1)}`) || h.state}
            </span>
            {h.action && (
              <span className="demo-history-action">({t(lang, `act${String(h.action).charAt(0).toUpperCase() + String(h.action).slice(1)}`) || h.action})</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertRow({ alert, onAction, onRelay, onSeed, onNotify }) {
  const { lang } = useApp();
  const [busy, setBusy] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const run = async (fn, tag) => {
    setBusy(tag);
    try { await fn(); } catch { /* toast shown by caller */ }
    setBusy('');
  };
  const actions = NEXT_ACTIONS[alert.state] || [];
  const live = alert.state === 'ACTIVE' || alert.state === 'UPDATED' || alert.state === 'EXTENDED';
  return (
    <div className="demo-alert-row">
      <div className="demo-alert-main">
        <b>{alert.title}</b>
        <span className="mono">
          {alert.district} · {alert.severity}
          {alert.starts_at && <> · {new Date(alert.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>}
          {alert.ends_at && <>–{new Date(alert.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>}
        </span>
      </div>
      <StateChip state={alert.state} />
      <div className="demo-alert-actions">
        {actions.map(([verb, labelKey]) => (
          <button key={verb} type="button" className="btn ghost sm" disabled={!!busy}
            onClick={() => run(() => onAction(alert, verb), verb)}>
            {t(lang, labelKey)}
          </button>
        ))}
        {alert.state === 'ENDED' && (
          <button type="button" className="btn ghost sm" disabled={!!busy}
            onClick={() => run(() => onRelay(alert), 'relay')}>
            <Icon name="wifi" size={13} /> {t(lang, 'demoRelay')}
          </button>
        )}
        {live && (
          <>
            <button type="button" className="btn ghost sm" disabled={!!busy}
              onClick={() => run(() => onRelay(alert), 'relay')}>
              <Icon name="wifi" size={13} /> {t(lang, 'demoRelay')}
            </button>
            <button type="button" className="btn ghost sm" disabled={!!busy}
              onClick={() => run(() => onSeed(alert), 'seed')}>
              {t(lang, 'demoSeed')}
            </button>
          </>
        )}
        <button type="button" className="btn ghost sm" disabled={!!busy}
          onClick={() => run(() => onNotify(alert), 'notify')} title={t(lang, 'demoNotifyHint')}>
          <Icon name="bell" size={13} /> {t(lang, 'demoResend')}
        </button>
        <button type="button" className="btn ghost sm" disabled={!!busy}
          onClick={() => setShowHistory(!showHistory)}>
          <Icon name={showHistory ? 'chevron-up' : 'chevron-down'} size={13} /> {t(lang, 'demoHistoryToggle')}
        </button>
      </div>
      {showHistory && <HistoryTimeline history={alert.history} />}
    </div>
  );
}

export default function AdminPanel() {
  const { lang, showToast, syncTick, sourceMode, setBackendMode } = useApp();
  const [alerts, setAlerts] = useState(null);
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({
    title: 'Severe Thunderstorm Warning', hazard: 'Thunderstorm', severity: 'ORANGE',
    district: 'Hyderabad', area: 'Hyderabad district',
    instruction: 'Avoid unnecessary outdoor travel during the valid hours.',
    pre_min: 0.2, start_min: 0.7, end_min: 3,
  });
  const [tick] = useState(0);

  // The backend 403s every /api/demo/* route outside demo mode. Polling it in
  // hybrid mode is console spam with nothing to show — so check the mode first
  // and poll ONLY when demo mode is actually on.
  const demoLive = sourceMode === 'demo';

  const reload = useCallback(() => {
    if (!demoLive) return;
    api.demoAlerts().then((d) => setAlerts(d.alerts || [])).catch(() => setAlerts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoLive, tick, syncTick]);

  useEffect(() => { reload(); }, [reload]);

  // When switching OUT of demo mode, drop the stale list immediately (the
  // panel is replaced by the mode gate, so a hidden setState is pointless —
  // clearing on the NEXT demo entry happens via the gate's initial state).
  useEffect(() => {
    if (!demoLive) {
      const id = setTimeout(() => setAlerts(null), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [demoLive]);

  const guard = async (fn, okMsg) => {
    setBusy('x');
    try {
      const r = await fn();
      showToast(okMsg || (r && r.state) || 'OK');
      reload();
      return r;
    } catch (e) {
      showToast(e?.message || 'Failed');
      return null;
    } finally {
      setBusy('');
    }
  };

  const create = (e) => {
    e.preventDefault();
    guard(() => api.demoCreate({
      title: form.title, hazard: form.hazard, severity: form.severity,
      district: form.district, area: form.area, instruction: form.instruction,
      pre_alert_at: new Date(Date.now() + form.pre_min * 60000).toISOString(),
      starts_at: new Date(Date.now() + form.start_min * 60000).toISOString(),
      ends_at: new Date(Date.now() + form.end_min * 60000).toISOString(),
    }), t(lang, 'demoCreated'));
  };

  const action = (alert, verb) =>
    guard(() => api.demoAction(alert.id, verb), `${alert.title}: ${verb}`);

  const notify = (alert) => guard(() => api.demoNotify(alert.id), t(lang, 'demoResent'));
  const seed = (alert) => guard(() => api.coverageSeed(alert.id, 500), t(lang, 'demoSeeded'));
  const relay = (alert) => guard(() => api.demoRelay({ alert_id: alert.id }), t(lang, 'demoRelayed'));

  const scenario = (id) => guard(() => api.demoScenario(id), t(lang, 'demoScenarioLaunched'));
  const reset = () => guard(() => api.demoReset(), t(lang, 'demoResetDone'));

  if (!demoLive) {
    return (
      <Card title={t(lang, 'demoTitle')} sub={t(lang, 'demoSub')}>
        <div className="demo-mode-gate">
          <Icon name="info" size={22} />
          <p>{t(lang, 'demoNeedDemoMode')}</p>
          <button type="button" className="btn" disabled={busy}
            onClick={async () => {
              setBusy('mode');
              const ok = await setBackendMode('demo');
              setBusy('');
              if (ok) showToast(t(lang, 'demoScenarioLaunched'));
            }}>
            <Icon name="bolt" size={15} /> {t(lang, 'demoSwitchBtn')}
          </button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card title={t(lang, 'demoTitle')} sub={t(lang, 'demoSub')}>
        <div className="demo-scenarios">
          <b className="eyebrow">{t(lang, 'demoScenarios')}</b>
          <div className="pick-grid">
            {SCENARIOS.map((s) => (
              <button key={s.id} type="button" className="pick-tile" disabled={!!busy}
                onClick={() => scenario(s.id)}>
                <span>{s.label}</span>
                <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>{s.hint}</span>
              </button>
            ))}
          </div>
          <p className="sub">{t(lang, 'demoScenarioHint')}</p>
        </div>
      </Card>

      <Card title={t(lang, 'demoActiveTitle')} sub={t(lang, 'demoActiveSub')}
        actions={<button type="button" className="btn ghost sm" onClick={reset}>{t(lang, 'demoReset')}</button>}>
        {!alerts ? <p className="mono">{t(lang, 'checking')}</p>
          : alerts.length === 0 ? <p className="sub">{t(lang, 'demoEmpty')}</p>
            : <div className="demo-list">
              {[...alerts].reverse().map((a) => (
                <AlertRow key={a.id} alert={a} onAction={action} onRelay={relay}
                  onSeed={seed} onNotify={notify} />
              ))}
            </div>}
      </Card>

      <Card title={t(lang, 'demoCreateTitle')} sub={t(lang, 'demoCreateSub')}>
        <form onSubmit={create} className="demo-form">
          <label>{t(lang, 'demoFTitle')}
            <input value={form.title} required
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label>{t(lang, 'demoFHazard')}
            <input value={form.hazard}
              onChange={(e) => setForm({ ...form, hazard: e.target.value })} />
          </label>
          <label>{t(lang, 'demoFSeverity')}
            <select value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>{t(lang, 'district')}
            <input value={form.district} required
              onChange={(e) => setForm({ ...form, district: e.target.value })} />
          </label>
          <label>{t(lang, 'demoFPre')} ({t(lang, 'demoMin')})
            <input type="number" step="0.1" min="0" value={form.pre_min}
              onChange={(e) => setForm({ ...form, pre_min: Number(e.target.value) })} />
          </label>
          <label>{t(lang, 'demoFStart')} ({t(lang, 'demoMin')})
            <input type="number" step="0.1" min="0" value={form.start_min}
              onChange={(e) => setForm({ ...form, start_min: Number(e.target.value) })} />
          </label>
          <label>{t(lang, 'demoFEnd')} ({t(lang, 'demoMin')})
            <input type="number" step="0.1" min="0.1" value={form.end_min}
              onChange={(e) => setForm({ ...form, end_min: Number(e.target.value) })} />
          </label>
          <label className="span2">{t(lang, 'demoFInstruction')}
            <textarea rows={2} value={form.instruction}
              onChange={(e) => setForm({ ...form, instruction: e.target.value })} />
          </label>
          <button className="btn" type="submit" disabled={!!busy}>
            <Icon name="bell" size={14} /> {t(lang, 'demoCreateGo')}
          </button>
        </form>
      </Card>
    </>
  );
}
