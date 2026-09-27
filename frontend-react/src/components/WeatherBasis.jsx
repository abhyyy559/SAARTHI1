// WeatherBasis — the honest "based on" line under persona advisories.
//
// Shows the observed numbers the backend grounded its weather lines in, plus
// their provenance — or states plainly that weather data was unavailable (in
// which case the advice above rests on alerts only). Facts only; this line
// never gives advice and never claims calm.
// Harbour Signal: small bordered panel on paper, provenance in mono, system
// fonts, sentence case.
import { t } from '../i18n';
import { formatWeatherBasis } from '../weatherBasis';

export default function WeatherBasis({ basis, alertCount, lang }) {
  const r = formatWeatherBasis(basis, alertCount, (k) => t(lang, k));
  return (
    <div className="adv-basis" role="note" style={{
      border: '2px solid var(--ink)', borderRadius: 'var(--radius)',
      background: 'var(--paper)', padding: '8px 10px', marginTop: 8,
    }}>
      <p className="sub" style={{ margin: 0 }}>
        {r.ok ? (<>{r.text} <span className="mono">· {r.provenance}</span></>) : r.text}
      </p>
    </div>
  );
}
