import he from 'he';
import striptags from 'striptags';

/**
 * One line of plain text from a message body, for a list preview: strips
 * script/style blocks and every tag, keeps a space where a block or line
 * break separated words, decodes entities, and collapses whitespace. Email
 * and API messages both arrive as HTML, so a raw `<pre>` or `&nbsp;` never
 * reaches a row. Call this on the complete raw body before truncating; the
 * resulting plain text must not pass through this HTML cleaner again.
 */
export function cleanMessagePreview(raw: string): string {
  let content = raw.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  content = content
    .replace(/<br\s*\/?>(?=\S)/gi, ' ')
    .replace(
      /<\/(p|div|li|h[1-6]|section|article|header|footer|tr|td|th)>/gi,
      ' ',
    );
  content = striptags(content).trim();
  content = he.decode(content);
  return content.replace(/\s+/g, ' ').trim();
}
