import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Only Vite's build-time env substitution is replaced; execute the real client.
const source = readFileSync(new URL('../src/api.js', import.meta.url), 'utf8')
  .replace('import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE', 'undefined');
const { api } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('STT parses one response, sends language query and preserves recorded format', async () => {
  const original = globalThis.fetch;
  try {
    for (const language of ['en', 'hi', 'te']) {
      let calls = 0;
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(url, `/api/voice/transcribe?language=${language}`);
        assert.equal(options.body.get('file').name, 'speech.m4a');
        assert.equal(options.body.get('file').type, 'audio/mp4');
        return { ok: true, json: async () => ({ text: 'transcript', provider: 'test' }) };
      };
      assert.equal((await api.transcribe(new Blob(['test'], { type: 'audio/mp4' }), language)).text, 'transcript');
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = original; }
});

test('STT surfaces HTTP errors and preserves fallback flags', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(api.transcribe(new Blob(['test']), 'en'), /HTTP 503/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ text: '', using_browser_speech: true }) });
    assert.equal((await api.transcribe(new Blob(['test']), 'te')).using_browser_speech, true);
  } finally { globalThis.fetch = original; }
});
