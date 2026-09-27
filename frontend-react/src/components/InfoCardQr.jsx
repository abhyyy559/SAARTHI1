// Offline emergency info card — STATIC QR anyone can scan.
//
// Deliberately separate from QrRelay (the app-to-app rotating SOS relay):
// that protocol needs OUR scanner to reassemble frames. A generic phone
// camera reads ONE static QR as plain text, so this card is a single static
// QR of plain, human-readable text — or a small numbered set the user flips
// MANUALLY (Prev/Next buttons). There is intentionally no auto-rotating
// interval in this file; rotating frames would be unreadable to a stranger's
// camera app.
//
// Fully offline: built ONLY from this phone's saved cache (offline.js
// snapshots). No api import, no fetch, no network calls anywhere here.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { t } from '../i18n';
import { useApp } from '../store';
import { readCache, alertAgeMin } from '../offline';
import { buildInfoCard } from '../infocard';
import { Card } from './ui';
import Icon from './icons';

const QR_OPTS = { errorCorrectionLevel: 'M', width: 280, margin: 2 };

// Assemble the card once from the phone's saved snapshots. Snapshots are
// keyed by the offline.js writers: alert -> { alert, district },
// warning -> { warning, verified, district }, advisory -> { cards, district },
// observation -> { obs }. Nothing is fetched here — airplane mode is fine.
// Module-level (not in render): the cache read is impure, so it lives in the
// useState initializer below — the same lazy pattern HomeHero uses.
function assembleCard(lang) {
  const c = readCache();
  const alertSnap = c.alert || null;
  const warnSnap = c.warning || null;
  const advSnap = c.advisory || null;
  const obsSnap = c.observation || null;
  const ages = [alertSnap, warnSnap, advSnap, obsSnap]
    .map((s) => alertAgeMin(s))
    .filter((a) => a != null);
  const oldestMin = ages.length ? Math.max(...ages) : null;
  const offlineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
  const dataOf = (s) => (s && s.data) || {};
  const labels = {
    title: t(lang, 'icTitle'),
    alert: t(lang, 'icAlert'),
    do: t(lang, 'icDo'),
    avoid: t(lang, 'icAvoid'),
    weatherNow: t(lang, 'icWeatherNow'),
    generated: t(lang, 'icGenerated'),
    cachedNote: t(lang, 'icCachedNote'),
    noApp: t(lang, 'icNoApp'),
    validTill: t(lang, 'icValidTill'),
  };
  return buildInfoCard({
    alert: dataOf(alertSnap).alert,
    warning: dataOf(warnSnap).warning,
    advisoryCards: dataOf(advSnap).cards,
    observation: dataOf(obsSnap).obs,
    district: dataOf(alertSnap).district || dataOf(warnSnap).district || dataOf(advSnap).district || '',
    lang,
    labels,
    generatedAt: Date.now(),
    offline: offlineNow,
    // Honest stamp: the phone is offline, or the freshest snapshot is over
    // an hour old — either way the reader must know this may be outdated.
    showCachedNote: offlineNow || (oldestMin != null && oldestMin > 60),
  });
}

export default function InfoCardQr() {
  const { lang } = useApp();
  const [pageIdx, setPageIdx] = useState(0);
  const [qrUrl, setQrUrl] = useState('');
  const [qrErr, setQrErr] = useState('');

  // Frozen at open: the card is a point-in-time snapshot, so "Generated
  // {time}" and the cached-data stamp must not drift while the sheet is open.
  const [frozen] = useState(() => ({ card: assembleCard(lang), lang }));
  const card = frozen.card;
  const flang = frozen.lang;

  // Manual pager only — never auto-advance: a rotating QR is unscannable by
  // a generic camera app, which defeats this feature's whole purpose.
  const pageCount = card.pageCount;
  const pageText = pageCount ? card.pages[Math.min(pageIdx, pageCount - 1)] : '';

  // Render the current static page. No synchronous reset: the previous page's
  // QR stays up until the new one is ready (no flash of empty), and state is
  // only set from the async completion.
  const genToken = useRef(0);
  useEffect(() => {
    const my = ++genToken.current;
    if (!pageText) return undefined;
    QRCode.toDataURL(pageText, QR_OPTS)
      .then((url) => {
        if (genToken.current !== my) return;
        setQrUrl(url);
        setQrErr('');
      })
      .catch(() => { if (genToken.current === my) setQrErr('qr-render'); });
    return undefined;
  }, [pageText]);

  const pageOf = () => t(flang, 'icPageOf')
    .replace('{i}', String(Math.min(pageIdx, pageCount - 1) + 1))
    .replace('{n}', String(pageCount));

  return (
    <Card title={t(flang, 'icCardTitle')} sub={t(flang, 'icCardSub')}>
      {card.empty ? (
        <p className="sub" role="status">
          <Icon name="info" size={14} /> {t(flang, 'icNoData')}
        </p>
      ) : (
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          {qrErr ? (
            <p className="sub" role="alert">{qrErr}</p>
          ) : qrUrl ? (
            <img
              src={qrUrl}
              alt={pageCount > 1 ? pageOf() : t(flang, 'icCardTitle')}
              width={280}
              height={280}
              style={{ border: '2px solid #1a1a1a', borderRadius: 8, background: '#fff' }}
            />
          ) : (
            <p className="sub" aria-live="polite">…</p>
          )}
          {pageCount > 1 && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 8, gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary sm"
                disabled={pageIdx <= 0}
                onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
              >
                {t(flang, 'icPrev')}
              </button>
              <span className="chip" role="status">{pageOf()}</span>
              <button
                type="button"
                className="btn btn-secondary sm"
                disabled={pageIdx >= pageCount - 1}
                onClick={() => setPageIdx((i) => Math.min(pageCount - 1, i + 1))}
              >
                {t(flang, 'icNext')}
              </button>
            </div>
          )}
          <p className="sub" style={{ marginTop: 8 }}>
            <Icon name="eye" size={12} /> {t(flang, 'icScanHint')}
          </p>
          {/* The plain text rides along under the code so the phone's owner
              can read their own card without scanning it. */}
          <pre
            className="mono"
            style={{
              textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: '#fff', border: '2px solid #1a1a1a', borderRadius: 8,
              padding: 10, fontSize: 13, lineHeight: 1.5, marginTop: 4,
            }}
          >
            {pageText}
          </pre>
        </div>
      )}
    </Card>
  );
}
