/**
 * The docs site's answer to an address that names no page, redirect or file
 * — the last step before the 404 page (`server.ts`), built on the
 * documentation frame's near-miss scorer (`@tale/ui/docs/near-miss`).
 *
 * Every page is scored by its slug and by its title and sidebar label in
 * every locale, read from the frontmatter manifest, so a German title turned
 * into a slug under a translated folder (`/de/verwaltung/mitglieder-und-rollen`)
 * still finds its page. The sidebar's group labels, read from the message
 * catalogs, name their section's front page the same way: `/de/verwaltung`
 * is the label of the `platform/admin` group, which no page carries as a
 * title. A retired regional tree (`/de-CH/…`, `/fr-CH/…`), capitals or a
 * trailing `index` fold onto the real address with a 301; a guess answers a
 * 302 to the page that clearly wins. The 404 page ranks its "did you mean"
 * list with the same pages, titles and labels.
 */

import {
  buildNearMissIndex,
  createNearMissRoute as createRoute,
  resolveMissingAddress,
  type MissingAddressAnswer,
  type NearMissIndex,
  type NearMissNavGroup,
  type NearMissPage,
} from '@tale/ui/docs/near-miss';
import { lookupRedirect, slugRoute } from '@tale/ui/docs/redirects';
import { URL_PREFIXED_LOCALES } from '@tale/ui/i18n/locales';

// Relative, not `@/`: the Bun-run server imports this module, and Bun does
// not resolve the root tsconfig's `${configDir}` paths.
import frontmatterManifest from '../app/content/frontmatter.json';
import deMessages from '../messages/de.yml';
import enMessages from '../messages/en.yml';
import frMessages from '../messages/fr.yml';
import {
  DOCS_NAV,
  type DocsNavGroup,
  flattenNav,
  isNavGroup,
} from './content/nav';
import { docPath } from './content/paths';
import type { SupportedLocale } from './i18n/locales';

interface ManifestEntry {
  slug: string;
  locale: string;
  frontmatter: Record<string, string | boolean>;
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generated manifest, fixed shape
const MANIFEST = frontmatterManifest as Record<string, ManifestEntry>;

/** `locale:route` for every page the site serves. */
const PAGE_KEYS: ReadonlySet<string> = new Set(
  Object.values(MANIFEST).map(
    (entry) => `${entry.locale}:${slugRoute(entry.slug)}`,
  ),
);

/** A page's title and sidebar label in every locale, keyed by route. */
function titlesByRoute(): Map<string, string[]> {
  const titles = new Map<string, string[]>();
  for (const entry of Object.values(MANIFEST)) {
    const route = slugRoute(entry.slug);
    const list = titles.get(route) ?? [];
    for (const key of ['title', 'sidebarTitle']) {
      const value = entry.frontmatter[key];
      if (typeof value === 'string' && !list.includes(value)) list.push(value);
    }
    titles.set(route, list);
  }
  return titles;
}

/** Every page in reading order (navigation first), with all its titles. */
export function docsNearMissPages(): (NearMissPage & { slug: string })[] {
  const titles = titlesByRoute();
  const seen = new Set<string>();
  const pages: (NearMissPage & { slug: string })[] = [];
  const add = (slug: string) => {
    const route = slugRoute(slug);
    if (seen.has(route)) return;
    seen.add(route);
    pages.push({ slug, route, titles: titles.get(route) ?? [] });
  };
  for (const { slug } of flattenNav()) add(slug);
  for (const entry of Object.values(MANIFEST)) add(entry.slug);
  return pages;
}

/** The catalogs the sidebar reads its group labels from, one per locale. */
const CATALOGS: readonly unknown[] = [enMessages, deMessages, frMessages];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A group's sidebar label in every locale (`nav.groups.admin`). */
function groupLabels(labelKey: string): string[] {
  const labels: string[] = [];
  for (const catalog of CATALOGS) {
    let node: unknown = catalog;
    for (const key of labelKey.split('.')) {
      node = isRecord(node) ? node[key] : undefined;
    }
    if (typeof node === 'string' && !labels.includes(node)) labels.push(node);
  }
  return labels;
}

function toNearMissGroup(group: DocsNavGroup): NearMissNavGroup {
  return {
    labels: groupLabels(group.labelKey),
    entries: group.pages.map((entry) =>
      isNavGroup(entry) ? toNearMissGroup(entry) : slugRoute(entry.slug),
    ),
  };
}

/** The sidebar's groups, each with its label in every locale. */
export function docsNearMissGroups(): NearMissNavGroup[] {
  return DOCS_NAV.map(toNearMissGroup);
}

let index: NearMissIndex | undefined;

/** Built on the first guess, not on every page load that imports this. */
export function docsNearMissIndex(): NearMissIndex {
  index ??= buildNearMissIndex(docsNearMissPages(), docsNearMissGroups());
  return index;
}

/** Whether a route is a page in a locale (`de`, `platform/admin/teams`). */
export function isDocsPage(locale: string, route: string): boolean {
  return PAGE_KEYS.has(`${locale}:${route}`);
}

/**
 * Where an address that names nothing should send the reader, or null for
 * the 404 page. `paths` is the redirect map the server already answers
 * (`buildRedirectPathMap`), so a folded address that names a moved page
 * lands on its target in one hop.
 */
export function resolveMissingDocsPath(
  pathname: string,
  paths: ReadonlyMap<string, string>,
): MissingAddressAnswer | null {
  return resolveMissingAddress(pathname, {
    prefixedLocales: URL_PREFIXED_LOCALES,
    defaultLocale: 'en',
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the resolver only hands back the locales listed above
    pagePath: (locale, route) => docPath(locale as SupportedLocale, route),
    isPage: isDocsPage,
    redirectFor: (path) => lookupRedirect(path, paths),
    index: docsNearMissIndex(),
  });
}

/** The server's `resolveNotFound` hook, under the public mount prefix. */
export function createNearMissRoute({
  paths,
  basePath,
}: {
  paths: ReadonlyMap<string, string>;
  basePath: string;
}): (request: Request, url: URL) => Response | null {
  return createRoute({
    resolve: (pathname) => resolveMissingDocsPath(pathname, paths),
    basePath,
  });
}
