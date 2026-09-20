// AdviceCards — situation-aware advisory cards, rendered INSIDE the Advisory
// view (AdvisoryView), above the persona guidance. Advice lives in the
// Advisory view only; Home and Ask stay facts-only.
//
// Cards come from GET /api/advisory/cards — a deterministic backend rules
// engine over current observations, the 3-day forecast and the official alert
// verdict. The frontend renders what the server says: severity stamps go
// through SevStamp, which only translates backend severity codes and never
// re-grades. Missing data renders as an honest "couldn't load" state, never
// as invented cards.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { Card, SevStamp } from './ui';
import Icon from './icons';

const KIND_ICON = {
  agriculture: 'drop',
  health: 'thermometer',
  commute: 'route',
  alert_safety: 'alert',
};
const KIND_KEY = {
  agriculture: 'kindAgri',
  health: 'kindHealth',
  commute: 'kindCommute',
  alert_safety: 'kindAlert',
};

export default function AdviceCards() {
  const { loc, persona, lang, speak, syncTick } = useApp();
  const [response, setResponse] = useState(null);
  const [tick, setTick] = useState(0);
  const key = `${loc.lat}:${loc.lon}:${persona}:${lang}`;
  useEffect(() => {
    let active = true;
    api.advisoryCards(loc, persona || 'general', lang)
      .then((data) => { if (active) setResponse({ key, data }); })
      .catch(() => { if (active) setResponse({ key, error: true }); });
    return () => { active = false; };
  }, [loc, persona, lang, key, syncTick, tick]);
  const current = response?.key === key ? response : null;
  const cards = current?.data?.cards || [];
  const listenText = cards.map((c) => `${c.title}. ${c.body}`).join(' ');

  return (
    <Card
      title={t(lang, 'cardsTitle')}
      sub={t(lang, 'cardsSub')}
      actions={current && !current.error && cards.length > 0 ? (
        <button type="button" className="btn btn-ghost sm" style={{ minHeight: 44 }} onClick={() => speak(listenText)} aria-label={t(lang, 'alertsListen')}>
          <Icon name="speaker" size={14} /> {t(lang, 'alertsListen')}
        </button>
      ) : null}
    >
      <div role="status" aria-live="polite">
        {!current ? <p className="sub">{t(lang, 'cardsLoading')}</p>
          : current.error ? (
            // role="status" wraps this block above — no second live region.
            <div className="offline-panel">
              <div className="display">{t(lang, 'cardsOfflineTitle')}</div>
              <p className="sub">{t(lang, 'cardsOfflineBody')}</p>
              <div className="row">
                <button type="button" className="btn sm" style={{ minHeight: 44 }} onClick={() => { setResponse(null); setTick((n) => n + 1); }}>
                  <Icon name="refresh" size={14} /> {t(lang, 'cardsRetry')}
                </button>
              </div>
            </div>
          )
          : cards.length === 0 ? <p className="sub">{t(lang, 'cardsEmpty')}</p>
          : (
            <div className="advice-cards">
              {cards.map((card) => (
                <article className="advice-card" key={card.id} aria-labelledby={`ac-${card.id}`}>
                  <div className="advice-card-head">
                    <span className="advice-kind">
                      <Icon name={KIND_ICON[card.kind] || 'bell'} size={16} aria-hidden="true" />
                      {t(lang, KIND_KEY[card.kind] || 'kindAlert')}
                    </span>
                    <SevStamp lang={lang} level={card.severity_word === 'info' ? 'INFO' : card.severity_word} />
                  </div>
                  <h3 className="advice-title" id={`ac-${card.id}`}>{card.title}</h3>
                  <p className="advice-body">{card.body}</p>
                  {card.basis?.length > 0 && (
                    <div className="advice-meta">
                      <span className="advice-meta-label">{t(lang, 'basedOn')}:</span>
                      <ul>
                        {card.basis.map((b, i) => <li key={i}>{b}</li>)}
                      </ul>
                    </div>
                  )}
                  <div className="advice-meta">
                    <span className="advice-meta-label">{t(lang, 'validFor')}:</span>
                    <span>{card.valid_for}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
      </div>
    </Card>
  );
}
