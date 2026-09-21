// WeatherBasis — the honest "based on" line under persona advisories.
//
// Shows the observed numbers the backend grounded its weather lines in, plus
// their provenance — or states plainly that weather data was unavailable (in
// which case the advice above rests on alerts only). Facts only; this line
// never gives advice and never claims calm.
// Harbour Signal: small sub copy, provenance in mono, system fonts, sentence case.
import { t } from '../i18n';
import { formatWeatherBasis } from '../weatherBasis';

export default function WeatherBasis({ basis, alertCount, lang }) {
  const r = formatWeatherBasis(basis, alertCount, (k) => t(lang, k));
  return (
    <p className="sub">
      {r.ok ? (<>{r.text} <span className="mono">· {r.provenance}</span></>) : r.text}
    </p>
  );
}
