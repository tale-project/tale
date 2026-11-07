/**
 * Path mappings between a route URL and its `.md` counterpart. Shared by
 * the on-demand server, the precompile path, and the per-page markdown
 * plugin so all three agree on the canonical name of every per-page
 * artifact.
 */

/** `/foo` → `/foo.md`, `/` → `/index.md`. Always starts with `/`. */
export function routeToMdUrl(url: string): string {
  return url === '/' ? '/index.md' : `${url}.md`;
}

/** Same as {@link routeToMdUrl} but without the leading slash for filesystem use. */
export function routeToMdPath(url: string): string {
  return url === '/' ? 'index.md' : `${url.replace(/^\//, '')}.md`;
}

/** `/foo.md` → `/foo`, `/index.md` → `/`. Inverse of {@link routeToMdUrl}. */
export function pathnameToRouteUrl(pathname: string): string {
  return pathname === '/index.md' ? '/' : pathname.replace(/\.md$/, '');
}

/** True if `pathname` could be a per-page markdown URL. */
export function isMdPathname(pathname: string): boolean {
  return pathname.endsWith('.md');
}
