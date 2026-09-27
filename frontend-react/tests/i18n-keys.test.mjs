// i18n key coverage: every t('...') / tp('...') call site in src/ must resolve
// to a REAL translation in en, hi and te — never a key echo, never undefined.
// This is the regression test for the old srcChip bug where t(lang,
// 'hConnCached') leaked the raw key into trust-critical UI.
//
// Dynamic keys (template literals) must be declared in DYNAMIC with their full
// expansion list; an undeclared dynamic pattern fails the test.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { test } from 'node:test';
import { STRINGS } from '../src/strings/index.js';

const SRC = new URL('../src', import.meta.url).pathname;

// Template-literal t() patterns used in the codebase, with every key they can
// produce. Add new entries here when introducing new dynamic keys.
const DYNAMIC = {
  'role_${r}': ['general', 'farmer', 'driver', 'fisherman', 'aviation', 'commuter', 'office']
    .map((r) => `role_${r}`),
  'role_${r}_d': ['general', 'farmer', 'driver', 'fisherman', 'aviation', 'commuter', 'office']
    .map((r) => `role_${r}_d`),
};

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (['.js', '.jsx'].includes(extname(p))) out.push(p);
  }
  return out;
}

const files = walk(SRC);
assert.ok(files.length > 0, 'no src files found');

const staticKeys = new Map(); // key -> [files]
const dynamicPatterns = new Map(); // pattern -> [files]
const twoArgCalls = [];

for (const f of files) {
  let src = readFileSync(f, 'utf8');
  // Strip block comments (JSDoc etc.) so doc examples like t('someKey') in
  // prose are not treated as call sites. Line comments at line start too.
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // t('key') / tp('key') / t("key")
  for (const m of src.matchAll(/\btp?\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
    const k = m[1];
    if (!staticKeys.has(k)) staticKeys.set(k, []);
    staticKeys.get(k).push(f);
  }
  // t(`prefix${x}suffix`) — template literal form
  for (const m of src.matchAll(/\btp?\(\s*`([^`$]*)\$\{[^}]+\}([^`]*)`/g)) {
    const pattern = `${m[1]}${'${r}'}${m[2]}`.replace('${r}', '${r}');
    const norm = m[1] + '${r}' + m[2];
    if (!dynamicPatterns.has(norm)) dynamicPatterns.set(norm, []);
    dynamicPatterns.get(norm).push(f);
    void pattern;
  }
  // Old bug shape: t(lang, 'key') — two-arg calls must not exist.
  for (const m of src.matchAll(/\btp?\(\s*[a-zA-Z_$][\w$]*\s*,\s*['"][A-Za-z0-9_]+['"]/g)) {
    twoArgCalls.push(`${f}: ${m[0].slice(0, 40)}`);
  }
}

test('no two-argument t(lang, key) calls (old key-leak bug shape)', () => {
  assert.deepEqual(twoArgCalls, [], `two-arg t() calls found:\n${twoArgCalls.join('\n')}`);
});

test('every dynamic t() pattern is declared with expansions', () => {
  const unknown = [...dynamicPatterns.keys()].filter((p) => !(p in DYNAMIC));
  assert.deepEqual(unknown, [], `undeclared dynamic patterns:\n${unknown.join('\n')}`);
});

const allKeys = new Set(staticKeys.keys());
for (const [pattern, expansions] of Object.entries(DYNAMIC)) {
  if (dynamicPatterns.has(pattern)) for (const k of expansions) allKeys.add(k);
}

test('every referenced key exists in en, hi and te', () => {
  const missing = [];
  for (const k of [...allKeys].sort()) {
    for (const lang of ['en', 'hi', 'te']) {
      if (!Object.prototype.hasOwnProperty.call(STRINGS[lang], k)) {
        const usedIn = (staticKeys.get(k) || []).map((f) => f.split('/src/')[1]);
        missing.push(`${lang}.${k} (used in ${usedIn.join(', ') || 'dynamic expansion'})`);
      }
    }
  }
  assert.deepEqual(missing, [], `missing translations:\n${missing.join('\n')}`);
});

test('no key echoes: every translation is a real non-empty string', () => {
  const bad = [];
  for (const k of [...allKeys].sort()) {
    for (const lang of ['en', 'hi', 'te']) {
      const v = STRINGS[lang][k];
      if (typeof v !== 'string' || v.trim() === '' || v === k) {
        bad.push(`${lang}.${k} = ${JSON.stringify(v)}`);
      }
    }
  }
  assert.deepEqual(bad, [], `key echoes / empty translations:\n${bad.join('\n')}`);
});

test('key sets are identical across en, hi and te', () => {
  const en = Object.keys(STRINGS.en).sort();
  for (const lang of ['hi', 'te']) {
    const l = Object.keys(STRINGS[lang]).sort();
    assert.deepEqual(l, en, `${lang} key set differs from en`);
  }
});

test('no key collisions across string area files (flat-merge safety)', () => {
  // strings/index.js merges every area dict flat: later areas silently
  // override earlier ones. This once shipped every view header as "Send SOS?"
  // because six areas all defined `title`. Identical values are tolerated;
  // differing values are a hard failure.
  const dir = new URL('../src/strings/areas', import.meta.url).pathname;
  const seen = new Map(); // key -> {file, values}
  const bad = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const lang of ['en', 'hi', 'te']) {
      const block = src.match(new RegExp(lang + ':\\s*\\{([\\s\\S]*?)\\n  \\},', 'm'));
      if (!block) continue;
      for (const m of block[1].matchAll(/^    ([A-Za-z0-9_]+):\s*(['"`])((?:\\\2|(?!\2).)*)\2/gum)) {
        const key = m[1], val = m[3];
        if (!seen.has(key)) seen.set(key, { file: f, values: new Map() });
        const rec = seen.get(key);
        const prev = rec.values.get(lang);
        if (prev !== undefined && prev !== val && rec.file !== f) {
          bad.push(`${key} [${lang}]: "${f}" disagrees with "${rec.file}"`);
        }
        rec.values.set(lang, val);
      }
    }
  }
  assert.deepEqual(bad, [], `colliding i18n keys with different values:\n${bad.join('\n')}`);
});
