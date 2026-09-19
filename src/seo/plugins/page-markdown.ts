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
    const routes = sections.flatMap((s) => s.routes);
    // Resolve every body in parallel so a docs site with hundreds of
    // pages doesn't serialise hundreds of IO round-trips at build time.
    // `ctx.body` is memoised by the runtime so any cache hit is free.
    const bodies = await Promise.all(routes.map((r) => ctx.body(r.url)));
    const out: string[] = [];
    for (let i = 0; i < routes.length; i++) {
      if (bodies[i] == null) continue;
      out.push(`/${routeToMdPath(routes[i].url)}`);
    }
    return out;
  },
};
