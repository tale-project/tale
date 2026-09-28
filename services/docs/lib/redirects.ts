/**
 * Redirect map for moved or merged docs pages. The entries are read from
 * [`/docs/redirects.json`](../../../docs/redirects.json) at build time —
 * the same pattern as `lib/content/nav.ts` — so the bundled server carries
 * the map and the runtime image never reads from `/docs`.
 *
 * Slugs are locale-less like `nav.json`'s (`platform/workspace/prompt-library`);
 * one entry covers every base locale. `expandRedirects` produces the
 * URL-level pairs (`/old`, `/de/old`, `/fr/old` → …) that `server.ts`
 * serves as 301s and `scripts/prerender.ts` writes meta-refresh stubs for.
 * The contract (targets exist, sources don't, no chains) is guarded by
 * `tests/redirects.test.ts`.
 *
 * Two families of addresses people and language models guess are answered
 * on top of that map, so a near miss lands on a page instead of a 404:
 *
 *  - a section folder that has no page of its own (`/platform/automations`)
 *    redirects to the first page under it in `nav.json` order — derived from
 *    the navigation, never hand-maintained, and `redirects.json` wins;
 *  - the per-page Markdown export of a moved page or section folder
 *    (`/platform/automations.md`) follows it to the target's export;
 *  - an `/en` prefix (English lives at the root) and a locale-prefixed
 *    `llms.txt` / `llms-full.txt` (one index covers every locale) resolve
 *    to the unprefixed address.
 */

import { stripLocalePrefix } from '@tale/ui/i18n/negotiate';
import {
  pathnameToRouteUrl,
  routeToMdUrl,
} from '@tale/ui/seo/builders/md-paths';

import redirectsJson from '../../../docs/redirects.json';
import { flattenNav } from './content/nav';
import { docPath, slugRoute } from './content/paths';
import { BASE_LOCALES, type SupportedLocale } from './i18n/locales';

/** One locale-expanded redirect: site-relative `from` → `to` URL paths. */
interface RedirectRoute {
  locale: SupportedLocale;
  from: string;
  to: string;
}

/**
 * Validate the parsed shape of `docs/redirects.json` and return the slug
 * map. Throws with a pointed message so a malformed file fails the build
 * (or server startup) instead of silently dropping redirects.
 */
export function parseRedirects(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || !('redirects' in value)) {
    throw new Error(
      'docs/redirects.json must be an object with a "redirects" key',
    );
  }
  const redirects = (value as { redirects: unknown }).redirects;
  if (
    typeof redirects !== 'object' ||
    redirects === null ||
    Array.isArray(redirects)
  ) {
    throw new Error(
      'docs/redirects.json "redirects" must be an object mapping old slug → new slug',
    );
  }
  for (const [from, to] of Object.entries(redirects)) {
    if (typeof to !== 'string') {
      throw new Error(
        `docs/redirects.json entry "${from}" must map to a string slug, got ${typeof to}`,
      );
    }
  }
  return redirects as Record<string, string>;
}

/**
 * Section-folder redirects derived from the navigation: every folder prefix
 * of a page slug that is neither a page nor an explicit redirect source maps
 * to the first page under it in reading order. The targets are navigation
 * pages, so no derived entry can chain into another redirect.
 */
export function deriveSectionRedirects(
  pageSlugs: readonly string[],
  explicit: Record<string, string>,
): Record<string, string> {
  const pageRoutes = new Set(pageSlugs.map(slugRoute));
  const explicitRoutes = new Set(Object.keys(explicit).map(slugRoute));
  const derived: Record<string, string> = {};
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

/** The validated slug map, baked into the bundle at build time. */
const EXPLICIT_REDIRECTS: Record<string, string> =
  parseRedirects(redirectsJson);

/** Explicit moves plus the derived section folders (explicit entries win). */
const DOCS_REDIRECTS: Record<string, string> = {
  ...deriveSectionRedirects(
    flattenNav().map(({ slug }) => slug),
    EXPLICIT_REDIRECTS,
  ),
  ...EXPLICIT_REDIRECTS,
};

/** Expand every locale-less slug pair into per-locale URL path pairs. */
export function expandRedirects(
  redirects: Record<string, string> = DOCS_REDIRECTS,
): RedirectRoute[] {
  const out: RedirectRoute[] = [];
  for (const [from, to] of Object.entries(redirects)) {
    for (const locale of BASE_LOCALES) {
      out.push({
        locale,
        from: docPath(locale, from),
        to: docPath(locale, to),
      });
    }
  }
  return out;
}

/** Lookup map of old URL path → new URL path across every base locale. */
export function buildRedirectPathMap(
  redirects: Record<string, string> = DOCS_REDIRECTS,
): Map<string, string> {
  return new Map(
    expandRedirects(redirects).map((route) => [route.from, route.to]),
  );
}

/** Normalize a request pathname for redirect matching — trailing slashes
 *  are insignificant (`/old-page/` matches the `/old-page` entry). */
export function normalizeRequestPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Site-wide files served once at the root for every locale. */
const ROOT_ONLY_FILES = new Set(['llms.txt', 'llms-full.txt']);

/**
 * The redirect target for a page path or for its per-page Markdown export
 * (`/old/page.md` follows `/old/page` to `/new/page.md`), if any.
 */
function lookupRedirect(
  path: string,
  paths: ReadonlyMap<string, string>,
): string | undefined {
  const moved = paths.get(path);
  if (moved || !path.endsWith('.md')) return moved;
  const page = paths.get(pathnameToRouteUrl(path));
  return page === undefined ? undefined : routeToMdUrl(page);
}

/**
 * Where a request path should redirect, or `null` to serve it as is. The
 * path map covers moved pages and section folders, and their `.md` exports;
 * an `/en` prefix and a locale-prefixed `llms.txt` resolve to their
 * unprefixed address, landing on the final page in one hop when that
 * address is itself a redirect.
 */
export function resolveRedirect(
  pathname: string,
  paths: ReadonlyMap<string, string>,
): string | null {
  const path = normalizeRequestPath(pathname);
  const moved = lookupRedirect(path, paths);
  if (moved) return moved;

  const unprefixed = stripLocalePrefix(path, ['en']);
  if (unprefixed) {
    return lookupRedirect(unprefixed, paths) ?? unprefixed;
  }

  const [, locale, file, ...rest] = path.split('/');
  if (
    rest.length === 0 &&
    file !== undefined &&
    ROOT_ONLY_FILES.has(file) &&
    (BASE_LOCALES as readonly string[]).includes(locale ?? '') &&
    locale !== 'en'
  ) {
    return `/${file}`;
  }
  return null;
}
