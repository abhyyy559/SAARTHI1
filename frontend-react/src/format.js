// NOTE: there is deliberately no severity-deriving helper in this file.
//
// There used to be one (`heroState`). It mapped an IMD severity code to a
// display level on the client, and HeroCard used it. That is how this app got
// its worst bug: the hero card and the alert centre each derived severity from
// a different subset of the same payload, so one showed "All clear" while the
// other showed an active alert.
//
// Severity is now decided exactly once, server-side, in
// backend/services/verdict_service.py, and every view renders `verdict.level`
// verbatim. Do not reintroduce a client-side mapping here — if a view needs a
// severity it does not have, the fix belongs in the backend verdict.

// "2026-09-17T20:29:27+05:30" -> "20:29". Empty/invalid -> "".
export function formatValidUntil(iso) {
  if (!iso) return '';
  const m = String(iso).match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

// Countdown to a valid_until timestamp: "2h 14m", "38m", "expired", or "".
// Pure (nowMs injected) so it is testable and never invents time.
export function formatCountdown(validUntilIso, nowMs) {
  if (!validUntilIso) return '';
  const end = Date.parse(validUntilIso);
  if (Number.isNaN(end)) return '';
  const diffMin = Math.floor((end - nowMs) / 60000);
  if (diffMin < 0) return 'expired';
  if (diffMin < 60) return `${diffMin}m`;
  return `${Math.floor(diffMin / 60)}h ${diffMin % 60}m`;
}

// RULE 2: an expired cached warning is historical, never active.
// True only when a real expiry exists and has passed — missing/invalid
// timestamps are NOT expiry (absence of data is not evidence of expiry).
export function isExpired(validUntilIso, nowMs) {
  if (!validUntilIso) return false;
  const end = Date.parse(validUntilIso);
  if (Number.isNaN(end)) return false;
  return end <= nowMs;
}

// Whole minutes since an ISO timestamp; null when unknown.
export function minutesSince(iso, nowMs) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 60000));
}

// Advisory prose → short bullets. Advisory text arrives as paragraphs; the
// user asked for bullet points, not walls of text. Splits on sentence
// boundaries (same rule as splitAdvisory), drops empties, caps the count so
// a long model answer can never turn into a long list. Display-only.
export function bulletize(text, max = 5) {
  const s = String(text || '').trim();
  if (!s) return [];
  return s
    .split(/(?<=[.!?।])\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, Math.max(1, max));
}

// Split an advisory into the first actionable line (lead) and the rest
// (detail). 'Note: ...' sentences never lead — they are context, not action.
// An illiterate user should only need the lead.
export function splitAdvisory(text) {
  const s = String(text || '').trim();
  if (!s) return { lead: '', detail: '' };
  const sentences = s.split(/(?<=[.!?।])\s+/);
  const isNote = (x) => /^note\s*:/i.test(x.trim());
  const lead = sentences.find((x) => !isNote(x)) || '';
  const rest = sentences.filter((x) => x !== lead);
  const detail = rest.join(' ').trim();
  return { lead, detail };
}

// ISO timestamps sometimes arrive inside answer text verbatim ("valid until
// 2026-09-20T22:43:00.994242+05:30"). Render them the way a person would say
// them, in the viewer's own locale — never as machine noise. Display-only;
// the underlying data is untouched.
const ISO_TS_RE = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
function humanizeTimestamps(text) {
  return String(text || '').replace(ISO_TS_RE, (m) => {
    const d = new Date(m);
    if (Number.isNaN(d.getTime())) return m;
    return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  });
}

// Markdown-lite for LLM answers: headings, bold, short lists, paragraphs.
// HTML is escaped FIRST so model output can never inject markup.
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const inline = (s) =>
  esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

const heading = (line) => {
  const m = line.match(/^(#{1,4})\s+(.*)$/);
  return m ? m[2].trim() : null;
};

const bullet = (line) => {
  let m = line.match(/^[-*•]\s+(.*)$/);
  if (m) return m[1].trim();
  m = line.match(/^\d+[.)]\s+(.*)$/);
  return m ? m[1].trim() : null;
};

export function formatAnswer(text) {
  const lines = humanizeTimestamps(text).split('\n');
  let html = '';
  let inList = false;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      html += `<p>${para.map(inline).join('<br>')}</p>`;
      para = [];
    }
  };
  const flushList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushPara();
      flushList();
      continue;
    }
    const h = heading(line);
    if (h !== null) {
      flushPara();
      flushList();
      html += `<h4>${inline(h)}</h4>`;
      continue;
    }
    const b = bullet(line);
    if (b !== null) {
      flushPara();
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${inline(b)}</li>`;
      continue;
    }
    flushList();
    para.push(raw.trim());
  }
  flushPara();
  flushList();
  return html;
}
