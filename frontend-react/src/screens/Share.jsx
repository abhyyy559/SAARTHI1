import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { cache } from '../lib/cache';
import { keys, useApp } from '../lib/appState';
import { makeShareLink, textSummary } from '../lib/share';
import { canPassOn, listReceived, receiveScanned } from '../lib/relay';
import { activeAlerts, toneOf } from '../lib/weather';
import { ago, fmtDateTime, t } from '../lib/i18n';
import { Icon } from '../components/Icons';
import { SpeakButton } from '../components/ui';
import Scanner from '../components/Scanner';
import { summaryText } from './Today';

export function publicBase() {
  return (import.meta.env?.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, '');
}
const isLocal = (url) => /\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url);
const toQr = (text) => QRCode.toDataURL(text, { errorCorrectionLevel: 'L', margin: 2, width: 720, color: { dark: '#10151F', light: '#FFFFFF' } });

// Everything comes from the phone's saved copies, so a code can be made
// with no network: one phone with data can pass it to many without.
export function snapshotInput({ lang, persona, loc }) {
  const warn = cache.read(keys.warnings(loc));
  if (!warn?.data?.verdict) return null;
  const now = cache.read(keys.current(loc));
  const fc = cache.read(keys.forecast(loc));
  const adv = cache.read(keys.advisory(loc, persona, lang));
  const w = warn.data;
  return {
    lang, persona,
    loc: { district: loc.district, state: loc.state, lat: loc.lat, lon: loc.lon },
    savedAt: warn.savedAt,
    verdict: w.verdict,
    current: now?.data?.current || null,
    days: fc?.data?.forecast?.days || [],
    alerts: [...activeAlerts(w.cap_alerts), ...activeAlerts(w.nearby_alerts)],
    advisory: adv?.data?.advisory || '',
    hops: 0,
  };
}

// A received snapshot shown as a code again: the next phone gets it with
// one more hop on the counter.
function PassOn({ item, lang, onClose }) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    let alive = true;
    makeShareLink(publicBase(), item.snap).then(toQr).then((img) => { if (alive) setQr(img); });
    return () => { alive = false; };
  }, [item]);
  return createPortal(
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={t(lang, 'passOn')} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2><Icon name="share" size={22} /> {t(lang, 'passOn')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'close')}><Icon name="close" size={24} /></button>
        </div>
        {qr ? <div className="qr-frame center-self"><img src={qr} alt="QR" width="280" height="280" /></div> : null}
        <p className="note center"><Icon name="info" size={14} /> {t(lang, 'infoFrom', { t: fmtDateTime(item.snap.savedAt, lang) })}</p>
      </div>
    </div>,
    document.body,
  );
}

function Received({ lang, items, onPassOn }) {
  if (!items.length) return null;
  return (
    <section className="received">
      <h2 className="group"><Icon name="radio" size={18} /> {t(lang, 'received')}</h2>
      {items.map((it) => (it.kind === 'text' ? (
        <article className="card recv" key={it.id}>
          <pre className="recv-text">{it.text}</pre>
          <div className="card-foot">
            <span className="src-note">{t(lang, 'receivedAgo', { a: ago(it.receivedAt, lang), n: 1 })}</span>
            <SpeakButton text={it.text} lang={lang} id={`recv-${it.id}`} label={false} />
          </div>
        </article>
      ) : (
        <article className={`card recv edge-${toneOf(it.snap.verdict)}`} key={it.id}>
          <b className="recv-place"><Icon name="pin" size={18} /> {it.snap.loc.district}</b>
          <p>{t(lang, `lv${it.snap.verdict?.level || 'UNKNOWN'}`)}</p>
          <p className="src-note">{t(lang, 'infoFrom', { t: fmtDateTime(it.snap.savedAt, lang) })}</p>
          <div className="card-foot">
            <span className="src-note">{t(lang, 'receivedAgo', { a: ago(it.receivedAt, lang), n: it.snap.hops })}</span>
            <div className="row-gap">
              <SpeakButton text={summaryText(lang, it.snap.verdict, it.snap.current, it.snap.days)} lang={lang} id={`recv-${it.id}`} label={false} />
              {canPassOn(it) ? (
                <button type="button" className="btn-ghost" onClick={() => onPassOn(it)}><Icon name="share" size={18} /> {t(lang, 'passOn')}</button>
              ) : <span className="note">{t(lang, 'hopLimit')}</span>}
            </div>
          </div>
        </article>
      )))}
    </section>
  );
}

