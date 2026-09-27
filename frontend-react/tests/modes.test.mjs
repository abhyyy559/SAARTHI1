import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const store = src('store.jsx');
const shell = src('components/Shell.jsx');

// store.jsx is JSX, so it cannot be imported by node. Read the exported array
// literal out of the source and evaluate just that expression — the same
// source-level contract style the other frontend tests use.
function exportedArray(source, name) {
  const m = source.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\]);`));
  assert.ok(m, `${name} must be exported as an array literal`);
  return Function(`return ${m[1]}`)();
}
const SOURCE_MODES = exportedArray(store, 'SOURCE_MODES');

// --- the single IMD-first mode (2026-09-27) --------------------------------

test('exactly one source mode exists: imd', () => {
  assert.deepEqual(SOURCE_MODES, ['imd']);
});

test('there is no mode switcher in the shell', () => {
  // No mode segmented control; the language switcher (seg-opt) is unrelated.
  assert.doesNotMatch(shell, /SOURCE_MODES\.map\(/);
  assert.doesNotMatch(shell, /setBackendMode\(/);
  assert.doesNotMatch(shell, /demoModeTitle/);
});

test('demoMode is a constant false, sourceMode a constant imd', () => {
  assert.match(store, /const sourceMode = 'imd'/);
  assert.match(store, /const demoMode = false/);
  assert.doesNotMatch(store, /setSourceMode/);
  assert.doesNotMatch(store, /setDemoMode/);
});

test('setBackendMode is a no-op (POST /api/mode is gone)', () => {
  assert.match(store, /const setBackendMode = useCallback\(async \(\) =>/);
});

test('the imd mode has a label and a plain-language note', () => {
  for (const key of ['modeImd', 'modeImdNote']) {
    assert.match(store, new RegExp(key), `store must reference ${key}`);
  }
});

// --- i18n parity ----------------------------------------------------------

test('every string area supplies all three languages with identical key sets', async () => {
  const dir = new URL('../src/strings/areas/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0, 'expected at least one string area');

  for (const file of files) {
    const mod = await import(new URL(file, dir).href);
    const dict = mod.default;
    for (const lang of ['en', 'hi', 'te']) {
      assert.ok(dict[lang], `${file} is missing the '${lang}' block`);
    }
    const en = Object.keys(dict.en).sort();
    for (const lang of ['hi', 'te']) {
      assert.deepEqual(
        Object.keys(dict[lang]).sort(),
        en,
        `${file}: '${lang}' keys must match 'en' exactly`,
      );
    }
  }
});

test('no string area redefines a key the base dictionary already owns', async () => {
  // Area files win over i18n.js, so an accidental duplicate silently changes
  // shared chrome on every other screen.
  const base = src('i18n.js');
  const dir = new URL('../src/strings/areas/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const dict = (await import(new URL(file, dir).href)).default;
    for (const key of Object.keys(dict.en)) {
      assert.ok(
        !new RegExp(`^\\s*${key}:`, 'm').test(base),
        `${file}: '${key}' also exists in i18n.js`,
      );
    }
  }
});
