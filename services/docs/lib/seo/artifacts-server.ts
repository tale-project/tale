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

import { createOnDemandServer, type ArtifactsServer } from '@tale/ui/seo';
import { TALE_SITE_URL } from '@tale/ui/seo/globals';

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
 * Construct an on-demand artifact server for the docs site.
 *
 * Construction is **synchronous and side-effect-free**: the `buildDocsSeo`
 * walk is deferred to the first request that needs it (via `getBuilt`),
 * exactly like the marketing site's server. This matters because
 * `vite.config.ts` instantiates this at config-evaluation time — making it
 * `async` forced a top-level `await` there, which blocks Vite from creating
 * and listening on the dev server until the walk resolves. Under CI runner
 * contention that top-level await intermittently stalled the docs dev server
 * past Playwright's `webServer` timeout (the search/landing smoke never even
 * touches these artifacts). Keeping it sync removes that startup hazard.
 *
 * `robots.disallow` still reflects noindex frontmatter: it's backed by a
 * stable array that the first lazy build fills. The robots plugin awaits
 * `ctx.routes()` (→ `getBuilt`) before reading `ctx.robots.disallow`, so the
 * list is populated by the time `/robots.txt` is rendered.
 */
export function createDocsArtifactsServer(
  options: DocsArtifactsServerOptions = {},
): ArtifactsServer {
  const siteUrl = docsSiteUrl();

  // Stable reference handed to the underlying server's static `RobotsConfig`;
  // refilled from each build so dev edits to `noindex` frontmatter show up.
  const disallow: string[] = [];

  let cached: BuiltDocsSeo | null = null;
  async function getBuilt(): Promise<BuiltDocsSeo> {
    if (cached) return cached;
    const next = await buildDocsSeo(siteUrl);
    disallow.splice(0, disallow.length, ...next.noindexPaths);
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
    robots: {
      disallow,
      // Symmetric with marketing robots — each surface advertises the other.
      extraSitemaps: [`${TALE_SITE_URL}/sitemap.xml`],
    },
  });
}
