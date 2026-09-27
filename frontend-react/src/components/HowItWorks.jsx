// How It Works — icon-led explainer rows with honest live/stub labels (Round2).
//
// GIS Job 1: "Where am I?" → haversine_km nearest district from GPS (LIVE)
// GIS Job 2: "Which warnings apply to my district?" → district-name matching (LIVE — live CAP feeds carry no geometry, so polygon math activates only when geometry is supplied)
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
    title: 'GIS Job 2: Which warnings apply to my district?',
    desc: 'LIVE — district-name matching; polygon/circle matching activates only when CAP geometry is supplied.',
    icon: 'map',
    status: 'LIVE',
    provenance: 'LIVE',
    hi: 'लाइव — जिला-नाम मिलान; CAP ज्यामिति मिलने पर पॉलीगॉन/सर्कल मिलान सक्रिय होता है।',
    te: 'లైవ్ — జిల్లా-పేరు సరిపోలిక; CAP జ్యామితి అందితే పాలిగాన్/వృత్త సరిపోలిక సక్రియం అవుతుంది.',
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
    desc: 'STUB — UNCONFIGURED; public WIS2 brokers exist but the live MQTT subscription is unverified, so CAP polling carries official warnings.',
    icon: 'radio',
    status: 'STUB',
    provenance: 'UNCONFIGURED',
    hi: 'स्टब — अनकॉन्फ़िगर्ड; सार्वजनिक WIS2 ब्रोकर मौजूद हैं पर लाइव MQTT सब्सक्रिप्शन सत्यापित नहीं — आधिकारिक चेतावनियाँ CAP पोलिंग से।',
    te: 'స్టబ్ — అన్‌కాన్ఫిగర్డ్; పబ్లిక్ WIS2 బ్రోకర్లు ఉన్నాయి కానీ లైవ్ MQTT సబ్‌స్క్రిప్షన్ ధృవీకరించబడలేదు — అధికారిక హెచ్చరికలు CAP పోలింగ్ ద్వారా.',
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