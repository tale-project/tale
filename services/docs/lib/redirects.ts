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
 */

import redirectsJson from '../../../docs/redirects.json';
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

/** The validated slug map, baked into the bundle at build time. */
const DOCS_REDIRECTS: Record<string, string> = parseRedirects(redirectsJson);

/** Site-relative URL for a (locale, slug) pair — mirrors `docPath` in
 *  `lib/content/paths.ts` (English at the canonical path, `de`/`fr`
 *  prefixed; a trailing `/index` collapses onto the directory URL). */
function pathFor(locale: SupportedLocale, slug: string): string {
  const cleaned = slug === 'index' ? '' : slug.replace(/\/index$/, '');
  if (locale === 'en') return cleaned ? `/${cleaned}` : '/';
  return cleaned ? `/${locale}/${cleaned}` : `/${locale}`;
}

/** Expand every locale-less slug pair into per-locale URL path pairs. */
export function expandRedirects(
  redirects: Record<string, string> = DOCS_REDIRECTS,
): RedirectRoute[] {
  const out: RedirectRoute[] = [];
  for (const [from, to] of Object.entries(redirects)) {
    for (const locale of BASE_LOCALES) {
      out.push({
        locale,
        from: pathFor(locale, from),
        to: pathFor(locale, to),
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
