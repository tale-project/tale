/**
 * What ui.tale.dev answers for an address, read from the sources the build
 * turns into the site: the guides under `content/`, `public/`, the redirect
 * map (`lib/redirects.ts`) and the SEO artifacts. It feeds the link lint —
 * `tests/links.test.ts` judges every link in the guides, the repository-wide
 * `bun run lint:links` every link into them — with no build and no server.
 * Paths match exactly, as the Linux server matches them.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractPageAnchors,
  type AddressAnswer,
  type LinkSite,
  type LinkSiteModule,
  type SitePage,
} from '@tale/ui/docs/links';
import { buildNearMissIndex } from '@tale/ui/docs/near-miss';

import { uiDocsNearMissPages } from '../lib/near-miss';
import { guidePath, resolveRedirect } from '../lib/redirects';

const SERVICE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The guides, `services/ui-docs/content/**`. */
export const UI_DOCS_CONTENT_ROOT = resolve(SERVICE_ROOT, 'content');
const PUBLIC_ROOT = resolve(SERVICE_ROOT, 'public');

/** The public origin the design-system docs are served at. */
export const UI_DOCS_ORIGIN = 'https://ui.tale.dev';

const ARTIFACTS: ReadonlySet<string> = new Set([
  '/llms.txt',
  '/llms-full.txt',
  '/robots.txt',
  '/sitemap.xml',
]);

/** Every file under `dir`, as paths relative to it (`/x/y.md`). */
function listFiles(dir: string, root = dir): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    console.warn(`[ui-docs link-site] cannot read ${dir}:`, error);
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, root);
    return [`/${relative(root, full).split(sep).join('/')}`];
  });
}

const PUBLIC_FILES: ReadonlySet<string> = new Set(listFiles(PUBLIC_ROOT));
/** Guide slug (`components/button`) → its file under `content/`. */
const GUIDES: ReadonlyMap<string, string> = new Map(
  listFiles(UI_DOCS_CONTENT_ROOT)
    .filter((file) => file.endsWith('.md') && file.split('/').length > 2)
    .map((file) => [file.slice(1).replace(/\.md$/, ''), file]),
);

const anchorCache = new Map<string, ReadonlySet<string>>();

function anchorsOf(file: string): ReadonlySet<string> {
  let anchors = anchorCache.get(file);
  if (!anchors) {
    anchors = extractPageAnchors(
      readFileSync(join(UI_DOCS_CONTENT_ROOT, file), 'utf8'),
    );
    anchorCache.set(file, anchors);
  }
  return anchors;
}

/** What the ui-docs server answers for a decoded pathname. */
export function answerUiDocsPath(pathname: string): AddressAnswer {
  if (ARTIFACTS.has(pathname) || PUBLIC_FILES.has(pathname)) {
    return { kind: 'file' };
  }
  if (pathname === '/') return { kind: 'page' };
  const markdown = pathname.endsWith('.md');
  const trimmed = pathname.replace(/\.md$/, '').replace(/\/+$/, '');
  const slug = trimmed.startsWith('/docs/')
    ? trimmed.slice('/docs/'.length)
    : '';
  const file = GUIDES.get(slug);
  if (file) {
    return markdown
      ? { kind: 'file' }
      : { kind: 'page', anchors: () => anchorsOf(file) };
  }
  const target = resolveRedirect(pathname);
  if (target !== null) return { kind: 'redirect', to: target };
  return { kind: 'missing' };
}

/** ui.tale.dev as the link lint sees it. */
export const UI_DOCS_LINK_SITE: LinkSite = {
  origins: [UI_DOCS_ORIGIN],
  answer: answerUiDocsPath,
  nearMiss: {
    index: buildNearMissIndex(uiDocsNearMissPages()),
    routeOf: (pathname) =>
      pathname.replace(/\.md$/, '').replace(/^\/(?:docs\/?)?/, ''),
    pathFor: (route) => guidePath(route),
  },
};

/** Every guide file, with the URL it is served at. */
export function uiDocsPageFiles(): SitePage[] {
  return [...GUIDES].map(([slug, file]) => ({
    file: `services/ui-docs/content${file}`,
    url: `${UI_DOCS_ORIGIN}${guidePath(slug)}`,
  }));
}

/** ui.tale.dev for the repository-wide `bun run lint:links`. */
export const LINK_SITE_MODULE: LinkSiteModule = {
  site: UI_DOCS_LINK_SITE,
  pages: uiDocsPageFiles,
  contentRoot: 'services/ui-docs/content/',
};
