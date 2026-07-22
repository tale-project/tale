import DOMPurify from 'dompurify';

/**
 * Prepare the editor-serialized HTML for sending: sanitize it and decorate
 * every anchor with `target="_blank" rel="noopener noreferrer"`.
 *
 * The input is the Milkdown editor document serialized through its own
 * schema (`getHTML()`), so the sent message is exactly what the editor
 * displayed — this pass is structural only and never rewrites text content.
 */
export function toOutboundHtml(editorHtml: string): string {
  const template = document.createElement('template');
  template.innerHTML = DOMPurify.sanitize(editorHtml);
  for (const anchor of template.content.querySelectorAll('a[href]')) {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  return template.innerHTML;
}
