// Weather-basis formatter for persona advisories (Worker 6).
//
// The backend's `weather_basis` block says which observed numbers the advisory
// was grounded in and where they came from. This renders them as one small,
// honest line — facts only, never advice, never an all-clear.
//
// `tr` is a (key) => string translator so this module stays DOM- and
// bundler-free and unit-testable under plain node. The component passes
// (k) => t(lang, k); the test passes the real round2 strings.
const fmtNum = (v) => {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

export function formatWeatherBasis(basis, alertCount, tr) {
  const prov = basis && typeof basis.provenance === 'string' ? basis.provenance : 'UNAVAILABLE';
  const parts = [];
  if (basis && typeof basis === 'object') {
    const tc = fmtNum(basis.temp_c);
    if (tc !== null) parts.push(tr('advWxTemp').replace('{v}', tc));
    const hu = fmtNum(basis.humidity_pct);
    if (hu !== null) parts.push(tr('advWxHumidity').replace('{v}', hu));
    const rn = fmtNum(basis.rain_mm);
    if (rn !== null) parts.push(tr('advWxRain').replace('{v}', rn));
    const wn = fmtNum(basis.wind_kph);
    if (wn !== null) parts.push(tr('advWxWind').replace('{v}', wn));
  }
  // No numbers to stand on — say so plainly. This is the "weather data
  // unavailable" line, not a calm report.
  if (prov === 'UNAVAILABLE' || parts.length === 0) {
    return { ok: false, text: tr('advWxUnavailable'), provenance: prov };
  }
  let text = `${tr('advWxBasis')}: ${parts.join(', ')}`;
  if (typeof alertCount === 'number' && alertCount > 0) {
    text += ` + ${alertCount} ${tr(alertCount === 1 ? 'advWxAlertOne' : 'advWxAlertMany')}`;
  }
  return { ok: true, text, provenance: prov };
}
