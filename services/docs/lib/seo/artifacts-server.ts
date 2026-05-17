/**
 * On-demand SEO + LLM artifact server for the docs site — **dev only**.
 *
 * Production reads the precompiled `dist-seo/` directory directly via
 * `createPrecompiledServer` (see `server.ts`). This module exists so
 * `vite.config.ts` can serve fresh artifacts on every edit without a
 * restart.
 *
 * Walks `docs/` for every `.md`/`.mdx` page across all locales and
 * exposes:
 *
 *   - `/llms.txt`        (English-only index, grouped by top-level section)
 *   - `/llms-full.txt`   (every body, including non-English variants)
 *   - `/sitemap.xml`     (every locale, with hreflang alternates per slug)
 *   - `/robots.txt`      (declares the docs sitemap)
 *   - `/<route>.md`      (every locale × every page)
 */

import { createOnDemandServer, type ArtifactsServer } from '@tale/seo';

import {
  buildDocsSeo,
  docsOptionalPages,
  docsSiteUrl,
  DOCS_SITE_DESCRIPTION,
  DOCS_SITE_TITLE,
  type BuiltDocsSeo,
} from './build';

interface DocsArtifactsServerOptions {
  /** Disable in-memory caching (set in dev so edits show up immediately). */
  cache?: boolean;
}

/**
 * Construct an on-demand artifact server for the docs site. The initial
 * `buildDocsSeo` walk runs eagerly so `robots.disallow` can be seeded
 * with noindex paths discovered from frontmatter — the underlying server
 * takes a static `RobotsConfig`.
 */
export async function createDocsArtifactsServer(
  options: DocsArtifactsServerOptions = {},
): Promise<ArtifactsServer> {
  const siteUrl = docsSiteUrl();
  const initial = await buildDocsSeo(siteUrl);

  let cached: BuiltDocsSeo | null = options.cache === false ? null : initial;
  async function getBuilt(): Promise<BuiltDocsSeo> {
    if (cached) return cached;
    const next = await buildDocsSeo(siteUrl);
    if (options.cache !== false) cached = next;
    return next;
  }

  return createOnDemandServer({
    siteUrl,
    siteTitle: DOCS_SITE_TITLE,
    siteDescription: DOCS_SITE_DESCRIPTION,
    cache: options.cache,
    loadRoutes: async () => ({
      sections: (await getBuilt()).sections,
      optionalPages: docsOptionalPages(siteUrl),
    }),
    loadBody: async (url) => {
      const { bodiesByUrl } = await getBuilt();
      return bodiesByUrl.get(url) ?? null;
    },
    robots: { disallow: initial.noindexPaths },
  });
}
