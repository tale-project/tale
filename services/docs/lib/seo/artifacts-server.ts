/**
 * On-demand SEO + LLM artifact server for the docs site.
 *
 * Walks `docs/` for every `.md`/`.mdx` page across all locales and serves:
 *
 *   - `/llms.txt`        (English-only index, grouped by top-level section)
 *   - `/llms-full.txt`   (every body, including non-English variants)
 *   - `/sitemap.xml`     (every locale, with hreflang alternates per slug)
 *   - `/robots.txt`      (declares the docs sitemap)
 *   - `/<route>.md`      (every locale × every page)
 *
 * Bodies are read straight from disk; there's no React render involved
 * because the docs surface ships source markdown.
 */

import { statSync } from 'node:fs';

import {
  createArtifactsServer,
  type ArtifactRoute,
  type ArtifactSection,
  type ArtifactsServer,
} from '@tale/seo';
import { TALE_GITHUB_URL } from '@tale/seo/globals';

import { listAllContent, type ContentRecord } from '../../scripts/walk-content';
import { DEFAULT_DOCS_SITE_URL } from '../site-url';

const SITE_TITLE = 'Tale';
const SITE_DESCRIPTION =
  'The sovereign AI platform — local AI models, agents, skills, and automations on your own infrastructure.';
const BASE_LOCALES = ['en', 'de', 'fr'] as const;

interface DocsArtifactsServerOptions {
  /** Disable in-memory caching (set in dev so edits show up immediately). */
  cache?: boolean;
}

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
  } catch {
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

interface BuiltSections {
  sections: ArtifactSection[];
  bodiesByUrl: Map<string, string>;
  /** Site-relative URLs whose pages have `noindex: true` in frontmatter. */
  noindexPaths: string[];
}

async function buildSections(): Promise<BuiltSections> {
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

  // Per-slug hreflang alternates. Same block is attached to every locale
  // variant of the same logical page, per the sitemap spec.
  const alternatesBySlug = new Map<string, Record<string, string>>();
  for (const slug of new Set(enPages.map((p) => p.slug))) {
    const alts: Record<string, string> = {};
    for (const locale of BASE_LOCALES) {
      if ((byLocale.get(locale) ?? []).some((p) => p.slug === slug)) {
        alts[locale] = `${DEFAULT_DOCS_SITE_URL}${pathFor(locale, slug)}`;
      }
    }
    alts['x-default'] = alts.en;
    alternatesBySlug.set(slug, alts);
  }

  // English routes — grouped by top-level slug folder so each renders as a
  // `## Section` in `llms.txt`.
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

  // Non-English routes feed the sitemap and per-page `.md`, but stay out
  // of the `llms.txt` index (which is English-only).
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

/**
 * Asynchronously construct an artifact server for the docs site. We
 * scan the docs tree once up front to discover `noindex` pages so they
 * can be added to `robots.disallow` (the underlying server takes a
 * static `RobotsConfig`).
 */
export async function createDocsArtifactsServer(
  options: DocsArtifactsServerOptions = {},
): Promise<ArtifactsServer> {
  const siteUrl = process.env.DOCS_SITE_URL ?? DEFAULT_DOCS_SITE_URL;
  const initial = await buildSections();

  let cached: BuiltSections | null = options.cache === false ? null : initial;
  async function getBuilt(): Promise<BuiltSections> {
    if (cached) return cached;
    const next = await buildSections();
    if (options.cache !== false) cached = next;
    return next;
  }

  return createArtifactsServer({
    siteUrl,
    siteTitle: SITE_TITLE,
    siteDescription: SITE_DESCRIPTION,
    cache: options.cache,
    loadRoutes: async () => {
      const { sections } = await getBuilt();
      return {
        sections,
        optionalPages: [
          {
            title: 'OpenAPI specification',
            url: `${siteUrl}/develop/api-reference.md`,
          },
          { title: 'GitHub', url: TALE_GITHUB_URL },
        ],
      };
    },
    loadBody: async (url) => {
      const { bodiesByUrl } = await getBuilt();
      return bodiesByUrl.get(url) ?? null;
    },
    robots: { disallow: initial.noindexPaths },
  });
}
