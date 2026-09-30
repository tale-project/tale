/**
 * What docs.tale.dev answers for an address, read from the sources the build
 * turns into the site: the content tree, `public/`, the redirect map
 * (`lib/redirects.ts`) and the SEO artifacts. It feeds the link lint —
 * `tests/links.test.ts` judges every link in the docs, the repository-wide
 * `bun run lint:links` every link into them — with no build and no server.
 *
 * Paths match exactly, as the Linux server matches them: files are listed
 * once and compared as strings, never probed through a filesystem that may
 * ignore case.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractPageAnchors,
  type AddressAnswer,
  type LinkSite,
  type LinkSiteModule,
  type PageAddress,
  type SitePage,
} from '@tale/ui/docs/links';
import { buildNearMissIndex } from '@tale/ui/docs/near-miss';
import { slugRoute } from '@tale/ui/docs/redirects';

import { docPath } from '../lib/content/paths';
import { docsNearMissPages } from '../lib/near-miss';
import { buildRedirectPathMap, resolveRedirect } from '../lib/redirects';

const SERVICE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The docs content tree, `docs/<locale>/**` at the repository root. */
export const DOCS_CONTENT_ROOT = resolve(SERVICE_ROOT, '..', '..', 'docs');
const PUBLIC_ROOT = resolve(SERVICE_ROOT, 'public');

/** The public origin the docs are served at. */
export const DOCS_ORIGIN = 'https://docs.tale.dev';

/** Files the SEO artifact server answers at the site root. */
const ARTIFACTS: ReadonlySet<string> = new Set([
  '/llms.txt',
  '/llms-full.txt',
  '/robots.txt',
  '/sitemap.xml',
]);

/** Every file under `dir`, as site paths (`/images/x.webp`). */
function listFiles(dir: string, root = dir): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    console.warn(`[docs link-site] cannot read ${dir}:`, error);
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, root);
    return [`/${relative(root, full).split(sep).join('/')}`];
  });
}

const PUBLIC_FILES: ReadonlySet<string> = new Set(listFiles(PUBLIC_ROOT));
const CONTENT_FILES: ReadonlySet<string> = new Set(
  listFiles(DOCS_CONTENT_ROOT),
);
const PATHS = buildRedirectPathMap();

/** The locale and locale-less route an address names (`/de/x` → `de`, `x`). */
function split(pathname: string): { locale: string; route: string } {
  const trimmed = pathname.replace(/\/+$/, '');
  const [, first = '', ...rest] = trimmed.split('/');
  if (first === 'de' || first === 'fr') {
    return { locale: first, route: rest.join('/') };
  }
  return { locale: 'en', route: trimmed.slice(1) };
}

/** The content file behind a page, relative to the content root. */
function pageFile(locale: string, route: string): string | undefined {
  const slugs = route === '' ? ['index'] : [route, `${route}/index`];
  for (const slug of slugs) {
    for (const extension of ['.md', '.mdx']) {
      const file = `/${locale}/${slug}${extension}`;
      if (CONTENT_FILES.has(file)) return file;
    }
  }
  return undefined;
}

const anchorCache = new Map<string, ReadonlySet<string>>();

/** The ids a page renders, read from its Markdown on first use. */
function anchorsOf(file: string): ReadonlySet<string> {
  let anchors = anchorCache.get(file);
  if (!anchors) {
    anchors = extractPageAnchors(
      readFileSync(join(DOCS_CONTENT_ROOT, file), 'utf8'),
    );
    anchorCache.set(file, anchors);
  }
  return anchors;
}

/** What the docs server answers for a decoded pathname. */
export function answerDocsPath(pathname: string): AddressAnswer {
  if (ARTIFACTS.has(pathname) || PUBLIC_FILES.has(pathname)) {
    return { kind: 'file' };
  }
  const markdown = pathname.endsWith('.md');
  const { locale, route } = split(
    markdown ? pathname.replace(/\.md$/, '').replace(/\/index$/, '') : pathname,
  );
  // The content files on disk decide, not the generated manifest: a page
  // deleted without regenerating it must still read as gone.
  const file = pageFile(locale, route);
  if (file) {
    if (markdown) return { kind: 'file' };
    return { kind: 'page', locale, anchors: () => anchorsOf(file) };
  }
  const target = resolveRedirect(pathname, PATHS);
  if (target !== null) return { kind: 'redirect', to: target };
  return { kind: 'missing' };
}

/** docs.tale.dev as the link lint sees it. */
export const DOCS_LINK_SITE: LinkSite = {
  origins: [DOCS_ORIGIN],
  answer: answerDocsPath,
  nearMiss: {
    index: buildNearMissIndex(docsNearMissPages()),
    routeOf: (pathname) => split(pathname.replace(/\.md$/, '')).route,
    pathFor: (route, pathname) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `split` only answers the three base locales
      docPath(split(pathname).locale as 'en' | 'de' | 'fr', route),
  },
};

const PAGE_FILE = /^docs\/(en|de|fr)\/(.+)\.mdx?$/;

/** Where a docs file is served — also for a deleted one; null for no page. */
export function docsPageAddress(file: string): PageAddress | null {
  const match = PAGE_FILE.exec(file);
  if (!match) return null;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the pattern only matches the three base locales
  const locale = match[1] as 'en' | 'de' | 'fr';
  const slug = match[2] ?? '';
  return {
    url: `${DOCS_ORIGIN}${docPath(locale, slug)}`,
    slug: slugRoute(slug) || 'index',
  };
}

/** Every docs page file, with the URL it is served at and its locale. */
export function docsPageFiles(): (SitePage & { locale: string })[] {
  return [...CONTENT_FILES].flatMap((listed) => {
    const file = `docs${listed}`;
    const address = docsPageAddress(file);
    const locale = PAGE_FILE.exec(file)?.[1];
    return address && locale ? [{ file, url: address.url, locale }] : [];
  });
}

/** docs.tale.dev for the repository-wide `bun run lint:links`. */
export const LINK_SITE_MODULE: LinkSiteModule = {
  site: DOCS_LINK_SITE,
  pages: docsPageFiles,
  contentRoot: 'docs/',
  pageAddress: docsPageAddress,
  ledger: 'docs/published.json',
  redirects: 'docs/redirects.json',
};
