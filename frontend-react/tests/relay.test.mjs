import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { makeShareLink, textSummary, MAX_HOPS } from '../src/lib/share.js';
import { receiveScanned, canPassOn } from '../src/lib/relay.js';

const input = {
  lang: 'te', persona: 'fisherman', savedAt: 1791530000000, hops: 0,
  loc: { district: 'Puri', state: 'Odisha', lat: 19.81, lon: 85.83 },
  verdict: { level: 'HIGH', severity: 'ORANGE', hazard: 'Lightning', checked_sources: ['NDMA-SACHET'], unchecked_sources: ['IMD'] },
  current: { temperature: 31.2, condition: 'Partly Cloudy', rainfall: 0, wind_speed: 12, humidity: 70, source: 'Open-Meteo' },
  days: [{ date: '2026-10-09', condition: 'Rain', rainfall: 4, max_temperature: 31, min_temperature: 25 },
         { date: '2026-10-10', condition: 'Rain', rainfall: 12, max_temperature: 30, min_temperature: 25 }],
  alerts: [{ severity: 'ORANGE', hazard: 'Lightning', headline: 'Lightning likely over Puri and Ganjam districts. Stay indoors.', expires: '2026-10-09T20:00:00+05:30', sender: 'Odisha-SDMA' }],
  advisory: 'సముద్రంలో గాలి వేగం ఎక్కువగా ఉండవచ్చు.',
};

// Render a QR to RGBA pixels (4 px per module, quiet zone) and read it back
// with the same decoder the in-app scanner uses.
function decodeLikeACamera(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'L' });
  const n = qr.modules.size;
  const px = 4;
  const quiet = 4;
  const w = (n + quiet * 2) * px;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < px; dy++) {
        for (let dx = 0; dx < px; dx++) {
          const i = (((y + quiet) * px + dy) * w + (x + quiet) * px + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, w, w)?.data;
}

test('a share link survives QR encode + camera-style decode', async () => {
  const link = await makeShareLink('https://weathergpt.example.app', input);
  assert.equal(decodeLikeACamera(link), link);
});

test('the plain-text QR decodes too (no internet needed to read it)', () => {
  const text = textSummary(input, 'te');
  assert.equal(decodeLikeACamera(text), text);
});

test('receiving counts one more hop, and the cap stops endless relaying', async () => {
  const link = await makeShareLink('https://x.app', input);
  const { list, id } = await receiveScanned(link, 1000);
  const item = list.find((x) => x.id === id);
  assert.equal(item.kind, 'snap');
  assert.equal(item.snap.hops, 1);
  assert.equal(item.snap.loc.district, 'Puri');
  assert.ok(canPassOn(item));

  const tired = await makeShareLink('https://x.app', { ...input, hops: MAX_HOPS });
  const r2 = await receiveScanned(tired, 2000);
  const item2 = r2.list.find((x) => x.id === r2.id);
  assert.equal(item2.snap.hops, MAX_HOPS);
  assert.equal(canPassOn(item2), false);
});

test('our text QR is kept; anything else is refused', async () => {
  const { list, id } = await receiveScanned(textSummary(input, 'en'));
  assert.equal(list.find((x) => x.id === id).kind, 'text');
  await assert.rejects(() => receiveScanned('https://example.com/some-other-qr'));
});
