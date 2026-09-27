import { formatAnswer } from '../format';

// Renders an LLM answer with headings/bold/lists. Content is HTML-escaped
// inside formatAnswer, so this is safe to inject.
export default function RichText({ text }) {
  return (
    <div
      className="richtext"
      dangerouslySetInnerHTML={{ __html: formatAnswer(text) }}
    />
  );
}
