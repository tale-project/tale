import { decode } from 'he';
import striptags from 'striptags';

/**
 * Collapse a (possibly HTML) message body into a single-line preview snippet —
 * promoted from the retired inbox list. Strips script/style blocks and tags
 * (inserting spaces at line-break/block boundaries so words don't fuse),
 * decodes entities, and collapses whitespace. Safe on plain text: it passes
 * through unchanged apart from whitespace normalization.
 */
export function cleanPreviewText(raw: string): string {
  let content = raw.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  content = content
    .replace(/<br\s*\/?>(?=\S)/gi, ' ')
    .replace(
      /<\/(p|div|li|h[1-6]|section|article|header|footer|tr|td|th)>/gi,
      ' ',
    );

  content = striptags(content).trim();
  content = decode(content);

  return content.replace(/\s+/g, ' ').trim();
}
