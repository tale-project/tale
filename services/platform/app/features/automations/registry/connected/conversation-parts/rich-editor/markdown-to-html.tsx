/**
 * Serialize composer markdown to sanitized HTML — the reply body contract.
 *
 * Recovered from the old inbox `MessageEditor`: the rich editor's document is
 * markdown (Milkdown), but the send path has always shipped HTML —
 * `replyToConversation` splits `content` into `{ html, text }` assuming the
 * body IS html (`text` = tags stripped). Links open in a new tab and the
 * output is DOMPurify-sanitized, exactly as before.
 */

import DOMPurify from 'dompurify';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';

export function markdownToHtml(md: string): string {
  const src = md.trim();
  if (!src) return '';
  const raw = renderToStaticMarkup(
    <ReactMarkdown
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {src}
    </ReactMarkdown>,
  );
  return DOMPurify.sanitize(raw);
}
