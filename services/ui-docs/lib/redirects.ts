/**
 * Redirects for the design-system docs, on the documentation frame's
 * machinery (`@tale/ui/docs/redirects`, shared with docs.tale.dev). Three
 * kinds of address answer a 301 to a real guide before static serving:
 *
 *  - `/docs` — the navigation's first guide is the front door (the
 *    client route does the same after hydration, but a crawler, a link
 *    checker or an agent reading the raw answer only sees the server's);
 *  - a section folder with no guide of its own (`/docs/components`) — the
 *    first guide under it in `content/nav.json` order, derived, never
 *    hand-maintained;
 *  - a moved, merged or deleted guide — `content/redirects.json`, which
 *    `tests/published.test.ts` requires for every slug that ever shipped.
 *
 * The per-page Markdown export follows its page (`/docs/old.md` → the
 * target's `.md`). Everything still unanswered after static serving is read
 * as a guess by `lib/near-miss.ts`.
 */

import {
  buildRedirectPathMap,
  deriveSectionRedirects,
  lookupRedirect,
  normalizeRequestPath,
  parseRedirects,
  slugRoute,
  type RedirectMap,
} from '@tale/ui/docs/redirects';

// Relative, not `@/`: the Bun-run server imports this module, and Bun does
// not resolve the root tsconfig's `${configDir}` paths.
import redirectsJson from '../content/redirects.json';
import { firstNavSlug, flattenNav } from './content/nav';

/** Site-relative path of a guide slug; the empty slug is `/docs` itself. */
export function guidePath(slug: string): string {
  const route = slugRoute(slug);
  return route ? `/docs/${route}` : '/docs';
}

/** The validated slug map, baked into the bundle at build time. */
export const EXPLICIT_REDIRECTS: RedirectMap = parseRedirects(
  redirectsJson,
  'services/ui-docs/content/redirects.json',
);

/** `/docs`, the section folders, then the explicit moves (which win). */
const UI_DOCS_REDIRECTS: RedirectMap = {
  '': firstNavSlug(),
  ...deriveSectionRedirects(
    flattenNav().map(({ slug }) => slug),
    EXPLICIT_REDIRECTS,
  ),
  ...EXPLICIT_REDIRECTS,
};

/** Old URL path → new URL path, for the server and the prerender tests. */
export const REDIRECT_PATHS: ReadonlyMap<string, string> = buildRedirectPathMap(
  UI_DOCS_REDIRECTS,
  { locales: ['en'], pagePath: (_locale, slug) => guidePath(slug) },
);

/** Where a request path redirects, or null to serve it as is. */
export function resolveRedirect(pathname: string): string | null {
  return lookupRedirect(normalizeRequestPath(pathname), REDIRECT_PATHS) ?? null;
}
