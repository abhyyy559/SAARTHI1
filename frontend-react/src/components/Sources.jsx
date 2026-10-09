// Where the facts come from, and whether each source is connected right now.
import { api } from '../lib/api';
import { useApp } from '../lib/appState';
import { useData } from '../lib/useData';
import { t } from '../lib/i18n';
import { Icon } from './Icons';

const ROWS = [
  { id: 'imd', name: 'IMD', role: 'roleAlerts', icon: 'shield-ok' },
  { id: 'cap', name: 'NDMA SACHET', role: 'roleAlerts', icon: 'bell' },
  { id: 'open-meteo', name: 'Open-Meteo', role: 'roleWeather', icon: 'partly' },
  { id: 'owm', name: 'OpenWeatherMap', role: 'roleBackup', icon: 'cloud' },
  { id: 'stt', name: 'Sarvam', role: 'roleVoice', icon: 'mic' },
  { id: 'llm', name: 'Groq', role: 'roleAi', icon: 'sparkle' },
];
const STATE = {
  LIVE: ['stLive', 'ok'], READY: ['stReady', 'ok'], CACHED: ['stCached', 'warn'],
  UNCONFIGURED: ['stOff', 'off'], OFFLINE: ['stDown', 'bad'], ERROR: ['stDown', 'bad'],
};

export default function Sources() {
  const { lang } = useApp();
  const src = useData('sources', () => api.sources(), { refreshMs: 60 * 1000 });
  const byName = Object.fromEntries((src.data?.sources || []).map((s) => [s.name, s]));
  return (
    <div className="sources">
      {ROWS.map((r) => {
        const s = byName[r.id];
        const [label, tone] = STATE[s?.status] || ['stOff', 'off'];
        return (
          <div className="source-row" key={r.id} title={s?.detail || ''}>
            <Icon name={r.icon} size={26} />
            <div className="source-words"><b>{r.name}</b><span className="muted">{t(lang, r.role)}</span></div>
            <span className={`src-state ${tone}`}>{t(lang, label)}</span>
          </div>
        );
      })}
    </div>
  );
}
