// Floating quick actions — two round shortcuts stacked above the SOS FAB on
// the right side, on every view. Notifications reuses the shell's
// 'wgpt:notifications-open' event (the one and only notifications home);
// alerts routes to the Alerts view. Harbour Signal: 2px ink border, icon-only
// at render size with icon + word on aria-label/title.
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';
import './QuickActions.css';

export default function QuickActions() {
  const { lang, setView } = useApp();
  const openNotifications = () => window.dispatchEvent(new CustomEvent('wgpt:notifications-open'));
  const goAlerts = () => setView('alerts');
  return (
    <nav className="quick-actions" aria-label={t(lang, 'qaActions')}>
      <button
        type="button"
        className="qa-btn"
        title={t(lang, 'qaNotifications')}
        aria-label={t(lang, 'qaNotifications')}
        onClick={openNotifications}
      >
        <Icon name="bell" size={22} />
      </button>
      <button
        type="button"
        className="qa-btn"
        title={t(lang, 'qaAlerts')}
        aria-label={t(lang, 'qaAlerts')}
        onClick={goAlerts}
      >
        <Icon name="alert" size={22} />
      </button>
    </nav>
  );
}
