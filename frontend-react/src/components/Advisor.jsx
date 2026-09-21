// Advisor — the personalized advisory engine, fully wired.
//
// One weather situation, different actionable advice per user type, grounded in
// the SAME backend verdict the Alerts page renders (advisory_for reads the
// verdict, never an LLM guess). All ten user types the pitch names are served;
// occupational personas carry the mandatory general-guidance caveat; every
// card can be heard aloud or asked about in the chat.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { Card } from './ui';
import Icon from './icons';
import WeatherBasis from './WeatherBasis';
import { splitAdvisory, bulletize } from '../format';

// Every user type the product serves — the pitch's "one platform, many users".
// Keep in sync with advisory_service._NO_WARN keys (backend decides wording).
// Exported: the picker grid now lives in SettingsPanel (your profile); this
// module keeps AdviceCard for Advisory itself.
export const USER_TYPES = [
  { id: 'general', icon: 'user', key: 'utGeneral' },
  { id: 'farmer', icon: 'crop', key: 'utFarmer' },
  { id: 'driver', icon: 'truck', key: 'utDriver' },
  { id: 'fisherman', icon: 'fish', key: 'utFisherman' },
  { id: 'aviation', icon: 'send', key: 'utAviation' },
  { id: 'commuter', icon: 'route', key: 'utCommuter' },
  { id: 'employee', icon: 'monitor', key: 'utEmployee' },
  { id: 'outdoor-worker', icon: 'sun', key: 'utOutdoor' },
  { id: 'student', icon: 'file', key: 'utStudent' },
  { id: 'researcher', icon: 'chart', key: 'utResearch' },
  { id: 'disaster_manager', icon: 'shield', key: 'utDisaster' },
];

// The picker card itself: a tap calls onPick(ut.id), and the Settings grid
// wires onPick to the store's setPersona — "a card tap sets the role for the
// whole app". Exported so SettingsPanel can render the identical picker
// without duplicating it. The advice body below belongs to AdviceCard.
export function RoleCard({ ut, active, onPick }) {
  const { lang } = useApp();
  return (
    <button
      type="button"
      className={`role-card${active ? ' is-active' : ''}`}
      data-user={ut.id}
      onClick={() => onPick(ut.id)}
      aria-pressed={active}
    >
      <span className="tile-icon" aria-hidden="true"><Icon name={ut.icon} size={22} /></span>
      <span className="rc-label">{t(lang, ut.key)}</span>
      {active && <span className="rc-you">{t(lang, 'utYou')}</span>}
    </button>
  );
}

function AdviceCard({ ut, active, onPick }) {
  const { lang, loc, speak, setView, setPendingAsk, syncTick } = useApp();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  // Only the selected persona fetches; the grid stays light and the advice the
  // user sees is always for the type they actually picked.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    api.profileAdvisory(loc, ut.id, lang)
      .then((d) => { if (alive) { setData(d); setErr(false); } })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [active, ut.id, loc, lang, syncTick]);

  const split = data && !err ? splitAdvisory(data.advisory) : null;
  // Bullets, not paragraphs: the detail half renders as at most five short
  // points. The lead stays one line on top.
  const bullets = split && split.detail ? bulletize(split.detail, 5) : [];
  return (
    <>
      <RoleCard ut={ut} active={active} onPick={onPick} />
      {active && (
        <div className="adv-body" role="status">
          {!data && !err ? <span className="mono">{t(lang, 'checking')}</span>
            : err ? <span className="sub">{t(lang, 'adviceFailed')}</span>
              : <>
                <div className="adv-lead">{split.lead}</div>
                {/* The occupation-specific half of the advisory: short bullet
                    points, never a wall of text. */}
                {bullets.length > 0 && (
                  <ul className="adv-bullets">
                    {bullets.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                )}
                {/* The weather the advice was grounded in (observed numbers +
                    provenance), or the honest unavailable line. Facts only. */}
                <WeatherBasis basis={data.weather_basis} alertCount={data.relevant_alerts} lang={lang} />
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button type="button" className="btn btn-ghost sm"
                    onClick={() => speak(data.advisory)}>
                    <Icon name="speaker" size={14} /> {t(lang, 'alertsListen')}
                  </button>
                  <button type="button" className="btn btn-ghost sm"
                    onClick={() => { setPendingAsk(`Explain this advice for a ${ut.id} in ${loc.district}: ${data.advisory}`); setView('home'); }}>
                    {t(lang, 'homeAskAbout')}
                  </button>
                </div>
                {(data.caveat || data.provenance) && (
                  <p className="sub" style={{ marginTop: 4 }}>
                    {data.caveat} {data.provenance && <span className="mono"> · {data.provenance}</span>}
                  </p>
                )}
              </>}
        </div>
      )}
    </>
  );
}

export default function Advisor() {
  const { lang, persona, setPersona, setView } = useApp();
  // The open card IS the profile — never a private copy of it. Holding it in
  // local state (`useState(persona)`) meant a profile switch from the top bar
  // left the previous card open, so its advice stayed on screen and no fetch
  // ran for the new profile. A reload re-initialised that state from `persona`,
  // which is exactly why a manual refresh appeared to "fix" it.
  //
  // The picker grid moved to Settings (your profile). Advisory reads the
  // stored persona and renders its advice; when unset it says so plainly and
  // links to Settings — never picks a role silently.
  const activeType = USER_TYPES.find((ut) => ut.id === persona);
  return (
    <Card title={t(lang, 'advTitle')} sub={t(lang, 'advSub')}>
      {activeType ? (
        <AdviceCard key={activeType.id} ut={activeType} active onPick={setPersona} />
      ) : (
        <div className="honesty-note" role="note" style={{ marginBottom: 10 }}>
          <p style={{ margin: '0 0 8px' }}>{t(lang, 'roleNotSet')}</p>
          <button type="button" className="btn btn-ghost sm" onClick={() => setView('settings')}>
            {t(lang, 'locOpenSettings')}
          </button>
        </div>
      )}
      <p className="sub" style={{ marginTop: 8 }}>{t(lang, 'advNote')}</p>
    </Card>
  );
}
