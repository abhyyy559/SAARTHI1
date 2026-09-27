// Pure sentence-aware chunker for TTS — extracted from store.jsx speak() so
// it is unit-testable (frontend-react/tests/voice.test.mjs). Mirrors the
// backend's split_sentences() in backend/utils/speak_sanitize.py:
// sentences (on . ! ? and the Hindi danda ।) are packed greedily into chunks
// of at most maxLen chars; a single overlong sentence is hard-split on
// whitespace, like the old 450-char regex chunker it replaces.
export function splitSpeakChunks(text, maxLen = 450) {
  const src = typeof text === 'string' ? text.trim() : '';
  if (!src) return [text];
  const sentences = src.match(/[^.!?।]+[.!?।]+["'”’)\]]*|[^.!?।]+$/g) || [src];
  const chunks = [];
  let cur = '';
  const flush = () => { if (cur) { chunks.push(cur); cur = ''; } };
  for (let s of sentences) {
    s = s.trim();
    if (!s) continue;
    while (s.length > maxLen) {
      flush();
      let cut = s.lastIndexOf(' ', maxLen);
      if (cut <= 0) cut = maxLen;
      chunks.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (cur && cur.length + 1 + s.length > maxLen) flush();
    cur = cur ? `${cur} ${s}` : s;
  }
  flush();
  return chunks.length ? chunks : [src];
}
