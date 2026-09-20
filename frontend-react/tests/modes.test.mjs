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

// --- the three modes -------------------------------------------------------

test('exactly three source modes exist, and they are the documented ones', () => {
  assert.deepEqual(SOURCE_MODES, ['demo', 'imd', 'hybrid']);
});

test('the switch offers every mode and no fourth option', () => {
  // Rendered from the list, not hardcoded - a hardcoded pair is how the old
  // two-way LIVE/DEMO switch would creep back in.
  assert.match(shell, /SOURCE_MODES\.map\(/);
  assert.doesNotMatch(shell, /setBackendMode\('live'\)/);
  assert.doesNotMatch(shell, /'LIVE'<\/button>/);
});

test('the backend owns the mode - the UI never infers it from a boolean', () => {
  // demoMode is derived from sourceMode, not tracked separately.
  assert.match(store, /const demoMode = sourceMode === 'demo'/);
  assert.match(store, /const \[sourceMode, setSourceMode\] = useState/);
  assert.doesNotMatch(store, /setDemoMode/);
});

test('the legacy "live" alias is accepted from the backend but not offered', () => {
  // A stale backend answering "live" must not leave the UI in an unknown mode:
  // applyMode falls back rather than storing "live" as if it were a mode.
  assert.match(store, /d\.source_mode \|\| \(d\.demo_mode \? 'demo' : 'hybrid'\)/);
  assert.ok(!SOURCE_MODES.includes('live'));
});

test('every mode has a label and a plain-language note', () => {
  for (const key of ['modeDemo', 'modeImd', 'modeHybrid', 'modeDemoNote', 'modeImdNote', 'modeHybridNote']) {
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
