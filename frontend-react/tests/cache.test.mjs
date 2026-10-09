import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCache, fetchWithCache, ageMinutes, MAX_ENTRIES } from '../src/lib/cache.js';

function memStorage(limitBytes = Infinity) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      let total = v.length;
      for (const [kk, vv] of m) if (kk !== k) total += vv.length;
      if (total > limitBytes) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k) => m.delete(k),
    size: () => m.size,
  };
}

test('saved data comes back with the time it was saved', () => {
  const c = makeCache(memStorage());
  c.save('warn:Hyderabad', { verdict: { level: 'LOW' } }, 1000);
  assert.deepEqual(c.read('warn:Hyderabad'), { savedAt: 1000, data: { verdict: { level: 'LOW' } } });
  assert.equal(c.read('nope'), null);
});

test('network first; saved copy only when the network fails', async () => {
  const c = makeCache(memStorage());
  const live = await fetchWithCache('k', async () => ({ n: 1 }), c);
  assert.equal(live.source, 'live');
  const saved = await fetchWithCache('k', async () => { throw new Error('offline'); }, c);
  assert.equal(saved.source, 'saved');
  assert.deepEqual(saved.data, { n: 1 });
  assert.equal(saved.savedAt, live.savedAt, 'age is the age of the live fetch, never refreshed');
  const none = await fetchWithCache('other', async () => { throw new Error('offline'); }, c);
  assert.equal(none.source, 'none');
  assert.equal(none.data, null);
});

test('oldest entries are dropped when the phone is full or the list is long', () => {
  const c = makeCache(memStorage());
  for (let i = 0; i < MAX_ENTRIES + 5; i++) c.save(`k${i}`, { i }, i);
  assert.equal(c.read('k0'), null);
  assert.deepEqual(c.read(`k${MAX_ENTRIES + 4}`).data, { i: MAX_ENTRIES + 4 });

  const tight = makeCache(memStorage(400));
  tight.save('a', 'x'.repeat(150), 1);
  tight.save('b', 'y'.repeat(150), 2);
  assert.equal(tight.save('c', 'z'.repeat(150), 3), true, 'quota: evicts a, keeps the newest');
  assert.equal(tight.read('a'), null);
  assert.ok(tight.read('c'));
});

test('a broken storage never crashes the app', async () => {
  const c = makeCache(null);
  assert.equal(c.save('k', 1), false);
  assert.equal(c.read('k'), null);
  const r = await fetchWithCache('k', async () => 2, c);
  assert.equal(r.source, 'live');
});

test('age in minutes', () => {
  assert.equal(ageMinutes(null), null);
  assert.equal(ageMinutes(0, 5 * 60000), 5);
});
