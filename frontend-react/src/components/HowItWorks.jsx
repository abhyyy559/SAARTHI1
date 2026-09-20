// How It Works — icon-led explainer rows with honest live/stub labels (Round2).
//
// GIS Job 1: "Where am I?" → haversine_km nearest district from GPS (LIVE)
// GIS Job 2: "Am I inside warning polygon?" → point_in_polygon/parse_circle (IDLE — live CAP feeds carry no geometry, district-name matching does the work instead)
// GIS Job 3: "Hazard distance" → haversine_km for route impact (LIVE)
// WIS 2.0: MQTT push-ingest for official warnings (STUB — UNCONFIGURED; CAP polling used instead)
// Keep EN short, HI/TE optional (fallback to EN). Follow SourceStatus.jsx style with Card + prov badges.
import { Card, Prov } from './ui';
import Icon from './icons';
import { useApp } from '../store';
import { t } from '../i18n';

const EXPLAINERS = [
  {
    id: 'gis-location',
    title: 'GIS Job 1: Where am I?',
    desc: 'haversine_km — nearest district from GPS coordinates',
    icon: 'pin',
    status: 'LIVE',
    provenance: 'LIVE',
    hi: 'GPS से निकटतम जिला (हैवर्साइन दूरी)',
    te: 'GPS నుండి సమీపంలో জেল (హవెర్సైన్ దూరం)',
  },
  {
    id: 'gis-polygon',
    title: 'GIS Job 2: Am I inside warning polygon?',
    desc: 'point_in_polygon / parse_circle — live CAP feeds carry no geometry; district-name matching does the work',
    icon: 'map',
    status: 'IDLE',
    provenance: 'UNCONFIGURED',
    hi: 'चेतावनी बहुभुज के अंदर? (कैप में ज्यामिति नहीं — जिला नाम मिलान)',
    te: 'హెచ్చరిక బహుభుజంలో ఉన్నానా? (క్యాప్‌లో జ్యామితి లేదు — జిల్లా పేరు মিলియిస్తే పని)',
  },
  {
    id: 'gis-hazard',
    title: 'GIS Job 3: Hazard distance',
    desc: 'haversine_km — distance from route to hazard zone',
    icon: 'route',
    status: 'LIVE',
    provenance: 'LIVE',
    hi: 'मार्ग से खतरे के क्षेत्र तक दूरी (हैवर्साइन)',
    te: 'మార్గం నుండి ముగ్గు విభాగం వరకు దూరం (హవెర్సైన్)',
  },
  {
    id: 'wis2',
    title: 'WIS 2.0: MQTT push-ingest for official warnings',
    desc: 'STUB — UNCONFIGURED; CAP polling used instead. Broker and MQTT deps not set.',
    icon: 'radio',
    status: 'STUB',
    provenance: 'UNCONFIGURED',
    hi: 'MQTT पुश-इनजेस्ट (स्टब — अनकॉन्फिगर्ड; कैप पोलिंग उपयोग)',
    te: 'MQTT పుష్-ఇన్‌జెస్ట్ (స్టాబ్ — అన్‌కాన్ఫిగర్డ్; క్యాప్ పోలింగ్ వాడుక)',
  },
];

export default function HowItWorks() {
  const { lang } = useApp();
  // No server call needed — this is static architecture documentation
  return (
    <Card title={t(lang, 'howTitle')} sub={t(lang, 'howSub')}>
      <div className="how-list">
        {EXPLAINERS.map((e, i) => (
          <div className="how-row" key={e.id}>
            <span className="how-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
            <span className="tile-icon" aria-hidden="true"><Icon name={e.icon} size={20} /></span>
            <div className="how-text">
              <b>{e.title}</b>
              <span className="sub">{e.desc}</span>
              {lang === 'hi' && e.hi && <span className="sub">{e.hi}</span>}
              {lang === 'te' && e.te && <span className="sub">{e.te}</span>}
            </div>
            <div className="how-text" style={{ flex: '0 0 auto' }}>
              <Prov value={e.provenance} />
              <span className="prov" aria-label={e.status}>{e.status}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}