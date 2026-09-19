/**
 * `llms.txt` plugin — owns `/llms.txt` (the page index).
 */

import { buildLlmsTxt } from '../builders/llms-txt';
import { routeToMdUrl } from '../builders/md-paths';
import type { ArtifactPlugin } from '../runtime/plugin';
import { CONTENT_TYPES, STATIC_CACHE_CONTROL } from '../types';

export const LLMS_TXT_PATH = '/llms.txt';

export const llmsTxtPlugin: ArtifactPlugin = {
  id: 'llms-txt',
  match: LLMS_TXT_PATH,
  cacheKey: () => 'static',
  async build(_pathname, ctx) {
    const { sections, optionalPages } = await ctx.routes();
    const trimmedSiteUrl = ctx.siteUrl.replace(/\/+$/, '');

    const body = buildLlmsTxt({
      siteTitle: ctx.siteTitle,
      siteDescription: ctx.siteDescription,
      sections: sections
        .filter((s) => !s.hideFromIndex)
        .map((s) => ({
          heading: s.heading,
          intro: s.intro,
          pages: s.routes.map((r) => ({
            title: r.title,
            url: `${trimmedSiteUrl}${routeToMdUrl(r.url)}`,
            description: r.description,
          })),
        })),
      optional: optionalPages,
    });

    return {
      body,
      contentType: CONTENT_TYPES.txt,
      cacheControl: STATIC_CACHE_CONTROL,
    };
  },
  async enumerate() {
    return [LLMS_TXT_PATH];
  },
};
