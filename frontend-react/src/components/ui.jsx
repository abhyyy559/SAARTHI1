import { Icon } from './Icons';
import { speak, useSpeaking } from '../lib/voice';
import { ago, t } from '../lib/i18n';

// Read-aloud button. Every block of text in the app has one.
export function SpeakButton({ text, lang, id, big = false, label = true }) {
  const speaking = useSpeaking() === id;
  if (!text) return null;
  return (
    <button
      type="button"
      className={`speak ${big ? 'speak-big' : ''} ${speaking ? 'is-on' : ''}`}
      onClick={(e) => { e.stopPropagation(); speak(text, lang, id); }}
      aria-label={speaking ? t(lang, 'stop') : t(lang, 'listen')}
      aria-pressed={speaking}
    >
      <Icon name={speaking ? 'stop' : 'speaker'} size={big ? 28 : 22} />
      {label ? <span>{speaking ? t(lang, 'stop') : t(lang, 'listen')}</span> : null}
    </button>
  );
}

// Live / saved-at chip. Saved data always shows its age.
export function Fresh({ source, savedAt, lang, loading }) {
  if (source === 'live') {
    return <span className="fresh fresh-live"><i className="dot" />{t(lang, 'live')}</span>;
  }
  if (source === 'saved') {
    return (
      <span className="fresh fresh-saved" title={new Date(savedAt).toLocaleString()}>
        <Icon name="clock" size={14} />{t(lang, 'saved')} · {ago(savedAt, lang)}
      </span>
    );
  }
  return loading ? <span className="fresh">{t(lang, 'loading')}</span> : null;
}

export function Empty({ lang, offline, onRetry }) {
  return (
    <div className="empty">
      <Icon name={offline ? 'offline' : 'info'} size={28} />
      <p>{t(lang, offline ? 'nothingSaved' : 'notAvailable')}</p>
      {onRetry && !offline ? (
        <button type="button" className="btn-ghost" onClick={onRetry}>
          <Icon name="refresh" size={18} /> {t(lang, 'retry')}
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ h = 120 }) {
  return <div className="skeleton" style={{ height: h }} />;
}
