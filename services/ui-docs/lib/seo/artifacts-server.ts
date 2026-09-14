/**
 * On-demand SEO + LLM artifact server for the design-system docs — **dev
 * only**. Production reads the precompiled `dist-seo/` directory through
 * `createPrecompiledServer` (see `server.ts`); this module exists so
 * `vite.config.ts` can serve fresh artifacts on every markdown edit without a
 * restart.
 *
 * It exposes `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/robots.txt` and
 * `/<route>.md` for every content page.
 */

import { createOnDemandServer, type ArtifactsServer } from '@tale/ui/seo';
import { TALE_SITE_URL } from '@tale/ui/seo/globals';

import {
  buildUiDocsSeo,
  uiDocsOptionalPages,
  uiDocsSiteUrl,
  UI_DOCS_SITE_DESCRIPTION,
  UI_DOCS_SITE_TITLE,
  type BuiltUiDocsSeo,
} from './build';

interface UiDocsArtifactsServerOptions {
  /** Disable in-memory caching (set in dev so edits show up immediately). */
  cache?: boolean;
}

/**
 * Construction is **synchronous and side-effect-free**: the content walk is
 * deferred to the first request that needs it. `vite.config.ts` instantiates
 * this at config-evaluation time, and a top-level `await` there blocks Vite
 * from listening — which is exactly how the docs site once stalled CI past
 * Playwright's `webServer` timeout.
 */
export function createUiDocsArtifactsServer(
  options: UiDocsArtifactsServerOptions = {},
): ArtifactsServer {
  const siteUrl = uiDocsSiteUrl();

  // Stable reference handed to the server's static `RobotsConfig`; refilled
  // from each build so dev edits to `noindex` frontmatter show up.
  const disallow: string[] = [];

  let cached: BuiltUiDocsSeo | null = null;
  async function getBuilt(): Promise<BuiltUiDocsSeo> {
    if (cached) return cached;
    const next = await buildUiDocsSeo();
    disallow.splice(0, disallow.length, ...next.noindexPaths);
    if (options.cache !== false) cached = next;
    return next;
  }

  return createOnDemandServer({
    siteUrl,
    siteTitle: UI_DOCS_SITE_TITLE,
    siteDescription: UI_DOCS_SITE_DESCRIPTION,
    cache: options.cache,
    loadRoutes: async () => ({
      sections: (await getBuilt()).sections,
      optionalPages: uiDocsOptionalPages(),
    }),
    loadBody: async (url) => {
      const { bodiesByUrl } = await getBuilt();
      return bodiesByUrl.get(url) ?? null;
    },
    robots: {
      disallow,
      extraSitemaps: [`${TALE_SITE_URL}/sitemap.xml`],
    },
  });
}
