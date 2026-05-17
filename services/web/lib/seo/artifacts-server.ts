/**
 * On-demand SEO + LLM artifact server for the marketing site — **dev only**.
 *
 * Production reads the precompiled `dist-seo/` directory via
 * `createPrecompiledServer` (see `server.ts`). This module exists so
 * `vite.config.ts` can serve fresh artifacts on every edit without a
 * restart, including SSR-rendered marketing pages.
 */

import { createOnDemandServer, type ArtifactsServer } from '@tale/seo';
import { TALE_DOCS_URL, TALE_SITE_URL } from '@tale/seo/globals';

import { enumerateLegalRoutes } from '../../scripts/legal-routes';
import {
  buildWebSections,
  makeWebLoadBody,
  WEB_SITE_DESCRIPTION,
  WEB_SITE_TITLE,
  webOptionalPages,
  type SsrRenderer,
} from './build';

interface MarketingArtifactsServerParams {
  /**
   * SSR renderer used to fetch the body of a marketing route. Caller
   * supplies the runtime-specific implementation (Vite `ssrLoadModule`
   * in dev, the prebuilt `dist-ssr/entry-server.js` in prod).
   */
  ssr: SsrRenderer;
  /**
   * Disable caching so dev edits show up without a restart. Defaults to
   * `true` for production.
   */
  cache?: boolean;
}

export function createMarketingArtifactsServer(
  params: MarketingArtifactsServerParams,
): ArtifactsServer {
  return createOnDemandServer({
    siteUrl: TALE_SITE_URL,
    siteTitle: WEB_SITE_TITLE,
    siteDescription: WEB_SITE_DESCRIPTION,
    cache: params.cache,
    loadRoutes: async () => ({
      sections: buildWebSections(await enumerateLegalRoutes()),
      optionalPages: webOptionalPages(),
    }),
    loadBody: makeWebLoadBody(params.ssr),
    robots: {
      // Crawlers find the docs surface through its own sitemap too.
      extraSitemaps: [`${TALE_DOCS_URL}/sitemap.xml`],
    },
  });
}
