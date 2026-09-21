// Offline & P2P view — Agent 4 (IA).
// The whole route is Agent 2's OfflineP2P panel: connection state, everything
// this phone knows with no internet, queued questions, offline transition
// evaluation, and the simulated phone-to-phone relay (SIMULATED stamp always
// on). Mounted here in the More sheet per the agent2-integration contract.
import { api } from '../api';
import { useApp } from '../store';
import { readCache } from '../offline';
import OfflineP2P from './OfflineP2P';
import ViewHead from './ViewHead';

export default function OfflineView() {
  // Worker 5 (offline + P2P testability): simOffline/setSimOffline come from
  // the store's built-in offline simulator (api.js setOfflineSim actually cuts
  // the network path, not just relabels the screen). The panel owns the
  // toggle; the store, Shell and other views are untouched.
  const { lang, loc, offline, demoMode, simOffline, setSimOffline } = useApp();
  // The cached list OfflineP2P evaluates while offline: the last-fetched
  // warning and alert, each stamped with when it was saved, plus any demo
  // alerts the panel snapshotted (they carry the ids the relay picker needs).
  const cache = readCache() || {};
  const alerts = [];
  for (const key of ['warning', 'alert']) {
    const entry = cache[key];
    const item = entry && (entry.warning || entry.alert);
    if (item) alerts.push({ ...item, cached_at: entry.at || null });
  }
  const demoSnap = cache.demo_alerts && cache.demo_alerts.data;
  if (demoSnap && Array.isArray(demoSnap.alerts)) {
    for (const a of demoSnap.alerts) {
      if (a && (a.id || a.alert_id)) alerts.push({ ...a, cached_at: demoSnap.at || null, demo: true });
    }
  }
  return (
    <>
      <ViewHead titleKey="navOffline" subKey="viewOfflineSub" />
      <OfflineP2P
        api={api}
        lang={lang}
        district={loc.district || ''}
        online={!offline}
        alerts={alerts}
        demoMode={demoMode}
        simOffline={!!simOffline}
        onToggleSimOffline={() => setSimOffline(!simOffline)}
      />
    </>
  );
}
