// Three views, fisherman-first: Home (safety + speak/tap to ask), Ask
// (conversation + voice), Alerts (official warnings + resilient SOS network).
// Every former dossier view either became background evidence inside a grounded
// answer or was retired - the product is conversation, speech and alerts.
import Home from './components/Home';
import ChatPanel from './components/ChatPanel';
import VoicePanel from './components/VoicePanel';
import AlertCenter from './components/AlertCenter';
import Emergency from './components/Emergency';
import ViewHead from './components/ViewHead';
import { useApp } from './store';
import { t } from './i18n';
import { Card } from './components/ui';
import SourceStrip from './components/SourceStrip';

export function HomeView() {
  return (
    <>
      <ViewHead titleKey="navHome" subKey="viewHomeSub" />
      <Home />
    </>
  );
}

export function AskView() {
  const { lang, persona, loc } = useApp();
  return (
    <>
      <ViewHead titleKey="viewAsk" subKey="viewAskSub" />
      <div className="grid-2">
        <ChatPanel key={`${lang}:${persona}:${loc.district}`} />
        <VoicePanel key={`${lang}:${persona}:${loc.district}`} />
      </div>
    </>
  );
}

export function AlertsView() {
  return (
    <>
      <ViewHead titleKey="viewAlerts" subKey="viewAlertsSub" />
      <AlertCenter />
      <Emergency />
    </>
  );
}

export function TrustView() {
  const { lang } = useApp();
  return (
    <>
      <ViewHead titleKey="viewTrust" subKey="viewTrustSub" />
      <Card
        title={t(lang, 'tag')}
        sub="Every source reports its own status. Nothing is labelled LIVE unless it is."
      >
        <SourceStrip refreshKey={0} />
      </Card>
    </>
  );
}
