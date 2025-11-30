import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'div',
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'img',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'span',
  'blockquote',
  'pre',
  'code',
  'hr',
  'del',
  'input',
];

const ALLOWED_ATTR = [
  'style',
  'href',
  'target',
  'rel',
  'class',
  'src',
  'alt',
  'width',
  'height',
  'align',
  'type',
  'checked',
  'disabled',
];

/**
 * Sanitizes chat message content to prevent XSS attacks
 * while allowing safe markdown-rendered HTML
 */
export function sanitizeChatMessage(content: string): string {
  // Add hook to modify links to open in new tab
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Set all links to open in a new tab
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  const sanitized = DOMPurify.sanitize(content, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });

  // Remove the hook after sanitization to avoid affecting other parts of the app
  DOMPurify.removeHook('afterSanitizeAttributes');

  return sanitized;
}
