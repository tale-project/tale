/**
 * True for an address that names a file rather than a page: `/llms.txt`, a
 * page's Markdown export (`/platform/chat/basics.md`), an image, a PDF. Such a
 * link has to reach the server — the client router knows only pages and
 * would answer a file with its not-found page.
 */
export function isFileHref(href: unknown): boolean {
  if (typeof href !== 'string') return false;
  const path = href.split(/[?#]/, 1)[0] ?? '';
  const last = path.split('/').pop() ?? '';
  return /\.[a-z0-9]{1,8}$/i.test(last);
}
