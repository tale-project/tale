/**
 * Redirect map for moved or merged docs pages. The entries are read from
 * [`/docs/redirects.json`](../../../docs/redirects.json) at build time —
 * the same pattern as `lib/content/nav.ts` — so the bundled server carries
 * the map and the runtime image never reads from `/docs`. The machinery is
 * the documentation frame's (`@tale/ui/docs/redirects`), shared with ui-docs.
 *
 * Slugs are locale-less like `nav.json`'s (`platform/workspace/prompt-library`);
 * one entry covers every base locale. A page that moved to another site
 * (the legal texts on tale.dev) maps to an absolute `https://` URL and keeps
 * its locale there. `expandRedirects` produces the URL-level pairs (`/old`,
 * `/de/old`, `/fr/old` → …) that `server.ts` serves as 301s and
 * `scripts/prerender.ts` writes meta-refresh stubs for. The contract
 * (targets exist, sources don't, no chains, every published slug still
 * answers) is guarded by `tests/redirects.test.ts` and
 * `tests/published.test.ts`.
 *
 * Families of addresses people and language models guess are answered on
 * top of that map, so a near miss lands on a page instead of a 404:
 *
 *  - a section folder that has no page of its own (`/platform/automations`)
 *    redirects to the first page under it in `nav.json` order — derived from
 *    the navigation, never hand-maintained, and `redirects.json` wins;
 *  - the per-page Markdown export of a moved page or section folder
 *    (`/platform/automations.md`) follows it to the target's export;
 *  - an `/en` prefix (English lives at the root) and a locale-prefixed
 *    `llms.txt` / `llms-full.txt` (one index covers every locale) resolve
 *    to the unprefixed address; an `/en` page alias also pins the English
 *    locale cookie so the reader stays on the English page;
 *  - anything still unanswered when the server is about to send its 404 —
 *    a retired regional tree (`/de-CH/…`), capitals, a title turned into a
 *    slug — is read as a guess by `lib/near-miss.ts`.
 */

import {
  buildRedirectPathMap as buildPathMap,
  deriveSectionRedirects,
  expandRedirects as expand,
  lookupRedirect,
  normalizeRequestPath,
  parseRedirects,
  type RedirectMap,
  type RedirectRoute,
} from '@tale/ui/docs/redirects';
import {
  isLocaleNeutralPath,
  stripLocalePrefix,
} from '@tale/ui/i18n/negotiate';

import redirectsJson from '../../../docs/redirects.json';
import { firstNavSlug, flattenNav } from './content/nav';
import { docPath } from './content/paths';
import { BASE_LOCALES } from './i18n/locales';

export { deriveSectionRedirects, normalizeRequestPath, parseRedirects };

/** The validated slug map, baked into the bundle at build time. */
const EXPLICIT_REDIRECTS: RedirectMap = parseRedirects(
  redirectsJson,
  'docs/redirects.json',
);

/** Explicit moves plus the derived section folders (explicit entries win). */
const DOCS_REDIRECTS: RedirectMap = {
  ...deriveSectionRedirects(
    flattenNav().map(({ slug }) => slug),
    EXPLICIT_REDIRECTS,
  ),
  ...EXPLICIT_REDIRECTS,
};

/** Every base locale keeps its own tree: `/de/old` → `/de/new`. */
const EXPAND_OPTIONS = { locales: BASE_LOCALES, pagePath: docPath };

/** Expand every locale-less slug pair into per-locale URL path pairs. */
export function expandRedirects(
  redirects: RedirectMap = DOCS_REDIRECTS,
): RedirectRoute[] {
  return expand(redirects, EXPAND_OPTIONS);
}

/** Lookup map of old URL path → new URL path across every base locale. */
export function buildRedirectPathMap(
  redirects: RedirectMap = DOCS_REDIRECTS,
): Map<string, string> {
  return buildPathMap(redirects, EXPAND_OPTIONS);
}

/** Site-wide files served once at the root for every locale. */
const ROOT_ONLY_FILES = new Set(['llms.txt', 'llms-full.txt']);

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
  // The root now renders the first guide. Its retired Markdown twin keeps
  // answering at that guide's export, without creating a second SEO page.
  for (const locale of BASE_LOCALES) {
    const root = docPath(locale, 'index');
    if (path === (root === '/' ? '/index.md' : `${root}.md`)) {
      return `${docPath(locale, firstNavSlug())}.md`;
    }
  }
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

/**
 * Whether a request names English through the `/en` alias of a page. Its
 * redirect should then pin the English locale cookie: the unprefixed target
 * is otherwise re-negotiated, and a `de`/`fr` cookie or Accept-Language
 * would send the reader on to the German or French page.
 */
export function isEnglishPageAlias(pathname: string): boolean {
  const unprefixed = stripLocalePrefix(normalizeRequestPath(pathname), ['en']);
  return unprefixed !== null && !isLocaleNeutralPath(unprefixed);
}
