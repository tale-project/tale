/**
 * The design-system docs' answer to an address that names no guide, redirect
 * or file — the last step before the 404 page (`server.ts`), on the
 * documentation frame's near-miss scorer (`@tale/ui/docs/near-miss`).
 *
 * Guides are scored by slug and title, so `/docs/button`, `/components/button`
 * (the `/docs` mount forgotten) and `/docs/components/buton` all land on the
 * button guide. A sidebar group is found by its label in any of the chrome's
 * languages (`/docs/komponenten`, `/docs/foundations`) and answers with its
 * first guide. A stray `/DE/…` or `/fr/…` prefix is dropped — the site is
 * one English tree. The 404 page ranks its "did you mean" list with the same
 * guides and labels.
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
import { lookupRedirect } from '@tale/ui/docs/redirects';

// Relative, not `@/`: the Bun-run server imports this module, and Bun does
// not resolve the root tsconfig's `${configDir}` paths.
import frontmatterManifest from '../app/content/frontmatter.json';
import deMessages from '../messages/de.yml';
import enMessages from '../messages/en.yml';
import frMessages from '../messages/fr.yml';
import {
  flattenNav,
  isNavGroup,
  UI_DOCS_NAV,
  type UiDocsNavGroup,
} from './content/nav';
import { guidePath, REDIRECT_PATHS } from './redirects';

interface ManifestEntry {
  slug: string;
  frontmatter: Record<string, string | boolean>;
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generated manifest, fixed shape
const MANIFEST = frontmatterManifest as Record<string, ManifestEntry>;

/** Every guide in navigation order, with its title and sidebar label. */
export function uiDocsNearMissPages(): (NearMissPage & { slug: string })[] {
  return flattenNav().map(({ slug }) => {
    const frontmatter = MANIFEST[slug]?.frontmatter ?? {};
    const titles = [frontmatter.title, frontmatter.sidebarTitle].filter(
      (title): title is string => typeof title === 'string',
    );
    return { slug, route: slug, titles };
  });
}

/** The catalogs the sidebar reads its group labels from, one per language. */
const CATALOGS: readonly unknown[] = [enMessages, deMessages, frMessages];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A group's sidebar label in every language (`nav.groups.components`). */
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

function toNearMissGroup(group: UiDocsNavGroup): NearMissNavGroup {
  return {
    labels: groupLabels(group.labelKey),
    entries: group.pages.map((entry) =>
      isNavGroup(entry) ? toNearMissGroup(entry) : entry.slug,
    ),
  };
}

/** The sidebar's groups, each with its label in every language. */
export function uiDocsNearMissGroups(): NearMissNavGroup[] {
  return UI_DOCS_NAV.map(toNearMissGroup);
}

const PAGES: ReadonlySet<string> = new Set(Object.keys(MANIFEST));
let index: NearMissIndex | undefined;

/** Built on the first guess, not on every page load that imports this. */
export function uiDocsNearMissIndex(): NearMissIndex {
  index ??= buildNearMissIndex(uiDocsNearMissPages(), uiDocsNearMissGroups());
  return index;
}

/**
 * Where an address that names nothing should send the reader, or null for
 * the 404 page.
 */
export function resolveMissingUiDocsPath(
  pathname: string,
): MissingAddressAnswer | null {
  return resolveMissingAddress(pathname, {
    prefixedLocales: [],
    strayLocales: ['de', 'fr'],
    defaultLocale: 'en',
    mount: 'docs',
    pagePath: (_locale, route) => guidePath(route),
    isPage: (_locale, route) => PAGES.has(route),
    redirectFor: (path) => lookupRedirect(path, REDIRECT_PATHS),
    index: uiDocsNearMissIndex(),
  });
}

/** The server's `resolveNotFound` hook, under the public mount prefix. */
export function createNearMissRoute(
  basePath: string,
): (request: Request, url: URL) => Response | null {
  return createRoute({ resolve: resolveMissingUiDocsPath, basePath });
}
