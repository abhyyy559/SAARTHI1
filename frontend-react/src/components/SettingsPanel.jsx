// Settings — one screen, four things, all icon-led. A non-reader can set
// their world by tapping pictures: role (livelihood icons), place (pin +
// district chips), language (script chips), alerts (bell switch).
import { t, DISTRICTS } from '../i18n';
import { useApp } from '../store';
import { pushReasonKey } from '../notify';
import Icon from './icons';
import { Card } from './ui';

const ROLES = [
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

function Row({ icon, title, children }) {
  return (
    <Card>
      <div className="set-row-head">
        <span className="tile-icon" aria-hidden="true"><Icon name={icon} size={22} /></span>
        <b>{title}</b>
      </div>
      <div className="set-row-body">{children}</div>
    </Card>
  );
}

export default function SettingsPanel() {
  const { lang, setLang, persona, setPersona, loc, setDistrict, requestLocation, locStatus, notifyOn, toggleNotify, pushMode, pushReason } = useApp();
  // Honest push state under the switch: background-ready vs in-app-only (with
  // the reason) vs off. icon+word, never colour alone.
  const pushNote = pushMode === 'background'
    ? { icon: 'bell', text: t(lang, 'setPushBg') }
    : pushMode === 'inapp'
      ? {
          icon: 'info',
          text: t(lang, 'setPushInAppWhy').replace('{reason}', t(lang, pushReasonKey(pushReason))),
        }
      : null;
  return (
    <div className="set-stack">
      <Row icon="user" title={t(lang, 'setRole')}>
        <div className="chip-grid" role="group" aria-label={t(lang, 'setRole')}>
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`role-chip${persona === r.id ? ' is-active' : ''}`}
              aria-pressed={persona === r.id}
              onClick={() => setPersona(persona === r.id ? null : r.id)}
            >
              <Icon name={r.icon} size={24} aria-hidden="true" />
              <span>{t(lang, r.key)}</span>
            </button>
          ))}
        </div>
      </Row>

      <Row icon="pin" title={t(lang, 'setPlace')}>
        <div className="chip-grid" role="group" aria-label={t(lang, 'setPlace')}>
          <button type="button" className="role-chip" onClick={requestLocation} disabled={locStatus === 'requesting' || locStatus === 'resolving'}>
            <Icon name="search" size={24} aria-hidden="true" />
            <span>{t(lang, 'useMyLocation')}</span>
          </button>
          {DISTRICTS.map((d) => (
            <button
              key={d.district}
              type="button"
              className={`role-chip${loc.district === d.district ? ' is-active' : ''}`}
              aria-pressed={loc.district === d.district}
              onClick={() => setDistrict(d)}
            >
              <Icon name="pin" size={24} aria-hidden="true" />
              <span>{d.district}</span>
            </button>
          ))}
        </div>
      </Row>

      <Row icon="translate" title={t(lang, 'setLanguage')}>
        <div className="segmented langseg" role="group" aria-label={t(lang, 'setLanguage')}>
          {['en', 'hi', 'te'].map((l) => (
            <button key={l} type="button" className={`seg-opt${lang === l ? ' is-active' : ''}`} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l === 'en' ? 'EN' : l === 'hi' ? 'हिं' : 'తె'}
            </button>
          ))}
        </div>
      </Row>

      <Row icon="bell" title={t(lang, 'setAlerts')}>
        <button type="button" role="switch" aria-checked={!!notifyOn} className="switch-row" onClick={toggleNotify}>
          <span className="sub">{t(lang, 'setAlertsSub')}</span>
          <span className={`switch${notifyOn ? ' is-on' : ''}`} aria-hidden="true">
            <span className="switch-track"><span className="switch-thumb" /></span>
          </span>
        </button>
        {pushNote && (
          <div className="sub" role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Icon name={pushNote.icon} size={14} aria-hidden="true" />
            <span>{pushNote.text}</span>
          </div>
        )}
      </Row>
    </div>
  );
}
