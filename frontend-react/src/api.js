// Backend client — v1 versioned API.
// The API base is env-driven: set VITE_API_URL (preferred; VITE_API_BASE is
// kept as a legacy alias) at build time to point at a separately-hosted
// backend (e.g. https://saarthi-api.onrender.com). Default '' = same origin,
// which works both when the Vite dev proxy forwards /api to the FastAPI
// backend (127.0.0.1:8000) and when the built dist is served by FastAPI itself.
const BASE = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const full = (p) => (p.startsWith('/api') ? `${BASE}${p}` : p);

let offlineSim = false;
export const setOfflineSim = (v) => { offlineSim = v; };

// A 403 on /api/demo/* means the backend is NOT in demo mode while the UI
// thinks it is (backend restarted, .env default, mode flipped elsewhere).
// The store registers a handler to re-sync the mode; throttled so a polling
// page can't turn one mismatch into a request storm.
let demoForbiddenHandler = null;
let lastDemo403 = 0;
export const onDemoForbidden = (fn) => { demoForbiddenHandler = fn; };

/** Max time for any server round-trip: 5 seconds, never infinite (B3). */
export const FETCH_TIMEOUT_MS = 5000;

// Offline queue for mutations when offline-sim is on
const offlineQueue = [];
export function queueMutation(fn) {
  if (offlineSim) {
    offlineQueue.push(fn);
    return Promise.resolve({ queued: true });
  }
  return fn();
}

export function flushQueue() {
  const queue = [...offlineQueue];
  offlineQueue.length = 0;
  return Promise.all(queue.map(fn => fn().catch(() => {})));
}

async function j(url, opts, timeoutMs) {
  if (offlineSim) throw new Error('OFFLINE (simulated) — showing cached data only');
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(full(url), { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timeout — server took too long (${url})`);
    throw e;
  } finally {
    clearTimeout(id);
  }
  if (!r.ok) {
    if (r.status === 403 && /\/api\/demo\//.test(url) && demoForbiddenHandler) {
      const now = Date.now();
      if (now - lastDemo403 > 10000) {
        lastDemo403 = now;
        demoForbiddenHandler();
      }
    }
    throw new Error(`HTTP ${r.status} on ${url}`);
  }
  return r.json();
}
const post = (url, body) =>
  j(full(url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const V = '/api/v1';

export const api = {
  health: () => j('/api/health'),
  mode: () => j('/api/mode'),
  setMode: (mode) => post('/api/mode', { mode }),
  sources: () => j('/api/sources'),
  status: () => j(`${V}/system/status`),
  resolveLocation: (lat, lon) => j(`${V}/location/resolve?lat=${lat}&lon=${lon}`).then((d) => d.location || d),
  searchLocation: (q) => j(`/api/location/search?q=${encodeURIComponent(q)}`).then((d) => d.results || []),
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
  simulateRelay: (payload) => post(`${V}/emergency/simulate`, payload),
  report: (payload) => post(`${V}/reports`, payload),
  reports: (district = '') => j(`${V}/reports?district=${encodeURIComponent(district)}`),
  // Notification Center (server-side lifecycle log; the OS notification is
  // fire-and-forget, this is the trail the user can scroll).
  notifications: (district, device) =>
    j(`/api/notifications?district=${encodeURIComponent(district || '')}&device=${encodeURIComponent(device || '')}`),
  notificationsUnread: (district, device) =>
    j(`/api/notifications/unread?district=${encodeURIComponent(district || '')}&device=${encodeURIComponent(device || '')}`),
  notificationsRead: (payload) => post('/api/notifications/read', payload),
  notificationsOpened: (payload) => post('/api/notifications/opened', payload),
  notificationsAck: (payload) => post('/api/notifications/ack', payload),
  notificationsReset: () => post('/api/notifications/reset', {}),
  // Demo/Admin panel + authority coverage (demo mode only on the backend).
  demoAlerts: (district = '') => j(`/api/demo/alerts?district=${encodeURIComponent(district)}`),
  demoCreate: (payload) => post('/api/demo/alerts', payload),
  demoAction: (id, action, patch) => post(`/api/demo/alerts/${id}/${action}`, patch || {}),
  demoScenario: (name) => post('/api/demo/alerts/scenario', { name }),
  demoNotify: (id) => post('/api/demo/alerts/notify', { alert_id: id }),
  demoReset: () => post('/api/demo/alerts/reset', {}),
  demoRelay: (payload) => post('/api/demo/relay', payload),
  coverageSeed: (alertId, total) => post('/api/demo/coverage/seed', { alert_id: alertId, total }),
  coverage: (alertId) => j(`/api/demo/coverage/${encodeURIComponent(alertId)}`),
  // Ack telemetry + district coverage (Round2 T3.3: POST /api/ack,
  // GET /api/coverage?district=). Additive — demo/ack client for S1.2.5.
  ack: (payload) => post('/api/ack', payload),
  coverageByDistrict: (district = '') => j(`/api/coverage?district=${encodeURIComponent(district)}`),
  // Alias: SourceStatus calls api.sourceStatus(); api.sources() stays intact.
  sourceStatus: () => j('/api/sources'),
  demoAlert: (id) => j(`/api/demo/alerts/${encodeURIComponent(id)}`),
  voiceStatus: () => j('/api/voice/status'),
  // Background push. Registering a subscription is what lets the backend reach
  // this device while the app is closed.
  pushVapid: () => j('/api/push/vapid'),
  pushSubscribe: (payload) => post('/api/push/subscribe', payload),
  pushUnsubscribe: (endpoint) => post('/api/push/unsubscribe', { endpoint }),
  pushTest: (payload) => post('/api/push/test', payload || {}),
  pushStatus: () => j('/api/push/status'),
  pushCheck: () => post('/api/push/check', {}),
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
// Round2 S1.2.5 aliases: same endpoints, grouped by domain so Admin/AlertDetails/
// Coverage views import intent-revealing names. All hit the identical routes.
export const demoAlertApi = {
  list: (district = '') => api.demoAlerts(district),
  get: (id) => api.demoAlert(id),
  create: (payload) => api.demoCreate(payload),
  action: (id, action, patch) => api.demoAction(id, action, patch),
  scenario: (name) => api.demoScenario(name),
  notify: (id) => api.demoNotify(id),
  reset: () => api.demoReset(),
  relay: (payload) => api.demoRelay(payload),
};
export const ackApi = {
  send: (payload) => api.ack(payload),
};
export const coverageApi = {
  byDistrict: (district = '') => api.coverageByDistrict(district),
  byAlert: (alertId) => api.coverage(alertId),
  seed: (alertId, total) => api.coverageSeed(alertId, total),
};
export const notificationsApi = {
  list: (district, device) => api.notifications(district, device),
  unread: (district, device) => api.notificationsUnread(district, device),
  markRead: (payload) => api.notificationsRead(payload),
  markOpened: (payload) => api.notificationsOpened(payload),
  ack: (payload) => api.notificationsAck(payload),
  reset: () => api.notificationsReset(),
};
export const EMERGENCY_TYPES = [
  'NEED_HELP', 'IM_HERE', 'MEDICAL_HELP', 'NEED_WATER', 'NEED_FOOD',
  'DANGER_HERE', 'PEOPLE_TRAPPED', 'ROAD_BLOCKED', 'IM_SAFE',
];
