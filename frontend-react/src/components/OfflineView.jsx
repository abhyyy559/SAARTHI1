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
  const { lang, loc, offline, demoMode } = useApp();
  // The cached list OfflineP2P evaluates while offline: the last-fetched
  // warning and alert, each stamped with when it was saved.
  const cache = readCache() || {};
  const alerts = [];
  for (const key of ['warning', 'alert']) {
    const entry = cache[key];
    const item = entry && (entry.warning || entry.alert);
    if (item) alerts.push({ ...item, cached_at: entry.at || null });
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
      />
    </>
  );
}
