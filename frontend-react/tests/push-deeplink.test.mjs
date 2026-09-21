// Push-notification tap deep link (integration fix, 2026-09-21).
//
// Push payloads carry `alert_id` and a `/?view=alerts&alert=<id>` deep link,
// and the service worker opens that URL on notification tap. The app used to
// ignore the `alert` param, so a tap landed on the Alerts list without opening
// the alert. Contract: the store seeds `selectedAlert` from `?alert=` on
// first load, and AlertsView -> AlertsList expands that alert's inline detail.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const store = read('../src/store.jsx');
const views = read('../src/views.jsx');
const list = read('../src/components/AlertsList.jsx');

test('store seeds selectedAlert from the ?alert= deep-link param', () => {
  assert.match(store, /\.get\('alert'\)/, 'store reads the alert query param');
  assert.match(
    store,
    /const \[selectedAlert, setSelectedAlert\] = useState\(\(\) => \{[\s\S]{0,300}?\.get\('alert'\)/,
    'selectedAlert initialises from the param'
  );
  assert.match(store, /return id \? \{ id \} : null/, 'missing param stays null (no phantom selection)');
});

test('AlertsView turns selectedAlert into the expanded detail', () => {
  assert.match(views, /selectedAlert\.id \|\| selectedAlert\.identifier/, 'view derives the alert id');
  assert.match(views, /initialAlertId=\{initialId\}/, 'view passes it to the list');
  assert.match(list, /useState\(initialAlertId\)/, 'list opens that alert on mount');
});
