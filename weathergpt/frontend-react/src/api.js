// Backend client — v1 versioned API.
// Same origin by default (dist served by FastAPI). Set VITE_API_BASE at build
// time to point at a separately-hosted backend (e.g. https://saarthi-api.onrender.com).
const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const full = (p) => (p.startsWith('/api') ? `${BASE}${p}` : p);

let offlineSim = false;
export const setOfflineSim = (v) => { offlineSim = v; };

async function j(url, opts) {
  if (offlineSim) throw new Error('OFFLINE (simulated) — showing cached data only');
  const r = await fetch(full(url), opts);
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  return r.json();
}
const post = (url, body) =>
  j(full(url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const V = '/api/v1';

export const api = {
  health: () => j('/api/health'),
  sources: () => j('/api/sources'),
  status: () => j(`${V}/system/status`),
  current: (lat, lon) => j(`${V}/weather/current?lat=${lat}&lon=${lon}`),
  forecast: (lat, lon) => j(`${V}/weather/forecast?lat=${lat}&lon=${lon}`),
  warnings: (district, lat, lon) =>
    j(`${V}/warnings?district=${encodeURIComponent(district)}&lat=${lat}&lon=${lon}`),
  warningById: (id) => j(`${V}/warnings/${encodeURIComponent(id)}`),
  nowcast: (district, lat, lon) =>
    j(`/api/weather/nowcast?district=${encodeURIComponent(district)}&lat=${lat}&lon=${lon}`),
  models: (lat, lon) => j(`/api/weather/models?lat=${lat}&lon=${lon}`),
  climate: (lat, lon) => j(`${V}/climate/trends?lat=${lat}&lon=${lon}&years=20`),
  profileAdvisory: (loc, persona, language) => j(`${V}/advisories?district=${encodeURIComponent(loc.district)}&lat=${loc.lat}&lon=${loc.lon}&user_type=${encodeURIComponent(persona)}&language=${encodeURIComponent(language)}`),
  advisory: (severity, userType) => j(`${V}/advisories?severity=${severity}&user_type=${userType}`),
  impact: (a, b, userType = 'driver') =>
    j(`${V}/impact/analyze?lat1=${a.lat}&lon1=${a.lon}&lat2=${b.lat}&lon2=${b.lon}&user_type=${userType}`),
  chat: (body) => post(`${V}/chat`, body),
  guidance: (q, lang) => j(`${V}/emergency/guidance?q=${encodeURIComponent(q)}&lang=${lang}`),
  sos: (payload) => post(`${V}/emergency/messages`, payload),
  inbox: () => j(`${V}/emergency/messages`),
  syncEmergency: () => post(`${V}/emergency/sync`, {}),
  report: (payload) => post(`${V}/reports`, payload),
  reports: (district = '') => j(`${V}/reports?district=${encodeURIComponent(district)}`),
  voiceStatus: () => j('/api/voice/status'),
  transcribe: (blob, language) => {
    const fd = new FormData();
    const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav' : 'webm';
    fd.append('file', blob, `speech.${extension}`);
    return j(`/api/voice/transcribe?language=${encodeURIComponent(language)}`, { method: 'POST', body: fd });
  },
  synthesize: (text, language) =>
    post('/api/voice/synthesize', { text, language }),
  speak: (text, language) => post('/api/voice/synthesize', { text, language }),
};

export const HYD = { lat: 17.385, lon: 78.4867, district: 'Hyderabad' };
export const EMERGENCY_TYPES = [
  'NEED_HELP', 'IM_HERE', 'MEDICAL_HELP', 'NEED_WATER', 'NEED_FOOD',
  'DANGER_HERE', 'PEOPLE_TRAPPED', 'ROAD_BLOCKED', 'IM_SAFE',
];
