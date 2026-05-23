/**
 * `robots.txt` plugin — owns `/robots.txt`. Always emits (even for
 * services without a sitemap, where the file is a bare disallow list).
 */

import { buildRobotsTxt } from '../builders/robots';
import type { ArtifactPlugin } from '../runtime/plugin';
import { CONTENT_TYPES, STATIC_CACHE_CONTROL } from '../types';
import { SITEMAP_PATH } from './sitemap';

export const ROBOTS_PATH = '/robots.txt';

export const robotsPlugin: ArtifactPlugin = {
  id: 'robots',
  match: ROBOTS_PATH,
  cacheKey: () => 'static',
  async build(_pathname, ctx) {
    const { sections } = await ctx.routes();
    const hasRoutes = sections.some((s) => s.routes.length > 0);
    const trimmedSiteUrl = ctx.siteUrl.replace(/\/+$/, '');

    const sitemaps = hasRoutes
      ? [
          `${trimmedSiteUrl}${SITEMAP_PATH}`,
          ...(ctx.robots?.extraSitemaps ?? []),
        ]
      : (ctx.robots?.extraSitemaps ?? []);

    return {
      body: buildRobotsTxt({
        sitemaps,
        disallow: ctx.robots?.disallow,
        extraDisallow: ctx.robots?.extraDisallow,
        userAgent: ctx.robots?.userAgent,
      }),
      contentType: CONTENT_TYPES.txt,
      cacheControl: STATIC_CACHE_CONTROL,
    };
  },
  enumerate() {
    return Promise.resolve([ROBOTS_PATH]);
  },
};
