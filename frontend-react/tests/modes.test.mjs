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

// --- the two modes ---------------------------------------------------------

test('exactly two source modes exist, and they are the documented ones', () => {
  assert.deepEqual(SOURCE_MODES, ['imd', 'hybrid']);
});

test('the switch offers every mode and no third option', () => {
  // Rendered from the list, not hardcoded - a hardcoded option is how a
  // third mode would creep back in.
  assert.match(shell, /SOURCE_MODES\.map\(/);
  assert.doesNotMatch(shell, /setBackendMode\('live'\)/);
  assert.doesNotMatch(shell, /'LIVE'<\/button>/);
  assert.doesNotMatch(shell, /setBackendMode\('demo'\)/);
});

test('the backend owns the mode - the UI never infers it from a boolean', () => {
  // No demoMode boolean anywhere: the mode is a two-valued string from /api/mode.
  assert.doesNotMatch(store, /demoMode/);
  assert.doesNotMatch(store, /demo_mode/);
  assert.match(store, /const \[sourceMode, setSourceMode\] = useState/);
  assert.doesNotMatch(store, /setDemoMode/);
});

test('an unknown mode id from the backend falls back to hybrid, never demo', () => {
  // The backend owns the mode; the UI never infers it from a boolean it
  // happens to have lying around. Unknown ids land on hybrid.
  assert.match(store, /d\.source_mode \|\| d\.mode/);
  assert.match(store, /setSourceMode\(m === 'imd' \|\| m === 'hybrid' \? m : 'hybrid'\)/);
  assert.ok(!SOURCE_MODES.includes('live'));
  assert.ok(!SOURCE_MODES.includes('demo'));
});

test('every mode has a label and a plain-language note, and demo has neither', () => {
  for (const key of ['modeImd', 'modeHybrid', 'modeImdNote', 'modeHybridNote']) {
    assert.match(store, new RegExp(key), `store must reference ${key}`);
  }
  assert.doesNotMatch(store, /modeDemo/);
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
