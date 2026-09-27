// ChatMessage — one structured SAARTHI answer for the Home chat board.
//
// Layout contract: verdict chip (icon + word + color via SevStamp, backend
// severity only — never re-graded here) → at most 40 words before the fold →
// a "Based on" provenance line → action buttons (Listen, Ask about this,
// Open My advice). Facts only: this renderer never carries guidance copy; the
// escape to guidance is the Open My advice button.
//
// Sanitize logic is shared from ../chatText (reused from ChatPanel.jsx's
// sanitizeForTTS): it strips markdown artifacts, URLs and emoji so neither
// the screen nor TTS sees them.
import { useState } from 'react';
import { t } from '../i18n';
import { sanitizeForTTS } from '../chatText';
import Icon from './icons';
import { SevStamp } from './ui';

// Display text: sanitize but do NOT cap length — the fold handles length.
const plainText = (text) => sanitizeForTTS(text, Number.MAX_SAFE_INTEGER);

// Severity is selected, never derived: the backend's confirmed verdict wins;
// anything unconfirmed or unreachable reads as UNKNOWN so it can never look
// like an all-clear.
function verdictLevel(message) {
  const v = message && message.verdict;
  if (v && v.confirmed === true && v.level) return v.level;
  return 'UNKNOWN';
}

const FOLD_WORDS = 40;

export default function ChatMessage({
  lang,
  message,
  revealChars = Infinity,
  streaming = false,
  speaking = false,
  onListen,
  onAskAbout,
  onOpenAdvisory,
}) {
  const [expanded, setExpanded] = useState(false);
  const plain = plainText(message.text || '');
  const revealed = plain.slice(0, revealChars);
  const words = revealed.split(/\s+/).filter(Boolean);
  const stillStreaming = streaming || revealChars < plain.length;
  const fold = words.slice(0, FOLD_WORDS).join(' ');
  const beyondFold = words.length > FOLD_WORDS;
  const showFull = expanded && !stillStreaming;
  const sources = (message.evidence || [])
    .map((e) => e && e.source)
    .filter(Boolean)
    .filter((s, i, a) => a.indexOf(s) === i);
  const basedOn = sources.length > 0
    ? `${t(lang, 'hcBasedOn')} ${sources.join(', ')}`
    : `${t(lang, 'hcBasedOn')} ${t(lang, 'hcBasedOnSaved')}`;

  return (
    <div className="hc-bubble">
      <div className="hcm-verdict">
        <SevStamp lang={lang} level={verdictLevel(message)} />
      </div>
      {(message.fallback || message.modelError) && !stillStreaming && (
        <p className="hcm-fallback" role="note">
          <Icon name="shield" size={14} aria-hidden="true" />
          <span><b>{t(lang, 'hcFallbackChip')}</b> · {t(lang, 'hcFallbackText')}</span>
        </p>
      )}
      <p className="hcm-fold">
        {fold}
        {stillStreaming && <span className="hc-caret" aria-hidden="true" />}
      </p>
      {showFull && <p className="hcm-full">{plain}</p>}
      {beyondFold && !stillStreaming && (
        <button
          type="button"
          className="hcm-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? t(lang, 'hcReadLess') : t(lang, 'hcReadMore')}
          <Icon name="chevron" size={14} aria-hidden="true" />
        </button>
      )}
      <p className="hcm-based">
        <Icon name="database" size={14} aria-hidden="true" />
        <span>{basedOn}</span>
      </p>
      <div className="hcm-actions">
        {message.text && (
          <button
            type="button"
            className="hcm-btn"
            aria-label={speaking ? t(lang, 'hcStopListen') : t(lang, 'hcListen')}
            onClick={onListen}
          >
            <Icon name={speaking ? 'stop' : 'speaker'} size={16} aria-hidden="true" />
            {speaking ? t(lang, 'hcStopListen') : t(lang, 'hcListen')}
          </button>
        )}
        <button type="button" className="hcm-btn" onClick={onAskAbout}>
          <Icon name="chat" size={16} aria-hidden="true" />
          {t(lang, 'hcAskAboutThis')}
        </button>
        <button type="button" className="hcm-btn is-primary" onClick={onOpenAdvisory}>
          <Icon name="sun" size={16} aria-hidden="true" />
          {t(lang, 'hcOpenAdvisory')}
        </button>
      </div>
    </div>
  );
}
