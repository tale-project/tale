/**
 * Shared route + body discovery for the design-system docs. Used by both the
 * dev on-demand artifact server (`artifacts-server.ts`) and the build-time
 * precompile config (`scripts/seo.config.ts`), so the two modes emit the same
 * bytes.
 *
 * The site is English-only: there are no locale prefixes and no hreflang
 * cluster, which is the one real simplification against `services/docs`.
 */

import { statSync } from 'node:fs';

import type {
  ArtifactRoute,
  ArtifactSection,
  CompileToDiskParams,
  OptionalPage,
} from '@tale/ui/seo';
import { TALE_GITHUB_URL, TALE_SITE_URL } from '@tale/ui/seo/globals';

import { listAllContent, type ContentRecord } from '../../scripts/walk-content';
import { DEFAULT_UI_DOCS_SITE_URL } from '../site-url';

export const UI_DOCS_SITE_TITLE = 'The Tale design system';
export const UI_DOCS_SITE_DESCRIPTION =
  'Documentation for @tale/ui and @tale/marketing-ui — the components, tokens and patterns every Tale interface is built from.';

/** Site-relative URL for a slug. The home page is the only route outside
 *  `/docs`, and it carries no markdown body. */
function pathFor(slug: string): string {
  return `/docs/${slug}`;
}

/** Maps a slug's top-level folder to a `## Section` heading in `llms.txt`. */
function sectionFor(slug: string): string {
  const top = slug.split('/')[0];
  if (top === 'getting-started') return 'Getting started';
  if (top === 'foundations') return 'Foundations';
  if (top === 'components') return 'Components';
  if (top === 'patterns') return 'Patterns';
  if (top === 'marketing-ui') return 'Marketing UI';
  return 'Reference';
}

function isNoindex(page: ContentRecord): boolean {
  return page.frontmatter.noindex === true;
}

function fileMtimeIso(path: string): string {
  try {
    return statSync(path).mtime.toISOString();
  } catch (error) {
    console.warn(`[ui-docs/seo] fileMtimeIso fallback for ${path}:`, error);
    return new Date().toISOString();
  }
}

function getString(
  fm: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = fm[key];
  return typeof value === 'string' ? value : undefined;
}

function toRoute(page: ContentRecord): ArtifactRoute {
  return {
    url: pathFor(page.slug),
    title: getString(page.frontmatter, 'title') ?? page.slug,
    description: getString(page.frontmatter, 'description'),
    // Filesystem mtime — a per-file `git log` across the tree is too slow for
    // the on-demand walk.
    lastModified: fileMtimeIso(page.filePath),
  };
}

export interface BuiltUiDocsSeo {
  sections: ArtifactSection[];
  bodiesByUrl: Map<string, string>;
  /** Site-relative URLs whose pages carry `noindex: true`. */
  noindexPaths: string[];
}

export async function buildUiDocsSeo(): Promise<BuiltUiDocsSeo> {
  const records = await listAllContent();

  const sectionMap = new Map<string, ArtifactRoute[]>();
  const noindexRoutes: ArtifactRoute[] = [];
  for (const page of records) {
    const route = toRoute(page);
    if (isNoindex(page)) {
      noindexRoutes.push(route);
      continue;
    }
    const heading = sectionFor(page.slug);
    const list = sectionMap.get(heading) ?? [];
    list.push(route);
    sectionMap.set(heading, list);
  }

  const sections: ArtifactSection[] = [...sectionMap.entries()].map(
    ([heading, routes]) => ({ heading, routes }),
  );
  if (noindexRoutes.length > 0) {
    sections.push({
      heading: 'Unlisted',
      excludeFromSitemap: true,
      routes: noindexRoutes,
    });
  }

  const bodiesByUrl = new Map<string, string>();
  for (const record of records) {
    bodiesByUrl.set(pathFor(record.slug), record.body);
  }

  const noindexPaths = records.filter(isNoindex).map((r) => pathFor(r.slug));

  return { sections, bodiesByUrl, noindexPaths };
}

export function uiDocsSiteUrl(): string {
  // Canonicalise: never return a trailing slash, otherwise every downstream
  // concatenation produces `https://ui.tale.dev//docs/…`.
  const raw = process.env.UI_DOCS_SITE_URL ?? DEFAULT_UI_DOCS_SITE_URL;
  return raw.replace(/\/+$/, '');
}

export function uiDocsOptionalPages(): OptionalPage[] {
  return [
    { title: 'Tale documentation', url: `${TALE_SITE_URL}/docs` },
    { title: 'GitHub', url: TALE_GITHUB_URL },
  ];
}

/**
 * Every parameter `compileToDisk` needs to render the artifact set. Reused by
 * the build-time config and by tests that drive the pipeline without disk IO.
 */
export async function buildUiDocsCompileParams(): Promise<
  Omit<CompileToDiskParams, 'outDir'>
> {
  const siteUrl = uiDocsSiteUrl();
  const { sections, bodiesByUrl, noindexPaths } = await buildUiDocsSeo();

  return {
    siteUrl,
    siteTitle: UI_DOCS_SITE_TITLE,
    siteDescription: UI_DOCS_SITE_DESCRIPTION,
    sections,
    optionalPages: uiDocsOptionalPages(),
    robots: {
      disallow: noindexPaths,
      // Symmetric with the other Tale surfaces — each advertises the others.
      extraSitemaps: [`${TALE_SITE_URL}/sitemap.xml`],
    },
    loadBody: async (url) => bodiesByUrl.get(url) ?? null,
  };
}
