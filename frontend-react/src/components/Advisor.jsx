// Advisor — the personalized advisory engine, fully wired.
//
// This was the empty section in Round 1. It is now the honest version of the
// pitch: one weather situation, different actionable advice per user type,
// grounded in the SAME backend verdict the Alerts page renders (advisory_for
// reads the verdict, never an LLM guess). All ten user types the pitch names
// are served; occupational personas carry the mandatory general-guidance
// caveat; every card can be heard aloud or asked about in the chat.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { Card } from './ui';
import Icon from './icons';
import { splitAdvisory } from '../format';

// Every user type the product serves — the pitch's "one platform, many users".
// Keep in sync with advisory_service._NO_WARN keys (backend decides wording).
const USER_TYPES = [
  { id: 'general', icon: 'user', key: 'utGeneral' },
  { id: 'farmer', icon: 'crop', key: 'utFarmer' },
  { id: 'driver', icon: 'truck', key: 'utDriver' },
  { id: 'fisherman', icon: 'fish', key: 'utFisherman' },
  { id: 'commuter', icon: 'route', key: 'utCommuter' },
  { id: 'employee', icon: 'monitor', key: 'utEmployee' },
  { id: 'outdoor-worker', icon: 'sun', key: 'utOutdoor' },
  { id: 'student', icon: 'file', key: 'utStudent' },
  { id: 'researcher', icon: 'chart', key: 'utResearch' },
  { id: 'disaster_manager', icon: 'shield', key: 'utDisaster' },
];

function AdviceCard({ ut, active, onPick }) {
  const { lang, loc, persona, speak, setView, setPendingAsk, syncTick } = useApp();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  // Only the selected persona fetches; the grid stays light and the advice the
  // user sees is always for the type they actually picked.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    // Initialize err to false at render time (derived state) instead of in effect
    // This avoids the set-state-in-effect lint warning
    api.profileAdvisory(loc, ut.id, lang)
      .then((d) => { if (alive) { setData(d); setErr(false); } })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [active, ut.id, loc, lang, syncTick]);

  const split = data && !err ? splitAdvisory(data.advisory) : null;
  const isMine = persona === ut.id;
  return (
    <div className={`adv-card${isMine ? ' is-mine' : ''}`} data-user={ut.id}>
      <button type="button" className="adv-head" onClick={() => onPick(ut.id)} aria-expanded={active}>
        <span className="adv-tile" aria-hidden="true"><Icon name={ut.icon} size={22} /></span>
        <span className="adv-head-text">
          <span className="eyebrow">{t(lang, 'advEyebrow')}</span>
          <b className="adv-head-title">{t(lang, ut.key)}</b>
        </span>
        {isMine && <span className="chip">{t(lang, 'utYou')}</span>}
      </button>
      {active && (
        <div className="adv-body" role="status">
          {!data && !err ? <span className="mono">{t(lang, 'checking')}</span>
            : err ? <span className="sub">{t(lang, 'adviceFailed')}</span>
              : <>
                <div className="adv-lead">{split.lead}</div>
                {/* Same reason as ProfileAdvice: the occupation-specific half
                    of the advisory must be on screen, not behind a tap. */}
                {split.detail && <p className="sub">{split.detail}</p>}
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button type="button" className="btn ghost sm"
                    onClick={() => speak(data.advisory)}>
                    <Icon name="speaker" size={14} /> {t(lang, 'alertsListen')}
                  </button>
                  <button type="button" className="btn ghost sm"
                    onClick={() => { setPendingAsk(`Explain this advice for a ${ut.id} in ${loc.district}: ${data.advisory}`); setView('ask'); }}>
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
    </div>
  );
}

export default function Advisor() {
  const { lang, persona, setPersona } = useApp();
  // The open card IS the profile — never a private copy of it. Holding it in
  // local state (`useState(persona)`) meant a profile switch from the top bar
  // left the previous card open, so its advice stayed on screen and no fetch
  // ran for the new profile. A reload re-initialised that state from `persona`,
  // which is exactly why a manual refresh appeared to "fix" it.
  return (
    <Card title={t(lang, 'advTitle')} sub={t(lang, 'advSub')}>
      {/* The consequence, stated once: a card tap sets the role for the whole
          app — Home, Ask and My advice all follow it. */}
      <p className="sub" style={{ marginBottom: 8 }}><Icon name="person" size={14} /> {t(lang, 'advSwitchNote')}</p>
      <div className="adv-grid" data-tour="persona-grid">
        {USER_TYPES.map((ut) => (
          <AdviceCard key={ut.id} ut={ut} active={persona === ut.id} onPick={setPersona} />
        ))}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>{t(lang, 'advNote')}</p>
    </Card>
  );
}
