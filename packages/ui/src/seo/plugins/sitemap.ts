/**
 * `sitemap.xml` plugin — owns `/sitemap.xml`. Returns null when the
 * service has no public routes (e.g. the authenticated platform).
 */

import { buildSitemap } from '../builders/sitemap';
import type { ArtifactPlugin } from '../runtime/plugin';
import { CONTENT_TYPES, STATIC_CACHE_CONTROL } from '../types';

export const SITEMAP_PATH = '/sitemap.xml';

export const sitemapPlugin: ArtifactPlugin = {
  id: 'sitemap',
  match: SITEMAP_PATH,
  cacheKey: () => 'static',
  async build(_pathname, ctx) {
    const { sections } = await ctx.routes();
    const routes = sections.flatMap((s) => s.routes);
    if (routes.length === 0) return null;
    const trimmedSiteUrl = ctx.siteUrl.replace(/\/+$/, '');

    return {
      body: buildSitemap(
        routes.map((r) => ({
          url: `${trimmedSiteUrl}${r.url}`,
          lastModified: r.lastModified,
          alternates: r.alternates,
        })),
      ),
      contentType: CONTENT_TYPES.xml,
      cacheControl: STATIC_CACHE_CONTROL,
    };
  },
  async enumerate(ctx) {
    const { sections } = await ctx.routes();
    return sections.some((s) => s.routes.length > 0) ? [SITEMAP_PATH] : [];
  },
};
