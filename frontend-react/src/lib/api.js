// Backend client. VITE_API_URL points at a separately hosted backend; empty
// means same origin (Vite dev proxy, or FastAPI serving the built app).
const BASE = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '');
const full = (p) => `${BASE}${p}`;

export const TIMEOUT_MS = 25000;

async function request(path, opts = {}, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(full(path), { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`timeout on ${path}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const get = (path, timeoutMs) => request(path, {}, timeoutMs);
const post = (path, body, timeoutMs) => request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}, timeoutMs);

const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

// Chat answers stream as NDJSON: meta (verdict, weather) -> token* -> final? -> done.
async function* chatStream(body, signal) {
  const r = await fetch(full('/api/chat/stream'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} on /api/chat/stream`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf);
}

export const api = {
  warnings: (loc) => get(`/api/v1/warnings?${q({ district: loc.district, lat: loc.lat, lon: loc.lon })}`, 30000),
  current: (loc) => get(`/api/v1/weather/current?${q({ district: loc.district, lat: loc.lat, lon: loc.lon })}`),
  forecast: (loc) => get(`/api/v1/weather/forecast?${q({ district: loc.district, lat: loc.lat, lon: loc.lon })}`),
  advisory: (loc, persona, lang) => get(`/api/v1/advisories?${q({
    district: loc.district, lat: loc.lat, lon: loc.lon, user_type: persona, language: lang })}`, 30000),
  cards: (loc, persona, lang) => get(`/api/advisory/cards?${q({ lat: loc.lat, lon: loc.lon, persona, lang })}`, 30000),
  resolve: (lat, lon) => get(`/api/location/resolve?${q({ lat, lon })}`),
  search: (text) => get(`/api/location/search?${q({ q: text })}`).then((d) => d.results || []),
  sources: () => get('/api/sources'),
  voiceStatus: () => get('/api/voice/status', 4000),
  synthesize: (text, language) => post('/api/voice/synthesize', { text, language }, 20000),
  transcribe: async (blob, language) => {
    const fd = new FormData();
    fd.append('file', blob, blob.type.includes('wav') ? 'speech.wav' : 'speech.webm');
    return request(`/api/voice/transcribe?${q({ language })}`, { method: 'POST', body: fd }, 30000);
  },
  chatStream,
};
