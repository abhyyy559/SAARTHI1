/* ======================== WeatherGPT Frontend Logic ======================== */
const API = window.location.origin + '/api';
let lang = 'en', persona = 'general', lat = 17.385, lon = 78.4867;
let map = null, marker = null, warningLayer = null;
let weatherData = {}, chatMessages = [], isListening = false, recognition = null;
const CACHE_KEY = 'weathergpt_cache';
const CACHE_TTL = 30 * 60 * 1000;

/* ---- BOOT ---- */
document.addEventListener('DOMContentLoaded', () => {
  lang = localStorage.getItem('wgpt_lang') || 'en';
  persona = localStorage.getItem('wgpt_persona') || 'general';
  setLangButtons();
  setPersonaButtons();
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(p => { lat = p.coords.latitude; lon = p.coords.longitude; fetchAll(); }, () => fetchAll());
  } else { fetchAll(); }
  setupVoice();
});

/* ---- FETCH ALL ---- */
async function fetchAll() {
  showLoading(true);
  try {
    const [current, forecast] = await Promise.all([
      fetch(`${API}/weather/current?lat=${lat}&lon=${lon}`).then(r => r.json()),
      fetch(`${API}/weather/forecast?lat=${lat}&lon=${lon}`).then(r => r.json())
    ]);
    const district = current?.location?.district || 'Hyderabad';
    const warnings = await fetch(`${API}/weather/warnings?district=${encodeURIComponent(district)}`).then(r => r.json());
    weatherData = { current, forecast, warnings };
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: weatherData, ts: Date.now() }));
    renderDashboard();
  } catch (e) {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached) { weatherData = cached.data; renderDashboard(); showOfflineBanner(true, new Date(cached.ts)); }
    else { document.querySelector('.dashboard').innerHTML = '<div class="card full-width"><h2>Data unavailable</h2><p>Unable to load weather data.</p></div>'; }
  }
  showLoading(false);
}

/* ---- RENDER ---- */
function renderDashboard() {
  const d = weatherData;
  const loc = d.current?.location || {};
  document.getElementById('loc-label').textContent = `${loc.city || 'Hyderabad'}, ${loc.state || ''}`;
  renderCurrent(d.current?.current);
  renderWarning(d.warnings?.warning, d.warnings?.verified);
  renderRisk(d.warnings?.verified, d.current?.current);
  renderForecast(d.forecast?.forecast?.days);
  initMap(loc);
}

function renderCurrent(c) {
  if (!c) return;
  document.getElementById('temp-val').textContent = `${c.temperature}°C`;
  document.getElementById('cond-val').textContent = c.condition || '';
  document.getElementById('humidity-val').textContent = `${c.humidity}%`;
  document.getElementById('wind-val').textContent = `${c.wind_speed} km/h`;
  document.getElementById('rainfall-val').textContent = `${c.rainfall} mm`;
  document.getElementById('current-source').textContent = `${t('source', lang)}: IMD`;
  document.getElementById('current-updated').textContent = `${t('updated', lang)}: ${new Date(c.observed_at).toLocaleTimeString('en-IN')}`;
}

function renderWarning(w, v) {
  const el = document.getElementById('warning-card');
  if (!w || !v?.verified) { el.innerHTML = `<div class="no-warning">${sevDisplay('GREEN', lang)}</div><div class="source">${t('source', lang)}: ${t('imd', lang)}</div>`; el.className = 'card warning-card'; return; }
  const sv = SEVERITY[w.severity] || SEVERITY.GREEN;
  el.className = `card warning-card severity-${w.severity.toLowerCase()}`;
  el.innerHTML = `
    <div class="severity-badge ${w.severity.toLowerCase()}">${sv.icon} ${sv[lang] || sv.en}</div>
    <h3 style="font-size:1.1rem;margin:6px 0">${w.hazard}</h3>
    <p class="detail"><span>${t('source', lang)}</span><span>${t('imd', lang)}</span></p>
    <p class="detail"><span>${t('updated', lang)}</span><span>${new Date(w.issued_at).toLocaleString('en-IN')}</span></p>
    <p class="detail"><span>${t('until', lang)}</span><span>${new Date(w.valid_until).toLocaleString('en-IN')}</span></p>
    <button class="action-btn" onclick="askChat('${w.hazard} near me?')">What should I do?</button>
  `;
}

function renderRisk(v, c) {
  const el = document.getElementById('risk-bar');
  if (!v) { el.innerHTML = `<span class="label">${t('risk_label', lang)}</span><span class="value" style="color:var(--green)">LOW</span>`; return; }
  el.innerHTML = `
    <div><span class="label">${t('official', lang)}</span> <span class="value">${sevDisplay(v.severity, lang)}</span></div>
    <div><span class="label">${t('weathergpt_risk', lang)}</span> <span class="value" style="color:${RISK_COLORS[modRisk(v)] || 'var(--yellow)'}"> ${modRisk(v)}</span></div>
  `;
}

function modRisk(v) {
  const sw = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 }[v.severity] || 0;
  if (sw === 0) return 'LOW';
  if (sw === 1) return 'MODERATE';
  if (sw === 2) return 'HIGH';
  return 'CRITICAL';
}

