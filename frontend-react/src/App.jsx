import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AppCtx, readPref, useApp, writePref } from './lib/appState';
import { useOnline } from './lib/useData';
import { LANGS, t } from './lib/i18n';
import { stopSpeaking } from './lib/voice';
import { Icon } from './components/Icons';
import Backdrop from './components/Backdrop';
import Setup, { LangPicker, PlacePicker, RoleGrid } from './components/Setup';
import { SosButton } from './components/Sos';
import Sources from './components/Sources';
import { AutoSpeakToggle, PushToggle, ThemeToggle, applyTheme } from './components/Toggles';
import { pushSync } from './lib/push';
import Landing from './screens/Landing';
import Today from './screens/Today';
import Ask from './screens/Ask';
import Alerts from './screens/Alerts';
import Share from './screens/Share';
import { Skeleton } from './components/ui';

// Leaflet is ~150 KB: load the Map screen only when it is opened.
const MapScreen = lazy(() => import('./screens/MapScreen'));

const TABS = [
  { id: 'today', icon: 'home', key: 'tabToday', View: Today },
  { id: 'ask', icon: 'mic', key: 'tabAsk', View: Ask },
  { id: 'alerts', icon: 'bell', key: 'tabAlerts', View: Alerts },
  { id: 'map', icon: 'globe', key: 'tabMap', View: MapScreen },
  { id: 'share', icon: 'qr', key: 'tabShare', View: Share },
];

function Settings({ onClose }) {
  const { lang } = useApp();
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={t(lang, 'settings')} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2><Icon name="gear" size={22} /> {t(lang, 'settings')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'done')}><Icon name="close" size={24} /></button>
        </div>
        <h3><Icon name="globe" size={18} /> {t(lang, 'language')}</h3>
        <LangPicker />
        <h3><Icon name="pin" size={18} /> {t(lang, 'place')}</h3>
        <PlacePicker onPicked={onClose} />
        <h3><Icon name="user" size={18} /> {t(lang, 'role')}</h3>
        <RoleGrid />
        <h3><Icon name="bell" size={18} /> {t(lang, 'tabAlerts')}</h3>
        <PushToggle />
        <AutoSpeakToggle />
        <ThemeToggle />
        <h3><Icon name="info" size={18} /> {t(lang, 'sourcesTitle')}</h3>
        <Sources />
        <p className="credits">
          {t(lang, 'credits')}: Font made from <a href="https://www.onlinewebfonts.com/fonts" target="_blank" rel="noreferrer">Web Fonts</a> is
          licensed by CC BY 4.0 · Geist Pixel, Inter, Noto (SIL OFL 1.1) · Map © OpenStreetMap contributors · Places: GeoNames (CC BY 4.0)
        </p>
        <button type="button" className="btn-big" onClick={onClose}><Icon name="check" size={24} /> {t(lang, 'done')}</button>
      </div>
    </div>
  );
}

