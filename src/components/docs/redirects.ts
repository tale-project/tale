/**
 * Redirect maps for documentation sites. A site keeps a `redirects.json` of
 * old slug → new slug for every moved, merged or deleted page, and derives
 * one more entry per section folder that has no page of its own. Slugs are
 * locale-less, like the navigation's, so one entry covers every locale the
 * site ships; `expandRedirects` turns the map into the URL paths the server
 * answers with a 301 and the prerenderer writes meta-refresh stubs for.
 *
 * A target is a slug on the same site or, for a page that moved to another
 * site, an absolute `https://` URL. That site is expected to share the
 * locale model (English at the root, other locales under `/<locale>`), so
 * the German redirect lands on the German page there too.
 */

import { pathnameToRouteUrl, routeToMdUrl } from '../../seo/builders/md-paths';

/** Old slug → new slug (or absolute URL). */
export type RedirectMap = Record<string, string>;

/** One locale-expanded redirect: site-relative `from` path → `to` path or URL. */
export interface RedirectRoute {
  locale: string;
  from: string;
  to: string;
}

/** Whether a redirect target leaves the site. */
export function isExternalTarget(to: string): boolean {
  return to.startsWith('https://');
}

/**
 * Validate the parsed shape of a site's `redirects.json` and return the
 * slug map. Throws with a pointed message so a malformed file fails the
 * build (or server startup) instead of silently dropping redirects.
 */
export function parseRedirects(
  value: unknown,
  file = 'redirects.json',
): RedirectMap {
  if (typeof value !== 'object' || value === null || !('redirects' in value)) {
    throw new Error(`${file} must be an object with a "redirects" key`);
  }
  const { redirects } = value;
  if (
    typeof redirects !== 'object' ||
    redirects === null ||
    Array.isArray(redirects)
  ) {
    throw new Error(
      `${file} "redirects" must be an object mapping old slug → new slug`,
    );
  }
  const map: RedirectMap = {};
  for (const [from, to] of Object.entries(redirects)) {
    if (typeof to !== 'string') {
      throw new Error(
        `${file} entry "${from}" must map to a string slug, got ${typeof to}`,
      );
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(to) && !isExternalTarget(to)) {
      throw new Error(
        `${file} entry "${from}" must map to a slug or an https:// URL, got "${to}"`,
      );
    }
    map[from] = to;
  }
  return map;
}

/**
 * A slug's locale-less route: `foo/index` and `foo` serve the same URL, and
 * the root `index` is the empty route.
 */
export function slugRoute(slug: string): string {
  return slug === 'index' ? '' : slug.replace(/\/index$/, '');
}

/**
 * Section-folder redirects derived from the navigation: every folder prefix
 * of a page slug that is neither a page nor an explicit redirect source maps
 * to the first page under it in reading order. The targets are navigation
 * pages, so no derived entry can chain into another redirect.
 */
export function deriveSectionRedirects(
  pageSlugs: readonly string[],
  explicit: RedirectMap,
): RedirectMap {
  const pageRoutes = new Set(pageSlugs.map(slugRoute));
  const explicitRoutes = new Set(Object.keys(explicit).map(slugRoute));
  const derived: RedirectMap = {};
  for (const slug of pageSlugs) {
    const segments = slugRoute(slug).split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      const folder = segments.slice(0, depth).join('/');
      if (
        pageRoutes.has(folder) ||
        explicitRoutes.has(folder) ||
        folder in derived
      ) {
        continue;
      }
      derived[folder] = slug;
    }
  }
  return derived;
}

/**
 * An absolute URL on a site that shares the locale model, moved into
 * `locale`'s tree: `https://tale.dev/legal/terms` → `https://tale.dev/de/legal/terms`.
 */
export function localizeExternalUrl(
  url: string,
  locale: string,
  defaultLocale = 'en',
): string {
  if (locale === defaultLocale) return url;
  const target = new URL(url);
  target.pathname =
    target.pathname === '/' ? `/${locale}` : `/${locale}${target.pathname}`;
  return target.toString();
}

interface ExpandOptions<L extends string> {
  /** Every locale the site serves a URL tree for. */
  locales: readonly L[];
  /** Site-relative path of a slug in a locale (`/de/platform/x`, `/docs/x`). */
  pagePath: (locale: L, slug: string) => string;
  /** The locale served at the root, left unprefixed on external targets. */
  defaultLocale?: string;
}

/** Expand every locale-less slug pair into per-locale URL path pairs. */
export function expandRedirects<L extends string>(
  redirects: RedirectMap,
  { locales, pagePath, defaultLocale = 'en' }: ExpandOptions<L>,
): RedirectRoute[] {
  const out: RedirectRoute[] = [];
  for (const [from, to] of Object.entries(redirects)) {
    for (const locale of locales) {
      out.push({
        locale,
        from: pagePath(locale, from),
        to: isExternalTarget(to)
          ? localizeExternalUrl(to, locale, defaultLocale)
          : pagePath(locale, to),
      });
    }
  }
  return out;
}

/** Lookup map of old URL path → new URL path (or URL) across every locale. */
export function buildRedirectPathMap<L extends string>(
  redirects: RedirectMap,
  options: ExpandOptions<L>,
): Map<string, string> {
  return new Map(
    expandRedirects(redirects, options).map((route) => [route.from, route.to]),
  );
}

/** Normalize a request pathname for redirect matching — trailing slashes
 *  are insignificant (`/old-page/` matches the `/old-page` entry). */
export function normalizeRequestPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * The redirect target for a page path or for its per-page Markdown export
 * (`/old/page.md` follows `/old/page` to `/new/page.md`; a page that left
 * the site answers its export with the page itself), if any.
 */
export function lookupRedirect(
  path: string,
  paths: ReadonlyMap<string, string>,
): string | undefined {
  const moved = paths.get(path);
  if (moved || !path.endsWith('.md')) return moved;
  const page = paths.get(pathnameToRouteUrl(path));
  if (page === undefined) return undefined;
  return isExternalTarget(page) ? page : routeToMdUrl(page);
}

/** A redirect target as a `Location`: under the mount prefix, or off the site. */
export function redirectLocation(
  target: string,
  basePath: string,
  search: string,
): string {
  return isExternalTarget(target)
    ? `${target}${search}`
    : `${basePath}${target}${search}`;
}

interface RedirectMapRouteOptions {
  /** Where a request path redirects, or null to let the server go on. */
  resolve: (pathname: string) => string | null | undefined;
  /** Public mount prefix without a trailing slash (`''` or `/docs`). */
  basePath: string;
}

/**
 * A server route (`startReactServer`'s `extraRoutes`) answering every path
 * `resolve` maps with a 301 that stays under the mount prefix and keeps the
 * query string. Only GET and HEAD are redirected.
 */
export function createRedirectMapRoute({
  resolve,
  basePath,
}: RedirectMapRouteOptions): (request: Request, url: URL) => Response | null {
  return (request, url) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    const target = resolve(url.pathname);
    if (!target) return null;
    return new Response(null, {
      status: 301,
      headers: { Location: redirectLocation(target, basePath, url.search) },
    });
  };
}
