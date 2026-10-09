import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, readSnapshot, encodeSnapshot, decodeSnapshot, makeShareLink, payloadFromHash, MAX_LINK } from '../src/lib/share.js';

const input = {
  lang: 'te', persona: 'fisherman', savedAt: 1791530000000,
  loc: { district: 'Visakhapatnam', state: 'Andhra Pradesh', lat: 17.6868, lon: 83.2185 },
  verdict: { level: 'HIGH', severity: 'ORANGE', hazard: 'Lightning', checked_sources: ['NDMA-SACHET'], unchecked_sources: ['IMD'] },
  current: { temperature: 33.7, condition: 'Mostly Clear', rainfall: 0, wind_speed: 5.3, humidity: 49, source: 'Open-Meteo' },
  days: [
    { date: '2026-10-09', condition: 'Mostly Clear', rainfall: 0, max_temperature: 33.8, min_temperature: 25.3 },
    { date: '2026-10-10', condition: 'Light Drizzle', rainfall: 0.6, max_temperature: 33.6, min_temperature: 24.8 },
    { date: '2026-10-11', condition: 'Light Drizzle', rainfall: 0.2, max_temperature: 33.2, min_temperature: 25.8 },
    { date: '2026-10-12', condition: 'Light Drizzle', rainfall: 0.1, max_temperature: 33.6, min_temperature: 25.5 },
  ],
  alerts: Array.from({ length: 4 }, (_, i) => ({
    severity: 'ORANGE', hazard: 'Lightning', sender: 'Andhra-Pradesh-SDMA', expires: '2026-10-09T22:20:00+05:30',
    identifier: `id-${i}`,
    headline: 'There is a possibility of lightning in your area. During thunderstorms, avoid trees, towers, poles, fields, and open spaces. Seek shelter in safe buildings - Andhra Pradesh Government.',
  })),
  advisory: 'ప్రస్తుతం తీరానికి తీవ్ర వాతావరణ హెచ్చరిక లేదు. బయలుదేరే ముందు మళ్లీ తనిఖీ చేయండి - పరిస్థితులు వేగంగా మారుతాయి. ఇది సాధారణ సూచన మాత్రమే, పడవ-నిర్దిష్ట సిఫార్సు కాదు.',
};

test('snapshot round-trips through the link payload', async () => {
  const snap = buildSnapshot(input);
  const back = readSnapshot(await decodeSnapshot(await encodeSnapshot(snap)));
  assert.equal(back.loc.district, 'Visakhapatnam');
  assert.equal(back.verdict.level, 'HIGH');
  assert.deepEqual(back.verdict.unchecked_sources, ['IMD']);
  assert.equal(back.current.temperature, 33.7);
  assert.equal(back.days.length, 3);
  assert.equal(back.alerts.length, 3);
  assert.equal(back.advisory, input.advisory);
  assert.equal(back.savedAt, input.savedAt, 'the time the data was fetched travels with it');
});

test('share link stays scannable even with long Telugu text', async () => {
  const link = await makeShareLink('https://weathergpt.example.app', input);
  assert.ok(link.length <= MAX_LINK, `link is ${link.length} chars`);
  const payload = payloadFromHash(link.slice(link.indexOf('#')));
  assert.ok(payload);
  const back = readSnapshot(await decodeSnapshot(payload));
  assert.equal(back.verdict.severity, 'ORANGE', 'the verdict is never dropped to fit');
});

test('uncompressed fallback decodes too', async () => {
  const snap = buildSnapshot(input, 0);
  const json = Buffer.from(JSON.stringify(snap)).toString('base64url');
  assert.equal(readSnapshot(await decodeSnapshot(`j${json}`)).loc.district, 'Visakhapatnam');
});

test('garbage links are rejected, not half-rendered', async () => {
  assert.equal(payloadFromHash('#s=has spaces'), null);
  assert.equal(payloadFromHash('#other'), null);
  await assert.rejects(() => decodeSnapshot('xabc'));
  assert.throws(() => readSnapshot({ v: 99 }));
});

test('hop count travels with the snapshot and is capped', async () => {
  const { MAX_HOPS } = await import('../src/lib/share.js');
  const once = readSnapshot(await decodeSnapshot(await encodeSnapshot(buildSnapshot({ ...input, hops: 2 }))));
  assert.equal(once.hops, 2);
  const capped = readSnapshot(await decodeSnapshot(await encodeSnapshot(buildSnapshot({ ...input, hops: 99 }))));
  assert.equal(capped.hops, MAX_HOPS);
});

test('plain-text QR summary: short, in the reader\'s language, ends with 112', async () => {
  const { textSummary } = await import('../src/lib/share.js');
  const te = textSummary(input, 'te');
  assert.ok(te.length <= 420, te.length);
  assert.ok(te.startsWith('WeatherGPT · Visakhapatnam'));
  assert.ok(te.includes('చాలా జాగ్రత్త'), 'verdict label in Telugu');
  assert.ok(te.trim().endsWith('112'));
  const en = textSummary({ ...input, verdict: { level: 'LOW' } }, 'en');
  assert.ok(en.includes('No official alert for your district'));
});

test('text QR: duplicate alerts collapse, and state alerts are marked as elsewhere', async () => {
  const { textSummary } = await import('../src/lib/share.js');
  const dup = { severity: 'ORANGE', hazard: 'Lightning', expires: '2026-10-09T17:25:00+05:30' };
  const txt = textSummary({ ...input, verdict: { level: 'LOW' }, alerts: [dup, { ...dup }] }, 'en');
  assert.equal(txt.split('Lightning').length - 1, 1, txt);
  assert.ok(txt.includes('Elsewhere in your state:'), txt);
});
