import { useApp } from '../store';
import { t } from '../i18n';
import { useVoiceInput } from '../useVoiceInput';
import Icon from './icons';

export default function VoicePanel() {
  const { lang, persona, loc, ask, result, speak, stopSpeaking, speechState, speechNote } = useApp();
  const voice = useVoiceInput(lang, ask);
  const answer = result?._context === `${lang}:${persona}:${loc.district}` ? result.answer : '';
  return (
    <section className="card" aria-label={t(lang, 'voice')}>
      <h2>{t(lang, 'voice')}</h2>
      <p className="sub">{t(lang, 'voiceReady')}</p>
      <div className="row">
        <button className="btn" type="button" onClick={voice.listen} disabled={voice.busy} aria-pressed={voice.listening}>
          <Icon name="mic" />{voice.listening ? t(lang, 'stop') : t(lang, 'listen')}
        </button>
        <button className="btn ghost" type="button" onClick={() => speak(answer)} disabled={!answer}>
          <Icon name="speaker" />{t(lang, 'replay')}
        </button>
        {speechState !== 'idle' && <button className="btn ghost" onClick={stopSpeaking}>{t(lang, 'stop')}</button>}
      </div>
      <div role="status">
        {voice.busy && <p>{t(lang, 'processing')}</p>}
        {voice.heard && <p>{t(lang, 'homeHeard')}: {voice.heard}</p>}
        {voice.note && <p>{voice.note}</p>}
        {speechNote && <p>{t(lang, speechNote)}</p>}
      </div>
    </section>
  );
}
