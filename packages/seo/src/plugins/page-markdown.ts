/**
 * Per-page `.md` plugin — owns every `/<route>.md` URL. Matches the
 * pathname predicate `endsWith('.md')`; resolves the underlying route
 * lazily on first build, falls back to a 404 (returns `null`) when the
 * pathname doesn't map to any known route.
 */

import {
  isMdPathname,
  pathnameToRouteUrl,
  routeToMdPath,
} from '../builders/md-paths';
import { pageAsMarkdown } from '../builders/page-as-markdown';
import type { ArtifactPlugin } from '../runtime/plugin';
import { CONTENT_TYPES, STATIC_CACHE_CONTROL } from '../types';

export const pageMarkdownPlugin: ArtifactPlugin = {
  id: 'page-markdown',
  match: isMdPathname,
  cacheKey: (pathname) => pathname,
  async build(pathname, ctx) {
    const { sections } = await ctx.routes();
    const targetUrl = pathnameToRouteUrl(pathname);
    const route = sections
      .flatMap((s) => s.routes)
      .find((r) => r.url === targetUrl);
    if (!route) return null;

    const body = await ctx.body(route.url);
    if (body == null) return null;

    return {
      body: pageAsMarkdown({
        frontmatter: {
          title: route.title,
          ...(route.description ? { description: route.description } : {}),
        },
        body,
        siteUrl: ctx.siteUrl,
      }),
      contentType: CONTENT_TYPES.md,
      cacheControl: STATIC_CACHE_CONTROL,
    };
  },
  async enumerate(ctx) {
    const { sections } = await ctx.routes();
    const out: string[] = [];
    for (const section of sections) {
      for (const route of section.routes) {
        if ((await ctx.body(route.url)) == null) continue;
        out.push(`/${routeToMdPath(route.url)}`);
      }
    }
    return out;
  },
};
