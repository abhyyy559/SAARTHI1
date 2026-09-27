// Merge all area dictionaries into { en, hi, te }.
// Every area file exports { en, hi, te }. Later areas override earlier ones
// on key collision — keep keys unique per area by convention.
import common from './areas/common.js';
import topbar from './areas/topbar.js';
import home from './areas/home.js';
import advice from './areas/advice.js';
import alerts from './areas/alerts.js';
import trust from './areas/trust.js';
import chat from './areas/chat.js';
import more from './areas/more.js';
import sos from './areas/sos.js';

const areas = [common, topbar, home, advice, alerts, trust, chat, more, sos];

function merge(lang) {
  const out = {};
  for (const a of areas) Object.assign(out, a[lang] || {});
  return out;
}

export const STRINGS = {
  en: merge('en'),
  hi: merge('hi'),
  te: merge('te'),
};

export const LANGS = ['en', 'hi', 'te'];
