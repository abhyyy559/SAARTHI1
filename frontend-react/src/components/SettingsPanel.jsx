// Settings — one screen, four things, all icon-led. Role and place rows
// POINT at their single homes (Advisory grid / Home hero chips) instead of
// duplicating those pickers here; GPS re-detect, language and the alerts
// toggle stay unique to this screen.
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import { Card } from './ui';

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
  const { lang, setLang, setView, requestLocation, locStatus, notifyOn, toggleNotify } = useApp();
  return (
    <div className="set-stack">
      {/* One-picker rule (IA dedup): the role grid lives in Advisory and the
          district chips live on the Home hero. Settings used to duplicate
          both, so the same control appeared in three places. Each row now
          points at its single home instead of repeating the picker. */}
      <Row icon="user" title={t(lang, 'setRole')}>
        <p className="sub" style={{ margin: '0 0 8px' }}>{t(lang, 'setRoleNote')}</p>
        <button type="button" className="btn btn-ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setView('advisory')}>
          {t(lang, 'setRoleGo')} <Icon name="chevron" size={14} aria-hidden="true" />
        </button>
      </Row>

      <Row icon="pin" title={t(lang, 'setPlace')}>
        <div className="chip-grid" role="group" aria-label={t(lang, 'setPlace')}>
          <button type="button" className="role-chip" onClick={requestLocation} disabled={locStatus === 'requesting' || locStatus === 'resolving'}>
            <Icon name="search" size={24} aria-hidden="true" />
            <span>{t(lang, 'useMyLocation')}</span>
          </button>
        </div>
        <p className="sub" style={{ margin: '6px 0 0' }}>{t(lang, 'setPlaceNote')}</p>
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
      </Row>
    </div>
  );
}
