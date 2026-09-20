// LocationSwitcher — the prominent district control for SAARTHI.
//
// CONTRACT (for Agent 4 wiring):
//   <LocationSwitcher onChange={(loc) => setLoc(loc)} />
// - `onChange({ district, lat, lon })` fires on every choice (preset or
//   manual), so the store's setLoc can adopt it.
// - The choice is ALSO written directly to localStorage under `wgpt.loc` in
//   the exact shape store.jsx uses ({ district, lat, lon }), so it survives
//   sessions even before Agent 4 wires onChange.
// - Manual lat/lon refines the CURRENT district's position (the sheet copy
//   says so); the backend resolves the true nearest district from the coords
//   on every /weather/warnings call, so alerts stay honest.
//
// Design: Harbour Signal rules — 44px targets, icon + word (pin carries
// meaning for low-literacy users), sheet is a modal dialog (Esc closes,
// focus moves in, scrim click closes).
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

const LOC_KEY = 'wgpt.loc';

// Demo presets. Coordinates mirror backend/services/district_demo.py — the
// backend gives each of these its own sample weather + alerts so the jury
// sees "different places, different alerts" live. Medchal Malkajgiri serves
// the pre-existing demo set; unknown/manual places fall back honestly.
const PRESETS = [
  { district: 'Hyderabad', state: 'Telangana', lat: 17.385, lon: 78.4867 },
  { district: 'Medchal Malkajgiri', state: 'Telangana', lat: 17.52, lon: 78.53 },
  { district: 'Visakhapatnam', state: 'Andhra Pradesh', lat: 17.6868, lon: 83.2185 },
  { district: 'Mumbai Suburban', state: 'Maharashtra', lat: 19.09, lon: 72.8656 },
  { district: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lon: 80.2707 },
];

const readLoc = () => {
  try {
    const raw = localStorage.getItem(LOC_KEY);
    if (!raw) return null;
    const l = JSON.parse(raw);
    // Same validation shape as store.jsx's readLoc: district + finite coords.
    if (l && l.district && Number.isFinite(l.lat) && Number.isFinite(l.lon)) return l;
  } catch { /* corrupt stored location: fall through to null */ }
  return null;
};

const writeLoc = (loc) => {
  try { localStorage.setItem(LOC_KEY, JSON.stringify(loc)); } catch { /* storage unavailable */ }
};

export default function LocationSwitcher({ onChange }) {
  const { lang } = useApp();
  const [loc, setLocState] = useState(() => readLoc());
  const [open, setOpen] = useState(false);
  const [latIn, setLatIn] = useState('');
  const [lonIn, setLonIn] = useState('');
  const [err, setErr] = useState('');
  const sheetRef = useRef(null);

  const choose = (next) => {
    const clean = { district: next.district, lat: next.lat, lon: next.lon };
    setLocState(clean);
    writeLoc(clean); // survives sessions, independent of onChange wiring
    setOpen(false);
    setErr('');
    try { if (typeof onChange === 'function') onChange(clean); } catch { /* host wiring must not break the control */ }
  };

  const useManual = () => {
    const la = parseFloat(String(latIn).trim());
    const lo = parseFloat(String(lonIn).trim());
    const ok = Number.isFinite(la) && la >= -90 && la <= 90
      && Number.isFinite(lo) && lo >= -180 && lo <= 180;
    if (!ok) {
      setErr(t(lang, 'lswBadCoord'));
      return;
    }
    setErr('');
    // Manual coords refine the current district's position (the sheet says
    // so); the backend resolves the nearest district from the coords.
    choose({ district: loc?.district || PRESETS[0].district, lat: la, lon: lo });
  };

  // Modal behaviour: Esc closes, focus moves into the sheet, resize/scroll
  // keep it usable. Mirrors the tour's overlay handling.
  useEffect(() => {
    if (!open) return undefined;
    sheetRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open ]);

  const current = loc || PRESETS[0];

  return (
    <>
      <button
        type="button"
        className="locsw-trigger"
        style={{ minHeight: 44 }}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="pin" size={20} aria-hidden="true" />
        <span className="locsw-text">
          <span className="locsw-label">{t(lang, 'lswLabel')}</span>
          <b className="locsw-district">{current.district}</b>
        </span>
        <span className="locsw-change">{t(lang, 'lswChange')}</span>
      </button>

      {open && (
        <div className="locsw-scrim" onClick={() => setOpen(false)}>
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t(lang, 'lswTitle')}
            tabIndex={-1}
            className="locsw-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="locsw-head">
              <b>{t(lang, 'lswTitle')}</b>
              <button
                type="button"
                className="btn-icon"
                style={{ minWidth: 44, minHeight: 44 }}
                aria-label={t(lang, 'lswClose')}
                onClick={() => setOpen(false)}
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <p className="locsw-sub">{t(lang, 'lswSub')}</p>

            <ul className="locsw-list">
              {PRESETS.map((p) => (
                <li key={p.district}>
                  <button
                    type="button"
                    className={`locsw-row${current.district === p.district ? ' is-current' : ''}`}
                    style={{ minHeight: 44 }}
                    aria-current={current.district === p.district || undefined}
                    onClick={() => choose(p)}
                  >
                    <Icon name="pin" size={18} aria-hidden="true" />
                    <span className="locsw-row-text">
                      <b>{p.district}</b>
                      <span>{p.state} · {t(lang, 'lswSample')}</span>
                    </span>
                    {current.district === p.district && (
                      <Icon name="check" size={18} aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))}
            </ul>

            <div className="locsw-manual">
              <b>{t(lang, 'lswManual')}</b>
              <p className="locsw-sub">{t(lang, 'lswManualSub')}</p>
              <div className="locsw-coords">
                <label>
                  <span>{t(lang, 'lswLat')}</span>
                  <input
                    type="number" inputMode="decimal" step="any" min={-90} max={90}
                    value={latIn} onChange={(e) => setLatIn(e.target.value)}
                    placeholder={t(lang, 'lswLatPh')}
                  />
                </label>
                <label>
                  <span>{t(lang, 'lswLon')}</span>
                  <input
                    type="number" inputMode="decimal" step="any" min={-180} max={180}
                    value={lonIn} onChange={(e) => setLonIn(e.target.value)}
                    placeholder={t(lang, 'lswLonPh')}
                  />
                </label>
              </div>
              {err && <p className="locsw-err" role="alert">{err}</p>}
              <button
                type="button"
                className="btn btn-signal"
                style={{ minHeight: 44 }}
                onClick={useManual}
              >
                {t(lang, 'lswUse')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
