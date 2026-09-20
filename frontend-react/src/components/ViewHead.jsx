import { t } from '../i18n';
import { useApp } from '../store';
import { NAV } from '../i18n';

/**
 * The single <h1> for the active view. Every other heading in the app is an h2,
 * so the document always has exactly one top-level heading (a11y).
 * HARBOUR SIGNAL: the nav kicker is rendered ONLY when it adds genuinely
 * different information from the h1 — no duplicated text.
 */
export default function ViewHead({ titleKey, subKey }) {
  const { lang, view } = useApp();
  const nav = NAV.find((n) => n.id === view);
  const navLabel = nav ? t(lang, nav.label) : '';
  const h1 = t(lang, titleKey);
  const showKicker = navLabel && navLabel.trim().toLowerCase() !== h1.trim().toLowerCase();
  return (
    <div className="view-head">
      {showKicker && <div className="vh-kicker kicker">{navLabel}</div>}
      <h1 className="vh-h1">{h1}</h1>
      {subKey && <p className="sub vh-sub">{t(lang, subKey)}</p>}
    </div>
  );
}
