// API contract: the rebuilt frontend must preserve the exact api.js surface the
// backend expects. Executes the real client via the data-URL trick and asserts
// routes, methods, and payloads against the real implementation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/api.js', import.meta.url), 'utf8')
  .replace('import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE', 'undefined');
const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { api, HYD, EMERGENCY_TYPES, FETCH_TIMEOUT_MS } = mod;

const EXPECTED = [
  'health', 'sources', 'status', 'resolveLocation', 'searchLocation',
  'current', 'forecast', 'warnings', 'warningById', 'nowcast', 'models',
  'aviationBriefing', 'climate', 'profileAdvisory', 'advisoryCards', 'advisory',
  'impact', 'chat', 'chatStream', 'guidance', 'sos', 'inbox', 'syncEmergency',
  'simulateRelay', 'report', 'reports', 'notifications', 'notificationsUnread',
  'notificationsRead', 'notificationsOpened', 'notificationsAck', 'ack',
  'coverageByDistrict', 'sourceStatus', 'voiceStatus', 'pushVapid',
  'pushSubscribe', 'pushUnsubscribe', 'pushTest', 'pushStatus', 'pushCheck',
  'transcribe', 'synthesize', 'speak', 'speakStream',
];

test('all expected api functions exist', () => {
  const missing = EXPECTED.filter((k) => typeof api[k] !== 'function');
  assert.deepEqual(missing, [], `missing api functions: ${missing.join(', ')}`);
});

test('domain alias groups exist', () => {
  for (const [group, fns] of Object.entries({
    ackApi: ['send'], coverageApi: ['byDistrict'], notificationsApi: ['list', 'unread', 'markRead', 'markOpened', 'ack'],
  })) {
    for (const f of fns) assert.equal(typeof mod[group][f], 'function', `${group}.${f}`);
  }
});

test('HYD default location shape', () => {
  assert.equal(typeof HYD.lat, 'number');
  assert.equal(typeof HYD.lon, 'number');
  assert.ok(HYD.district);
});

test('EMERGENCY_TYPES list and FETCH_TIMEOUT_MS', () => {
  assert.ok(Array.isArray(EMERGENCY_TYPES) && EMERGENCY_TYPES.length >= 3);
  assert.equal(FETCH_TIMEOUT_MS, 5000);
});

function mockFetch(handler) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return handler(String(url), opts);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

// A fetch mock that honors AbortSignal like the real fetch does — the client's
// timeout works through signal abortion, so a mock that ignores the signal
// would hang forever.
function abortableFetch(handler) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    calls.push({ url: String(url), opts });
    const onAbort = () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      reject(e);
    };
    if (opts.signal?.aborted) { onAbort(); return; }
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(handler(String(url), opts)).then(
      (r) => { opts.signal?.removeEventListener('abort', onAbort); resolve(r); },
      (e) => { opts.signal?.removeEventListener('abort', onAbort); reject(e); },
    );
  });
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

test('current() hits /api/v1/weather/current with lat, lon, lang', async () => {
  const m = mockFetch(async () => ok({ current: {} }));
  try {
    await api.current(17.385, 78.4867, { lang: 'hi' });
    assert.ok(m.calls[0].url.includes('/api/v1/weather/current'), m.calls[0].url);
    assert.ok(m.calls[0].url.includes('lat=17.385'), m.calls[0].url);
    assert.ok(m.calls[0].url.includes('lang=hi'), m.calls[0].url);
  } finally { m.restore(); }
});

test('current() passes the role through', async () => {
  const m = mockFetch(async () => ok({ current: {} }));
  try {
    await api.current(17.385, 78.4867, { role: 'farmer', lang: 'te' });
    assert.ok(m.calls[0].url.includes('role=farmer'), m.calls[0].url);
  } finally { m.restore(); }
});

test('warnings() hits /api/v1/warnings with district', async () => {
  const m = mockFetch(async () => ok({ status: 'ok' }));
  try {
    await api.warnings('Hyderabad', 17.385, 78.4867);
    assert.ok(m.calls[0].url.includes('/api/v1/warnings'), m.calls[0].url);
    assert.ok(m.calls[0].url.includes('district=Hyderabad'), m.calls[0].url);
  } finally { m.restore(); }
});

test('advisoryCards() hits /api/advisory/cards with persona + lang', async () => {
  const m = mockFetch(async () => ok({ cards: [] }));
  try {
    await api.advisoryCards({ lat: 17.385, lon: 78.4867, district: 'Hyderabad' }, 'farmer', 'te');
    assert.ok(m.calls[0].url.includes('/api/advisory/cards'), m.calls[0].url);
    assert.ok(m.calls[0].url.includes('persona=farmer'), m.calls[0].url);
    assert.ok(m.calls[0].url.includes('lang=te'), m.calls[0].url);
  } finally { m.restore(); }
});

test('chatStream() yields parsed NDJSON tokens and final answer', async () => {
  const ndjson = '{"type":"token","text":"hello"}\n{"type":"token","text":" world"}\n{"type":"final","answer":"hello world"}\n';
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) { c.enqueue(enc.encode(ndjson)); c.close(); },
  });
  const m = mockFetch(async () => ({ ok: true, status: 200, body: stream }));
  try {
    const lines = [];
    for await (const line of api.chatStream({ message: 'hi', language: 'en' })) lines.push(line);
    assert.ok(lines.some((l) => l.type === 'token' && l.text === 'hello'));
    assert.ok(lines.some((l) => l.type === 'final' && l.answer === 'hello world'));
    const post = m.calls[0];
    assert.equal(post.opts.method, 'POST');
    assert.ok(post.url.includes('/api/chat/stream'), post.url);
    assert.equal(JSON.parse(post.opts.body).message, 'hi');
  } finally { m.restore(); }
});

test('sos() POSTs to /api/v1/emergency/messages with type and coords', async () => {
  const m = mockFetch(async () => ok({ status: 'ok' }));
  try {
    await api.sos({ type: 'NEED_HELP', lat: 17.385, lon: 78.4867, district: 'Hyderabad', note: 'help' });
    assert.ok(m.calls[0].url.includes('/api/v1/emergency/messages'), m.calls[0].url);
    const body = JSON.parse(m.calls[0].opts.body);
    assert.equal(body.type, 'NEED_HELP');
    assert.equal(body.lat, 17.385);
  } finally { m.restore(); }
});

test('transcribe() sends language query and preserves recorded format', async () => {
  const m = mockFetch(async (url, opts) => {
    assert.ok(url.includes('/api/voice/transcribe?language=hi'), url);
    assert.equal(opts.body.get('file').name, 'speech.m4a');
    assert.equal(opts.body.get('file').type, 'audio/mp4');
    return ok({ text: 'transcript', provider: 'test' });
  });
  try {
    const r = await api.transcribe(new Blob(['test'], { type: 'audio/mp4' }), 'hi');
    assert.equal(r.text, 'transcript');
    assert.equal(m.calls.length, 1);
  } finally { m.restore(); }
});

test('HTTP errors surface with status', async () => {
  const m = mockFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  try {
    await assert.rejects(api.health(), /HTTP 503/);
  } finally { m.restore(); }
});

test('slow server aborts at the fetch timeout', async () => {
  const m = abortableFetch(async () => new Promise(() => {}));
  try {
    await assert.rejects(api.current(1, 2), /took too long/);
  } finally { m.restore(); }
}, { timeout: 15000 });
