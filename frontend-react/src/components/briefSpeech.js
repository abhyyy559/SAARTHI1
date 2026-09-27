// Spoken form of the role-first weather brief — headline first, then the
// focus lines. Pure helper (tested): numbers inside are normalised by the TTS
// layer. Lives in its own module so WeatherCard.jsx keeps fast refresh happy.
export function briefSpeechText(brief) {
  if (!brief || !brief.headline) return '';
  const lines = Array.isArray(brief.lines) ? brief.lines.filter(Boolean) : [];
  return [brief.headline, ...lines].join(' ');
}
