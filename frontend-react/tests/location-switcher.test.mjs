// LocationSwitcher contract tests (source-level).
//
// The control is the district picker for the location switcher: it names the
// current district, opens a preset sheet, persists to `wgpt.loc` (the exact
// shape store.jsx uses) and calls the `onChange` prop so Agent 4 can wire it
// to the store's setLoc. Manual lat/lon entry is validated; targets are 44px.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const comp = () => read('../src/components/LocationSwitcher.jsx');
const strs = () => read('../src/strings/areas/location.js');

test('renders the current district, read back from wgpt.loc on mount', () => {
  const code = comp();
  assert.match(code, /localStorage\.getItem\(LOC_KEY\)/, 'must read the stored location');
  assert.match(code, /const LOC_KEY = 'wgpt\.loc'/, 'must use the store\'s wgpt.loc key');
  // Same validation shape as store.jsx readLoc: district + finite coords.
  assert.match(code, /l\.district && Number\.isFinite\(l\.lat\) && Number\.isFinite\(l\.lon\)/,
    'stored location must be validated the same way store.jsx validates it');
  assert.match(code, /useState\(\(\) => readLoc\(\)\)/, 'current district must be read on mount (survives reload)');
  assert.match(code, /\{current\.district\}/, 'the current district name must be rendered');
});

test('opens a modal sheet from the change affordance', () => {
  const code = comp();
  assert.match(code, /aria-haspopup="dialog"/, 'trigger must announce the sheet');
  assert.match(code, /onClick=\{\(\) => setOpen\(true\)\}/, 'change affordance must open the sheet');
  assert.match(code, /role="dialog"/, 'sheet must be a dialog');
  assert.match(code, /aria-modal="true"/, 'sheet must be modal');
  assert.match(code, /aria-label=\{t\(lang, 'lswTitle'\)\}/, 'dialog must be labelled');
});

test('selecting a district calls onChange AND writes localStorage', () => {
  const code = comp();
  // The select handler persists first (survives sessions), then notifies.
  const choose = code.match(/const choose = \(next\) => \{([\s\S]*?)\n  \};/);
  assert.ok(choose, 'choose() handler must exist');
  assert.match(choose[1], /writeLoc\(clean\)/, 'choose() must persist to localStorage directly');
  assert.match(choose[1], /onChange\(clean\)/, 'choose() must call the onChange prop');
  assert.match(choose[1], /district: next\.district, lat: next\.lat, lon: next\.lon/,
    'payload shape must be { district, lat, lon } — the store\'s loc shape');
  // Read and write use the same key: choice survives a reload.
  const reads = (code.match(/localStorage\.getItem\(LOC_KEY\)/g) || []).length;
  const writes = (code.match(/localStorage\.setItem\(LOC_KEY/g) || []).length;
  assert.ok(reads >= 1 && writes >= 1, 'must both read and write the same wgpt.loc key');
});

test('manual lat/lon entry validates ranges and rejects bad input', () => {
  const code = comp();
  assert.match(code, /la >= -90 && la <= 90/, 'latitude must be validated to -90..90');
  assert.match(code, /lo >= -180 && lo <= 180/, 'longitude must be validated to -180..180');
  assert.match(code, /Number\.isFinite\(la\)/, 'non-numeric latitude must be rejected');
  assert.match(code, /setErr\(t\(lang, 'lswBadCoord'\)\)/, 'bad input must show the translated error');
  assert.match(code, /role="alert"/, 'the error must be announced to screen readers');
  const s = strs();
  for (const key of ['lswBadCoord', 'lswLat', 'lswLon', 'lswUse']) {
    const hits = s.match(new RegExp(`${key}: '`, 'g')) || [];
    assert.equal(hits.length, 3, `${key} must be translated EN/HI/TE`);
  }
});

test('change affordance and sheet rows meet the 44px target', () => {
  const code = comp();
  const hits = code.match(/minHeight: 44/g) || [];
  assert.ok(hits.length >= 3, `expected >=3 explicit 44px targets, found ${hits.length}`);
  assert.match(code, /className="locsw-trigger"[\s\S]{0,200}minHeight: 44/s,
    'the district trigger itself must be 44px');
});

test('sheet is keyboard-dismissable and focus-managed', () => {
  const code = comp();
  assert.match(code, /e\.key === 'Escape'/, 'Escape must close the sheet');
  assert.match(code, /sheetRef\.current\?\.focus\(\)/, 'focus must move into the sheet on open');
  assert.match(code, /aria-label=\{t\(lang, 'lswClose'\)\}/, 'the close button must be labelled');
});

test('presets cover the demo districts with coordinates', () => {
  const code = comp();
  for (const d of ['Hyderabad', 'Medchal Malkajgiri', 'Visakhapatnam', 'Mumbai Suburban', 'Chennai']) {
    assert.match(code, new RegExp(`district: '${d}'`), `preset ${d} must exist`);
  }
  assert.match(code, /lat: 17\.6868, lon: 83\.2185/, 'Visakhapatnam coordinates must be present');
  assert.match(code, /lat: 13\.0827, lon: 80\.2707/, 'Chennai coordinates must be present');
  // State labels ride along so the sheet reads like a place picker.
  assert.match(code, /Andhra Pradesh/);
  assert.match(code, /Tamil Nadu/);
});

test('no Tamil script anywhere in the location strings', () => {
  const s = strs();
  assert.ok(!/[\u0B80-\u0BFF]/.test(s), 'Tamil block must not appear');
  const t = read('../src/strings/areas/tour.js');
  assert.ok(!/[\u0B80-\u0BFF]/.test(t), 'Tamil block must not appear in tour strings');
});
