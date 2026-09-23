// Per-area string modules.
//
// Why this exists: src/i18n.js holds one large dictionary shared by every
// screen. During the low-literacy redesign several screens were reworked at
// once, and every one of them needed new words. Editing one shared dictionary
// from several places at the same time is how strings get silently lost.
//
// So each screen owns a file under ./areas/ and this module discovers them.
// Dropping a file in is the entire registration step - there is no import list
// to keep in sync, and two areas can never collide.
//
// Shape of an area module (all three languages are required):
//
//   export default {
//     en: { someKey: 'English text' },
//     hi: { someKey: 'हिन्दी पाठ' },
//     te: { someKey: 'తెలుగు పాఠం' },
//   };
//
// A key present here overrides the same key in i18n.js. Nothing here is ever
// translated at runtime: severity codes, provenance labels and model names stay
// machine-readable and are looked up by their exact value.
const modules = import.meta.glob('./areas/*.js', { eager: true });

const areaStrings = { en: {}, hi: {}, te: {} };

// Sorted so the merge is deterministic regardless of filesystem ordering: the
// last file to contribute a duplicate key always wins the same way in dev, in a
// production build and in a fresh checkout.
//
// Exception: admin.js owns the admin-gate strings (workstream F) and redefines
// keys first written in harboursignal.js. './areas/admin.js' sorts BEFORE
// './areas/harboursignal.js', so a plain sorted merge would silently let the
// older "Team access only" copy win and the override would never take effect.
// Applying admin.js last changes precedence ONLY for keys it defines — every
// other stream keeps its sorted-order precedence.
const APPLY_LAST = ['./areas/admin.js'];
const orderedPaths = Object.keys(modules)
  .sort()
  .filter((p) => !APPLY_LAST.includes(p));
for (const p of APPLY_LAST) if (modules[p]) orderedPaths.push(p);
for (const path of orderedPaths) {
  const dict = modules[path]?.default;
  if (!dict || typeof dict !== 'object') continue;
  for (const lang of ['en', 'hi', 'te']) {
    if (dict[lang] && typeof dict[lang] === 'object') {
      Object.assign(areaStrings[lang], dict[lang]);
    }
  }
}

export { areaStrings };