export default function App() {
  const [lang, setLangState] = useState(() => readPref('lang', 'en'));
  const [persona, setPersonaState] = useState(() => readPref('persona', null));
  const [loc, setLocState] = useState(() => readPref('loc', null));
  // Up to 5 places (home village, where family works...), newest first.
  const [places, setPlaces] = useState(() => readPref('places', null) || (readPref('loc', null) ? [readPref('loc', null)] : []));
  const [setupDone, setSetupDone] = useState(() => !!(readPref('loc') && readPref('persona')));
  const [tab, setTab] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const v = p.get('tab') || p.get('view'); // push taps open /?view=alerts
    return TABS.some((x) => x.id === v) ? v : 'today';
  });
  // landing | setup | app. First run opens on the landing; returning users
  // go straight to Today (a safety app must not make them tap through a
  // splash). The logo brings the landing back; ?landing=1 forces it.
  const [view, setView] = useState(() => {
    const forced = new URLSearchParams(window.location.search).get('landing') === '1';
    return forced || !setupDone ? 'landing' : 'app';
  });
  const [pendingQuestion, setPending] = useState(null);
  const [settings, setSettings] = useState(false);
  const online = useOnline();

  const setLang = useCallback((v) => { setLangState(v); writePref('lang', v); }, []);
  const setPersona = useCallback((v) => { setPersonaState(v); writePref('persona', v); }, []);
  const setLoc = useCallback((v) => {
    setLocState(v);
    writePref('loc', v);
    setPlaces((list) => {
      const next = [v, ...list.filter((p) => !(p.district === v.district && p.state === v.state))].slice(0, 5);
      writePref('places', next);
      return next;
    });
  }, []);
  const askAbout = useCallback((q) => { setPending(q); setTab('ask'); }, []);
  const clearPending = useCallback(() => setPending(null), []);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { applyTheme(readPref('theme', 'dark')); }, []);
  useEffect(() => { stopSpeaking(); window.scrollTo(0, 0); }, [tab, view]);
  useEffect(() => {
    if (loc) pushSync({ district: loc.district, state: loc.state, lat: loc.lat, lon: loc.lon, language: lang, persona: persona || 'general' });
  }, [loc, lang, persona]);

  const ctx = useMemo(() => ({
    lang, setLang, persona: persona || 'general', personaChosen: !!persona, setPersona, loc, setLoc, places,
    pendingQuestion, clearPending, askAbout,
  }), [lang, setLang, persona, setPersona, loc, setLoc, places, pendingQuestion, clearPending, askAbout]);

  const ready = setupDone && !!loc;
  const enter = (nextTab) => {
    if (nextTab) setTab(nextTab);
    setView(ready ? 'app' : 'setup');
  };

  let body;
  if (view === 'landing') {
    body = <Landing ready={ready} onStart={() => enter()} onNav={(id) => enter(id)} />;
  } else if (view === 'setup' || !ready) {
    body = <Setup onDone={() => { setSetupDone(true); setView('app'); }} />;
  } else {
    const Active = (TABS.find((x) => x.id === tab) || TABS[0]).View;
    const langGlyph = (LANGS.find((l) => l.id === lang) || LANGS[0]).glyph;
    body = (
      <div className="app">
        <header className="top">
          <button type="button" className="logo logo-sm" onClick={() => setView('landing')} aria-label={t(lang, 'navHome')}>
            <Icon name="partly" size={40} />
          </button>
          {/* One nav: the white pill in this header on desktop, the bottom tab bar on phones. */}
          <nav className="tabs" aria-label="WeatherGPT">
            {TABS.map((x) => (
              <button key={x.id} type="button" className={`tab ${tab === x.id ? 'is-on' : ''}`}
                aria-current={tab === x.id ? 'page' : undefined} onClick={() => setTab(x.id)}>
                <Icon name={x.icon} size={26} />
                <span>{t(lang, x.key)}</span>
              </button>
            ))}
          </nav>
          <button type="button" className="place-chip" onClick={() => setSettings(true)} aria-label={t(lang, 'place')}>
            <Icon name="pin" size={18} /> <b>{loc.district}</b>
          </button>
          <div className="top-right">
            {!online ? <span className="net-off" title={t(lang, 'offline')}><Icon name="offline" size={22} /></span> : null}
            <SosButton />
            <button type="button" className="icon-btn lang-btn" onClick={() => setSettings(true)} aria-label={t(lang, 'language')}>{langGlyph}</button>
            <button type="button" className="icon-btn" onClick={() => setSettings(true)} aria-label={t(lang, 'settings')}><Icon name="gear" size={22} /></button>
          </div>
        </header>
        {!online ? <div className="offline-bar"><Icon name="offline" size={18} /> {t(lang, 'offline')}</div> : null}
        <main key={`${tab}-${loc.district}`}>
          <Suspense fallback={<div className="screen"><Skeleton h={420} /></div>}>
            <Active />
          </Suspense>
        </main>
        {settings ? <Settings onClose={() => setSettings(false)} /> : null}
      </div>
    );
  }

  // The video backdrop stays mounted across views, so it keeps playing from
  // the landing into the app; the app screens get a darker veil.
  return (
    <AppCtx.Provider value={ctx}>
      <Backdrop dim={view !== 'landing'} />
      {body}
    </AppCtx.Provider>
  );
}