function renderForecast(days) {
  const el = document.getElementById('forecast-strip');
  if (!days?.length) { el.innerHTML = '<div class="forecast-day">No forecast</div>'; return; }
  el.innerHTML = days.map((d, i) => `
    <div class="forecast-day ${i === 0 ? 'today' : ''}">
      <div class="day-label">${i === 0 ? t('today', lang) : new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' })}</div>
      <div class="icon">${weatherIcon(d.condition)}</div>
      <div class="temps">${d.min_temperature}–${d.max_temperature}°C</div>
      <div class="rain">${d.rainfall} mm</div>
    </div>
  `).join('');
}

/* ---- MAP ---- */
function initMap(loc) {
  const lat2 = loc?.latitude || 17.385, lon2 = loc?.longitude || 78.4867;
  if (!map) {
    map = L.map('map').setView([lat2, lon2], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
  }
  map.setView([lat2, lon2], 10);
  if (marker) map.removeLayer(marker);
  marker = L.marker([lat2, lon2]).addTo(map).bindPopup(loc?.city || 'Hyderabad').openPopup();
  const v = weatherData.warnings?.verified;
  if (v?.verified) {
    if (warningLayer) map.removeLayer(warningLayer);
    const color = { GREEN: '#22c55e', YELLOW: '#eab308', ORANGE: '#f97316', RED: '#ef4444' }[v.severity] || '#eab308';
    warningLayer = L.circle([lat2, lon2], { radius: 25000, color, fillOpacity: 0.25 }).addTo(map);
  }
}

/* ---- CHAT ---- */
async function sendChat(message) {
  if (!message?.trim()) return;
  appendMsg(message, 'user');
  try {
    const res = await fetch(`${API}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, latitude: lat, longitude: lon, language: lang, user_type: persona })
    }).then(r => r.json());
    const ev = res.evidence?.[0] || {};
    const sourceText = `${t('source', lang)}: ${ev.source || 'IMD'} | ${ev.type || ''} | ${ev.issued_at ? 'Issued ' + new Date(ev.issued_at).toLocaleString('en-IN') : ''}`;
    appendMsg(res.answer, 'bot', sourceText, res);
  } catch { appendMsg('Weather data temporarily unavailable. Please try again.', 'bot'); }
}

function appendMsg(text, type, source, res) {
  const win = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${type}`;
  div.innerHTML = type === 'bot' ? `${text}${source ? `<div class="source-line">${source}<div class="evidence-toggle" onclick="toggleEvidence(this)">ℹ️ ${t('why_answer', lang)}</div></div>` : ''}` : text;
  win.appendChild(div);
  win.scrollTop = win.scrollHeight;
  chatMessages.push({ text, type, source });
}

function toggleEvidence(el) {
  const panel = document.getElementById('evidence-panel');
  panel.classList.toggle('visible');
  if (panel.classList.contains('visible')) {
    const v = weatherData.warnings?.verified;
    document.getElementById('evidence-content').innerHTML = `
      <div class="ev-row"><span>${t('ev_source', lang)}</span><span>${t('imd', lang)}</span></div>
      <div class="ev-row"><span>${t('ev_info_used', lang)}</span><span>District Warning · City Forecast · Current Observation</span></div>
      <div class="ev-row"><span>${t('ev_validation', lang)}</span><span>${v ? renderValidation(v.validation) : '—'}</span></div>
      <div class="ev-row"><span>${t('ev_ai_role', lang)}</span><span>${t('ev_ai_text', lang)}</span></div>
    `;
  }
}

function renderValidation(val) {
  return Object.entries(val || {}).map(([k, v]) =>
    `${k}: <span class="ev-${v.toLowerCase()}">${v}</span>`
  ).join(' · ');
}

/* ---- VOICE ---- */
function setupVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    document.getElementById('chat-input').value = text;
    sendChat(text);
  };
  recognition.onend = () => { isListening = false; document.getElementById('mic-btn').classList.remove('listening'); };
}

function toggleVoice() {
  if (!recognition) return;
  if (isListening) { recognition.abort(); isListening = false; document.getElementById('mic-btn').classList.remove('listening'); }
  else { recognition.lang = lang === 'hi' ? 'hi-IN' : lang === 'te' ? 'te-IN' : 'en-IN'; recognition.start(); isListening = true; document.getElementById('mic-btn').classList.add('listening'); }
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[^\w\s.,!?]/g, ''));
  u.lang = lang === 'hi' ? 'hi-IN' : lang === 'te' ? 'te-IN' : 'en-IN';
  speechSynthesis.speak(u);
}

/* ---- UI CONTROLS ---- */
function setLangButtons() {
  document.querySelectorAll('.lang-btn').forEach(b => { b.classList.toggle('active', b.dataset.lang === lang); });
}
function setLang(l) { lang = l; localStorage.setItem('wgpt_lang', l); setLangButtons(); fetchAll(); }
function setPersonaButtons() {
  document.querySelectorAll('.persona-btn').forEach(b => { b.classList.toggle('active', b.dataset.persona === persona); });
}
function setPersona(p) { persona = p; localStorage.setItem('wgpt_persona', p); setPersonaButtons(); }
function askChat(q) { document.getElementById('chat-input').value = q; sendChat(q); }
function showLoading(on) { document.getElementById('loading').style.display = on ? 'block' : 'none'; }
function showOfflineBanner(on, ts) { const b = document.getElementById('offline-banner'); b.classList.toggle('visible', on); if (ts) document.getElementById('offline-ts').textContent = `${t('last_updated', lang)}: ${ts.toLocaleString('en-IN')}`; }
function useLocation() {
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => { lat = p.coords.latitude; lon = p.coords.longitude; fetchAll(); });
}
