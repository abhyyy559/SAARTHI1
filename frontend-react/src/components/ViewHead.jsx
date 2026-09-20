import { t } from '../i18n';
import { useApp } from '../store';
import { NAV } from '../i18n';

/**
 * The single <h1> for the active view. Every other heading in the app is an h2,
 * so the document always has exactly one top-level heading (a11y).
 * SIGNAL BOARD: a small uppercase kicker (the section name) over a condensed
 * banner headline.
 */
export default function ViewHead({ titleKey, subKey }) {
  const { lang, view } = useApp();
  const nav = NAV.find((n) => n.id === view);
  return (
    <div className="view-head">
      <div className="vh-kicker">
        <span className="kicker">{nav ? t(lang, nav.label) : t(lang, titleKey)}</span>
      </div>
      <h1 className="vh-h1">{t(lang, titleKey)}</h1>
      {subKey && <p className="sub vh-sub">{t(lang, subKey)}</p>}
    </div>
  );
}
