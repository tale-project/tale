/**
 * Origin + path join for absolute SEO URLs. Shared by marketing JSON-LD
 * helpers and docs `docUrl` so trailing-slash / slash-join rules cannot
 * drift between services.
 */

/**
 * Join a site origin and a site-relative path into an absolute URL.
 * Trailing slashes on the origin are stripped; the path must be absolute
 * on the host (`/` or `/pricing`). Root path yields `{origin}/`.
 */
export function absoluteSitePath(siteUrl: string, path: string): string {
  const origin = siteUrl.replace(/\/+$/, '');
  if (!path || path === '/') return `${origin}/`;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${normalized}`;
}