export default function Share() {
  const app = useApp();
  const { lang, loc } = app;
  const [mode, setMode] = useState('link'); // link | text
  const [link, setLink] = useState('');
  const [qr, setQr] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [received, setReceived] = useState(listReceived);
  const [passOn, setPassOn] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    const input = snapshotInput(app);
    if (!input) { setLink(''); setQr(''); return undefined; }
    setSavedAt(input.savedAt);
    (async () => {
      const l = mode === 'text' ? textSummary(input, lang) : await makeShareLink(publicBase(), input);
      const img = await toQr(l);
      if (alive) { setLink(l); setQr(img); }
    })();
    return () => { alive = false; };
  }, [app.lang, app.persona, app.loc.district, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScanned = async (text) => {
    setScanning(false);
    try {
      const { list } = await receiveScanned(text);
      setReceived(list);
      setNote('');
    } catch {
      setNote(t(lang, 'notOurs'));
    }
  };

  const send = async () => {
    try {
      if (navigator.share) {
        await navigator.share(mode === 'text' ? { text: link } : { title: `WeatherGPT · ${loc.district}`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* user cancelled */ }
  };

  return (
    <div className="screen share">
      <h1 className="share-title"><Icon name="qr" size={28} /> {t(lang, 'shareTitle')}</h1>
      {link ? (
        <div className="qr-frame" data-link={mode === 'link' ? link : undefined} data-text={mode === 'text' ? link : undefined}>
          <img src={qr} alt={`QR · ${loc.district}`} width="300" height="300" />
          <p className="qr-caption"><Icon name="pin" size={16} /> {loc.district} · {fmtDateTime(savedAt, lang)}</p>
        </div>
      ) : (
        <div className="empty"><Icon name="qr" size={40} /><p>{t(lang, 'shareEmpty')}</p></div>
      )}
      <div className="layer-chips" role="radiogroup" aria-label={t(lang, 'shareTitle')}>
        <button type="button" role="radio" aria-checked={mode === 'link'} className={`layer-chip ${mode === 'link' ? 'is-on' : ''}`} onClick={() => setMode('link')}>
          <Icon name="globe" size={22} /> {t(lang, 'shareModeLink')}
        </button>
        <button type="button" role="radio" aria-checked={mode === 'text'} className={`layer-chip ${mode === 'text' ? 'is-on' : ''}`} onClick={() => setMode('text')}>
          <Icon name="offline" size={22} /> {t(lang, 'shareModeText')}
        </button>
      </div>
      <p className="share-hint"><Icon name="info" size={16} /> {t(lang, mode === 'text' ? 'shareTextHint' : 'shareHint')}</p>
      {mode === 'link' && link && isLocal(link) ? <p className="warn-note">{t(lang, 'shareLocal')}</p> : null}
      <div className="share-actions">
        {link ? (
          <>
            <button type="button" className="btn-big" onClick={send}>
              <Icon name={copied ? 'check' : 'share'} size={24} /> {t(lang, 'shareSend')}
            </button>
            <a className="btn-big btn-light" href={qr} download={`weathergpt-${loc.district}.png`}>
              <Icon name="download" size={24} /> {t(lang, 'shareSave')}
            </a>
          </>
        ) : null}
        <button type="button" className="btn-big btn-light" onClick={() => setScanning(true)}>
          <Icon name="qr" size={24} /> {t(lang, 'receive')}
        </button>
        {note ? <p className="warn-note">{note}</p> : null}
      </div>
      <Received lang={lang} items={received} onPassOn={setPassOn} />
      {scanning ? <Scanner lang={lang} onResult={onScanned} onClose={() => setScanning(false)} /> : null}
      {passOn ? <PassOn item={passOn} lang={lang} onClose={() => setPassOn(null)} /> : null}
    </div>
  );
}
