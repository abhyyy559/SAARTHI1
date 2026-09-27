// AdviceCards — situation-aware advisory cards, rendered INSIDE the Advisory
// view (AdvisoryView), below the persona guidance. Advice lives in the
// Advisory view only; Home and Ask stay facts-only.
//
// Cards come from GET /api/advisory/cards — a deterministic backend rules
// engine over current observations, the 3-day forecast and the official alert
// verdict. The frontend renders what the server says: severity stamps go
// through SevStamp, which only translates backend severity codes and never
// re-grades. Missing data renders as an honest "couldn't load" state, never
// as invented cards.
//
// Harbour Signal: every card leads with its official severity (signal-flag
// stamp: icon + word, never colour alone), the action comes first in a
// labelled "what to do now" callout, and the grounding line says exactly
// which alerts and which weather the card rests on — weather context is
// append-only and never softens an official grade.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { Card, SevStamp } from './ui';
import Icon from './icons';
import { bulletize } from '../format';

const KIND_ICON = {
  agriculture: 'crop',
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

// Signal-flag severity accent for the card's left edge (Harbour Signal:
// severity is always icon + word + colour, never colour alone — the accent
// is decorative, SevStamp carries the meaning).
const SEV_ACCENT = {
  RED: '#B3352B',
  ORANGE: '#C56A1B',
  YELLOW: '#8A6D1A',
  GREEN: '#2F6B3C',
  UNKNOWN: '#6B6255',
  INFO: '#3D5A80',
};

function alertPart(lang, count) {
  if (count <= 0) return t(lang, 'groundAlertsNone');
  if (count === 1) return t(lang, 'groundAlertsOne');
  return t(lang, 'groundAlertsMany').replace('{n}', String(count));
}

// The honest grounding banner: "Based on: <alerts> + <weather>, <provenance>".
// Both inputs are always named; a missing input is stated, never smoothed
// over, and never read as an all-clear.
function GroundingBanner({ grounding, lang }) {
  if (!grounding) return null;
  const alerts = grounding.alerts || {};
  const current = grounding.current || {};
  const forecast = grounding.forecast || {};
  const wxText = current.available ? t(lang, 'groundWxOn') : t(lang, 'groundWxOff');
  const sources = [
    `current ${current.provenance || 'UNAVAILABLE'}`,
    `forecast ${forecast.provenance || 'UNAVAILABLE'}`,
    `alerts ${alerts.provenance || 'UNAVAILABLE'}`,
  ].join(' · ');
  return (
    <div className="advice-grounding" role="note"
      style={{
        border: '2px solid var(--ink)', borderRadius: 'var(--radius)',
        background: 'var(--paper)', padding: '10px 12px', marginBottom: 12,
        display: 'grid', gap: 4,
      }}
    >
      <p style={{ margin: 0, fontWeight: 700 }}>
        {t(lang, 'basedOn')}: {alertPart(lang, alerts.count ?? 0)} + {wxText}
      </p>
      <p className="sub" style={{ margin: 0 }}>
        {t(lang, 'groundSources')}: <span className="mono">{sources}</span>
      </p>
    </div>
  );
}

function AdviceCard({ card, lang }) {
  const sev = card.severity_word === 'info' ? 'INFO' : (card.severity_word || 'UNKNOWN');
  const accent = SEV_ACCENT[sev] || SEV_ACCENT.UNKNOWN;
  // Bullets, not paragraphs: a multi-sentence body becomes short points
  // (max four); a single sentence stays a single line.
  const bodyBullets = bulletize(card.body, 4);
  return (
    <article className="advice-card" data-sev={sev} aria-labelledby={`ac-${card.id}`}
      style={{ borderLeft: `6px solid ${accent}` }}
    >
      <div className="advice-card-head">
        <span className="advice-kind">
          <Icon name={KIND_ICON[card.kind] || 'bell'} size={16} aria-hidden="true" />
          {t(lang, KIND_KEY[card.kind] || 'kindAlert')}
        </span>
        <SevStamp lang={lang} level={sev} />
      </div>
      <h3 className="advice-title" id={`ac-${card.id}`}>{card.title}</h3>
      {/* What to do now — the action first, in its own labelled callout so it
          reads first under stress. The body text itself is verbatim from the
          backend rules engine; only the framing is ours. */}
      <div className="advice-donow" style={{
        border: '2px solid var(--ink)', borderRadius: 'var(--radius)',
        background: 'var(--paper)', padding: '10px 12px',
        display: 'flex', gap: 8, alignItems: 'flex-start',
      }}>
        <span aria-hidden="true" style={{
          flex: '0 0 auto', width: 22, height: 22, borderRadius: '50%',
          border: '2px solid var(--ink)', background: accent, color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="check" size={12} />
        </span>
        <div style={{ display: 'grid', gap: 4 }}>
          <span className="advice-donow-label" style={{ fontWeight: 800, fontSize: 13 }}>
            {t(lang, 'doNow')}
          </span>
          {bodyBullets.length > 1 ? (
            <ul className="adv-bullets" style={{ margin: 0 }}>
              {bodyBullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          ) : (
            <p className="advice-body" style={{ margin: 0 }}>{card.body}</p>
          )}
        </div>
      </div>
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
  );
}

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
            <>
              {/* Honest grounding for every card below: which official alerts
                  and which weather the advice was built from, with the
                  provenance of each. Weather never softens an alert here —
                  the rules engine owns severity; this banner only names the
                  inputs. */}
              <GroundingBanner grounding={current.data.grounding} lang={lang} />
              <div className="advice-cards">
                {cards.map((card) => (
                  <AdviceCard key={card.id} card={card} lang={lang} />
                ))}
              </div>
            </>
          )}
      </div>
    </Card>
  );
}
