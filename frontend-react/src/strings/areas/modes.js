// The three source modes (docs/SOURCE-MODES.md) and the switch that selects one.
//
// The rule these strings follow: naming the mode is not enough. "HYBRID" tells a
// fisherman nothing. Each label says which sources are actually carrying the
// answer, and each carries a short note for someone who will not read a
// paragraph. Mode ids ('demo' | 'imd' | 'hybrid') stay machine-readable and are
// never translated.
export default {
  en: {
    modeLabel: 'Data source',
    modeDemo: 'DEMO',
    modeImd: 'IMD only',
    modeHybrid: 'Hybrid',
    modeDemoNote: 'Sample data — not a real warning',
    modeImdNote: 'Official IMD data only',
    modeHybridNote: 'IMD warnings, Open-Meteo weather',
    modeSwitched: 'Mode changed:',
    modeSwitchFailed: 'Could not switch mode — server unreachable',
    modeWeather: 'Weather',
    modeWarnings: 'Warnings',
  },
  hi: {
    modeLabel: 'डेटा स्रोत',
    modeDemo: 'डेमो',
    modeImd: 'केवल IMD',
    modeHybrid: 'हाइब्रिड',
    modeDemoNote: 'नमूना डेटा — असली चेतावनी नहीं',
    modeImdNote: 'सिर्फ़ सरकारी IMD डेटा',
    modeHybridNote: 'IMD चेतावनी, Open-Meteo मौसम',
    modeSwitched: 'मोड बदला:',
    modeSwitchFailed: 'मोड नहीं बदल सका — सर्वर से संपर्क नहीं',
    modeWeather: 'मौसम',
    modeWarnings: 'चेतावनी',
  },
  te: {
    modeLabel: 'డేటా మూలం',
    modeDemo: 'డెమో',
    modeImd: 'IMD మాత్రమే',
    modeHybrid: 'హైబ్రిడ్',
    modeDemoNote: 'నమూనా డేటా — నిజమైన హెచ్చరికలు కావు',
    modeImdNote: 'అధికారిక IMD డేటా మాత్రమే',
    modeHybridNote: 'IMD హెచ్చరికలు, Open-Meteo వాతావరణం',
    modeSwitched: 'మోడ్ మార్చబడింది:',
    modeSwitchFailed: 'మోడ్ మార్చలేకపోయాం — సర్వర్ అందుబాటులో లేదు',
    modeWeather: 'వాతావరణం',
    modeWarnings: 'హెచ్చరికలు',
  },
};
