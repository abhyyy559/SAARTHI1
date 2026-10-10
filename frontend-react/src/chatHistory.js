// Earlier turns sent with each chat question so follow-ups ("and tomorrow
// evening?") keep their context. Queued/offline replies and empty bubbles are
// left out: they are not answers the model gave. The backend caps it again.
const HISTORY_TURNS = 6;
const HISTORY_CHARS = 400;

export function chatHistory(log) {
  return (log || [])
    .filter((m) => m && m.text && !m.queued && (m.role === 'user' || m.role === 'bot'))
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text.slice(0, HISTORY_CHARS) }));
}
