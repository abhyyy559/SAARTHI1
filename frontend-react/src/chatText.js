// Shared chat-text sanitize, reused from ChatPanel.jsx's sanitizeForTTS.
//
// Strips markdown artifacts, URLs and emoji so neither the screen nor TTS
// sees them. Kept in a component-free module so component files stay
// Fast-Refresh clean (react/only-export-components).
export function sanitizeForTTS(text, maxChars = 600) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/https?:\/\/\S+/g, '');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2');
  s = s.replace(/(\*|_)(.*?)\1/g, '$2');
  s = s.replace(/`{1,3}(.*?)`{1,3}/gs, '$1');
  s = s.replace(/~~(.*?)~~/g, '$1');
  s = s.replace(/^>\s*/gm, '');
  s = s.replace(/^[-*_]{3,}\s*$/gm, '');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  s = s.replace(/^\/\/.*$/gm, '');
  s = s.replace(/\s\/\/.*$/gm, '');
  s = s.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2500}-\u{2BEF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F926}-\u{1F937}]+/gu, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxChars) {
    const truncated = s.slice(0, maxChars);
    const lastEnd = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
    if (lastEnd > maxChars * 0.5) {
      s = truncated.slice(0, lastEnd + 1);
    } else {
      s = truncated.replace(/\s+\S*$/, '') + '...';
    }
  }
  return s;
}
