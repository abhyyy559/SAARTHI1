import { t } from '../i18n';
import { useApp } from '../store';

/**
 * The single <h1> for the active view. Every other heading in the app is an h2,
 * so the document always has exactly one top-level heading (a11y).
 */
export default function ViewHead({ titleKey, subKey }) {
  const { lang } = useApp();
  return (
    <div className="view-head">
      <h1 className="view-title">{t(lang, titleKey)}</h1>
      <p className="view-sub">{t(lang, subKey)}</p>
    </div>
  );
}
