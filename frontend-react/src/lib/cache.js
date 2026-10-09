// Device cache: the last good answer for every screen, kept on the phone so
// the app still works with no network. Every entry carries the time it was
// fetched, and the UI always shows that time: saved data is never passed off
// as live.
//
// Pure module (storage injected) so node tests can exercise it.

const PREFIX = 'wgpt2:';
const INDEX = `${PREFIX}index`;
export const MAX_ENTRIES = 80;

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function makeCache(storage = defaultStorage()) {
  const readIndex = () => {
    try { return JSON.parse(storage?.getItem(INDEX) || '[]'); } catch { return []; }
  };
  const writeIndex = (keys) => {
    try { storage?.setItem(INDEX, JSON.stringify(keys)); } catch { /* full or blocked */ }
  };

  function save(key, data, now = Date.now()) {
    if (!storage) return false;
    const entry = JSON.stringify({ savedAt: now, data });
    const keys = readIndex().filter((k) => k !== key);
    keys.push(key);
    // Oldest first out, so a phone that browsed many districts keeps the newest.
    while (keys.length > MAX_ENTRIES) {
      try { storage.removeItem(PREFIX + keys.shift()); } catch { /* ignore */ }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        storage.setItem(PREFIX + key, entry);
        writeIndex(keys);
        return true;
      } catch {
        // Quota: drop the oldest other entry and retry.
        const victim = keys.find((k) => k !== key);
        if (!victim) return false;
        keys.splice(keys.indexOf(victim), 1);
        try { storage.removeItem(PREFIX + victim); } catch { /* ignore */ }
      }
    }
    return false;
  }

  function read(key) {
    try {
      const raw = storage?.getItem(PREFIX + key);
      if (!raw) return null;
      const e = JSON.parse(raw);
      return e && typeof e.savedAt === 'number' ? e : null;
    } catch { return null; }
  }

  function remove(key) {
    try { storage?.removeItem(PREFIX + key); } catch { /* ignore */ }
    writeIndex(readIndex().filter((k) => k !== key));
  }

  return { save, read, remove, keys: readIndex };
}

export const cache = makeCache();

// Network first; on failure, the saved copy. Result says which one it is.
//   { data, savedAt, source: 'live' | 'saved' | 'none', error }
export async function fetchWithCache(key, fetcher, store = cache) {
  try {
    const data = await fetcher();
    const savedAt = Date.now();
    store.save(key, data, savedAt);
    return { data, savedAt, source: 'live', error: null };
  } catch (error) {
    const hit = store.read(key);
    if (hit) return { data: hit.data, savedAt: hit.savedAt, source: 'saved', error };
    return { data: null, savedAt: null, source: 'none', error };
  }
}

export function ageMinutes(savedAt, now = Date.now()) {
  return savedAt == null ? null : Math.max(0, Math.round((now - savedAt) / 60000));
}
