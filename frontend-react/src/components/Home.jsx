// Home — one screen, one job: what's happening, and ask about it.
//
//   1. HomeHero — the wow: giant sky icon, severity dial, one-line impact.
//   2. The conversation (Agent 3's HomeChat) — the old Ask route lives here now.
//   3. Warning teasers — today's warnings as compact rows into the Alerts route.
//
// The old dispatch strip, action tiles and separate Ask page are gone (IA
// dedup): the district stamp lives in the topbar and the hero; navigation
// lives in the tab bar. Advice never appears here — it lives in Advisory.
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { api } from '../api';
import { useApp } from '../store';
import { minutesSince, isExpired } from '../format';
import Icon from './icons';
import LocationPrompt from './LocationPrompt';
import HomeHero from './HomeHero';
import HomeChat from './HomeChat';
import AviationBriefing from './AviationBriefing';

import { sevWord } from './ui';

// Compact warning teasers: icon + severity word + one line, tap → Alerts.
function WarningTeasers() {
  const { lang, loc, setView, setSelectedAlert, syncTick } = useApp();
  const [items, setItems] = useState([]);
  const locKey = `${loc.district}|${loc.lat}|${loc.lon}`;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    api.warnings(loc.district, loc.lat, loc.lon)
      .then((d) => {
        if (!alive) return;
        const out = [];
        if (d && d.warning && !isExpired(d.warning.valid_until, nowMs)) {
          out.push({ ...d.warning, headline: d.warning.message || d.warning.hazard, kind: 'official' });
        }
        for (const a of (d && d.cap_alerts) || []) {
          if (!isExpired(a.valid_until || a.expires, nowMs)) out.push({ ...a, kind: 'official' });
        }
        setItems(out.slice(0, 3));
      })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [locKey, loc.district, loc.lat, loc.lon, syncTick, nowMs]);

  if (items.length === 0) return null;
  return (
    <section aria-label={t(lang, 'navAlerts')} className="teasers">
      <div className="alert-sec-title">
        <h2 className="display"><Icon name="alert" size={20} aria-hidden="true" /> {t(lang, 'navAlerts')}</h2>
        <button type="button" className="btn btn-ghost sm" onClick={() => setView('alerts')}>
          {t(lang, 'hAlertsGo')} <Icon name="chevron" size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="teaser-list">
        {items.map((a, i) => {
          const sev = a.severity || 'UNKNOWN';
          const head = (a.headline || a.message || a.hazard || a.event || '').trim();
          return (
            <button
              key={a.identifier || a.id || i}
              type="button"
              className="teaser-row"
              data-sev={sev}
              onClick={() => { setSelectedAlert(a); setView('alerts'); }}
            >
              <span className="sev-bar" aria-hidden="true" />
              <span className="teaser-icon" aria-hidden="true">
                <Icon name={sev === 'LOW' ? 'check' : sev === 'UNKNOWN' ? 'help' : 'alert'} size={22} />
              </span>
              <span className="teaser-body">
                <span className="sev-stamp">{sevWord(lang, sev)}</span>
                <span className="teaser-head">{head}</span>
                <span className="teaser-meta">
                  {a.issued_at && minutesSince(a.issued_at, nowMs) != null
                    ? t(lang, 'agoPattern').replace('{m}', minutesSince(a.issued_at, nowMs)) : ''}
                </span>
              </span>
              <Icon name="chevron" size={18} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function Home() {
  const { lang, persona, loc, locReady, speak, stopSpeaking, speechState, netState, setView, setListenState } = useApp();
  return (
    <div className="home-stack">
      {!locReady && <LocationPrompt />}
      <HomeHero />
      {/* Aviation is a profile, not a menu: the briefing lives on the
          dashboard itself when the aviation profile is active. */}
      {persona === 'aviation' && (
        <section aria-label={t(lang, 'utAviation')} className="home-aviation">
          <AviationBriefing />
        </section>
      )}
      <section aria-label={t(lang, 'heroAskAnything')} className="home-chat">
        {/* Agent 3's conversation: identity resets with lang/role/district so a
            new context never inherits the old one's answers. */}
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
      <WarningTeasers />
    </div>
  );
}
