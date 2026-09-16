// The seven console views. Each is a thin composition of feature components -
// all fetching, validation and safety logic stays inside those components.
import { t } from './i18n';
import { useApp } from './store';
import { Card } from './components/ui';
import Situation from './components/Situation';
import GapHero from './components/GapHero';
import Pipeline from './components/Pipeline';
import ChatPanel from './components/ChatPanel';
import VoicePanel from './components/VoicePanel';
import EvidencePanel from './components/EvidencePanel';
import AlertCenter from './components/AlertCenter';
import Emergency from './components/Emergency';
import { ModelsPanel, ClimatePanel } from './components/DataPanels';
import SafetyPanel from './components/SafetyPanel';
import Manager from './components/Manager';
import SourceStrip from './components/SourceStrip';
import ViewHead from './components/ViewHead';

export function SituationView() {
  return (
    <>
      <ViewHead titleKey="navSituation" subKey="viewSituationSub" />
      <Situation />
      <GapHero />
      <Pipeline />
    </>
  );
}

export function AskView() {
  return (
    <>
      <ViewHead titleKey="viewAsk" subKey="viewAskSub" />
      <div className="grid-2">
        <ChatPanel />
        <VoicePanel />
      </div>
    </>
  );
}

export function EvidenceView() {
  return (
    <>
      <ViewHead titleKey="viewEvidence" subKey="viewEvidenceSub" />
      <EvidencePanel />
      <Manager />
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

export function ClimateView() {
  return (
    <>
      <ViewHead titleKey="viewClimate" subKey="viewClimateSub" />
      <div className="grid-2">
        <ModelsPanel />
        <ClimatePanel />
      </div>
    </>
  );
}

export function TrustView() {
  const { lang } = useApp();
  return (
    <>
      <ViewHead titleKey="viewTrust" subKey="viewTrustSub" />
      <SafetyPanel />
      <Card
        title={t(lang, 'tag')}
        sub="Every source reports its own status. Nothing is labelled LIVE unless it is."
      >
        <SourceStrip refreshKey={0} />
      </Card>
    </>
  );
}
