// Home — one screen, one job: ask about it first.
//
//   1. Ask, the hero (Agent 3's HomeChat) — the flagship, the first thing the
//      eye hits and the largest element on the screen.
//   2. HomeHero — the safety-critical current-conditions verdict readout,
//      compact and subordinate to Ask.
//
// Alert mentions live in exactly one place: the global AlertOverlay (a slim
// pill over every page, only while alerts are active). Home carries no
// per-page alert block — the old WarningTeasers section was removed so the
// alert is never repeated page after page. The old dispatch strip, action
// tiles and separate Ask page are gone (IA dedup): the district stamp lives
// in the topbar and the hero; navigation lives in the tab bar. Advice never
// appears here — it lives in Advisory.
import { t } from '../i18n';
import { useApp } from '../store';
import HomeHero from './HomeHero';
import HomeChat from './HomeChat';
import AviationBriefing from './AviationBriefing';

export default function Home() {
  const { lang, persona, loc, speak, stopSpeaking, speechState, netState, setView, setListenState } = useApp();
  return (
    <div className="home-stack">
      <section aria-label={t(lang, 'heroAskAnything')} className="home-chat">
        {/* Ask is the hero of Home: it mounts FIRST, above the verdict card.
            Identity resets with lang/role/district so a new context never
            inherits the old one's answers. The location prompt renders once,
            inside HomeHero next to the place row — never duplicated here. */}
        <HomeChat
          key={`chat:${lang}:${persona}:${loc.district}`}
          lang={lang}
          persona={persona}
          loc={loc}
          speak={speak}
          stopSpeaking={stopSpeaking}
          speechState={speechState}
          netState={netState}
          onOpenAdvisory={() => setView('advisory')}
          onVoiceState={setListenState}
        />
      </section>
      {/* The verdict readout stays — safety-critical — but compact and
          subordinate, below Ask. */}
      <HomeHero />
      {/* Aviation is a profile, not a menu: the briefing lives on the
          dashboard itself when the aviation profile is active. */}
      {persona === 'aviation' && (
        <section aria-label={t(lang, 'utAviation')} className="home-aviation">
          <AviationBriefing />
        </section>
      )}
    </div>
  );
}
