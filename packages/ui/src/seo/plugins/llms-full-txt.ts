/**
 * `llms-full.txt` plugin — concatenates every body-bearing route into a
 * single document. Owns `/llms-full.txt`.
 */

import { buildLlmsFullTxt } from '../builders/llms-full-txt';
import type { ArtifactPlugin } from '../runtime/plugin';
import { CONTENT_TYPES, STATIC_CACHE_CONTROL } from '../types';

export const LLMS_FULL_TXT_PATH = '/llms-full.txt';

export const llmsFullTxtPlugin: ArtifactPlugin = {
  id: 'llms-full-txt',
  match: LLMS_FULL_TXT_PATH,
  cacheKey: () => 'static',
  async build(_pathname, ctx) {
    const { sections } = await ctx.routes();
    const routes = sections.flatMap((s) => s.routes);
    const trimmedSiteUrl = ctx.siteUrl.replace(/\/+$/, '');

    const pages: { title: string; url: string; body: string }[] = [];
    for (const route of routes) {
      const body = await ctx.body(route.url);
      if (body == null) continue;
      pages.push({
        title: route.title,
        url: `${trimmedSiteUrl}${route.url}`,
        body,
      });
    }
    if (pages.length === 0) return null;

    return {
      body: buildLlmsFullTxt(pages),
      contentType: CONTENT_TYPES.txt,
      cacheControl: STATIC_CACHE_CONTROL,
    };
  },
  async enumerate(ctx) {
    const { sections } = await ctx.routes();
    for (const section of sections) {
      for (const route of section.routes) {
        if ((await ctx.body(route.url)) != null) return [LLMS_FULL_TXT_PATH];
      }
    }
    return [];
  },
};
