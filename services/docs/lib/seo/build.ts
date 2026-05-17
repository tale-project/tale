/**
 * Shared route + body discovery for the docs site. Used by both the dev
 * on-demand server (`artifacts-server.ts`) and the build-time precompile
 * CLI config (`scripts/seo.config.ts`) so the two modes produce the same
 * output.
 *
 * Walks `docs/` for every `.md`/`.mdx` page across `en`, `de`, `fr`,
 * builds the section/route tree the SEO package consumes, and exposes
 * everything needed downstream: per-URL bodies, noindex paths, and the
 * canonical config block for `compileToDisk`.
 */

import { statSync } from 'node:fs';

import type {
  ArtifactRoute,
  ArtifactSection,
  CompileToDiskParams,
  OptionalPage,
} from '@tale/seo';
import { TALE_GITHUB_URL } from '@tale/seo/globals';

import { listAllContent, type ContentRecord } from '../../scripts/walk-content';
import { DEFAULT_DOCS_SITE_URL } from '../site-url';

export const DOCS_SITE_TITLE = 'Tale';
export const DOCS_SITE_DESCRIPTION =
  'The sovereign AI platform — local AI models, agents, skills, and automations on your own infrastructure.';
const BASE_LOCALES = ['en', 'de', 'fr'] as const;

/** Site-relative URL for a (locale, slug) pair. English has no prefix. */
function pathFor(locale: string, slug: string): string {
  const cleaned = slug === 'index' ? '' : slug.replace(/\/index$/, '');
  if (locale === 'en') return cleaned ? `/${cleaned}` : '/';
  return cleaned ? `/${locale}/${cleaned}` : `/${locale}`;
}

/** Maps a slug's top-level folder to a `## Section` heading in `llms.txt`. */
function sectionFor(slug: string): string {
  const top = slug.split('/')[0];
  if (top === 'cloud') return 'Cloud';
  if (top === 'self-hosted') return 'Self-hosted';
  if (top === 'platform') return 'Platform';
  if (top === 'develop') return 'Develop';
  if (top === 'tutorials') return 'Tutorials';
  return 'Start here';
}

function fileMtimeIso(path: string): string {
  try {
    return statSync(path).mtime.toISOString();
  } catch (error) {
    console.warn(`[docs/seo] fileMtimeIso fallback for ${path}:`, error);
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

function toRoute(
  page: ContentRecord,
  alternates?: Record<string, string>,
): ArtifactRoute {
  return {
    url: pathFor(page.locale, page.slug),
    title: getString(page.frontmatter, 'title') ?? page.slug,
    description: getString(page.frontmatter, 'description'),
    lastModified: fileMtimeIso(page.filePath),
    alternates,
  };
}

export interface BuiltDocsSeo {
  sections: ArtifactSection[];
  bodiesByUrl: Map<string, string>;
  /** Site-relative URLs whose pages have `noindex: true` in frontmatter. */
  noindexPaths: string[];
}

export async function buildDocsSeo(siteUrl: string): Promise<BuiltDocsSeo> {
  const records = await listAllContent();
  const byLocale = new Map<string, ContentRecord[]>();
  for (const r of records) {
    const list = byLocale.get(r.locale) ?? [];
    list.push(r);
    byLocale.set(r.locale, list);
  }

  const enPages = (byLocale.get('en') ?? [])
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const alternatesBySlug = new Map<string, Record<string, string>>();
  for (const slug of new Set(enPages.map((p) => p.slug))) {
    const alts: Record<string, string> = {};
    for (const locale of BASE_LOCALES) {
      if ((byLocale.get(locale) ?? []).some((p) => p.slug === slug)) {
        alts[locale] = `${siteUrl}${pathFor(locale, slug)}`;
      }
    }
    alts['x-default'] = alts.en;
    alternatesBySlug.set(slug, alts);
  }

  const enSectionMap = new Map<string, ArtifactRoute[]>();
  for (const page of enPages) {
    const route = toRoute(page, alternatesBySlug.get(page.slug));
    const heading = sectionFor(page.slug);
    const list = enSectionMap.get(heading) ?? [];
    list.push(route);
    enSectionMap.set(heading, list);
  }
  const sections: ArtifactSection[] = [...enSectionMap.entries()].map(
    ([heading, routes]) => ({ heading, routes }),
  );

  const alternateRoutes: ArtifactRoute[] = [];
  for (const locale of BASE_LOCALES.filter((l) => l !== 'en')) {
    for (const page of byLocale.get(locale) ?? []) {
      alternateRoutes.push(toRoute(page, alternatesBySlug.get(page.slug)));
    }
  }
  sections.push({
    heading: 'Localised variants',
    hideFromIndex: true,
    routes: alternateRoutes,
  });

  const bodiesByUrl = new Map<string, string>();
  for (const record of records) {
    bodiesByUrl.set(pathFor(record.locale, record.slug), record.body);
  }

  const noindexPaths = enPages
    .filter((p) => p.frontmatter.noindex === true)
    .map((p) => pathFor('en', p.slug));

  return { sections, bodiesByUrl, noindexPaths };
}

export function docsSiteUrl(): string {
  return process.env.DOCS_SITE_URL ?? DEFAULT_DOCS_SITE_URL;
}

export function docsOptionalPages(siteUrl: string): OptionalPage[] {
  return [
    {
      title: 'OpenAPI specification',
      url: `${siteUrl}/develop/api-reference.md`,
    },
    { title: 'GitHub', url: TALE_GITHUB_URL },
  ];
}

/**
 * Resolve every parameter `compileToDisk` (or any other consumer of the
 * full plugin pipeline) needs to render the docs artifact set. Reused by
 * the build-time CLI config and by tests that want to drive the pipeline
 * end-to-end without disk IO.
 */
export async function buildDocsCompileParams(): Promise<
  Omit<CompileToDiskParams, 'outDir'>
> {
  const siteUrl = docsSiteUrl();
  const { sections, bodiesByUrl, noindexPaths } = await buildDocsSeo(siteUrl);

  return {
    siteUrl,
    siteTitle: DOCS_SITE_TITLE,
    siteDescription: DOCS_SITE_DESCRIPTION,
    sections,
    optionalPages: docsOptionalPages(siteUrl),
    robots: { disallow: noindexPaths },
    loadBody: async (url) => bodiesByUrl.get(url) ?? null,
  };
}
