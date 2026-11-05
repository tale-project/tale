/**
 * Default plugin set — every artifact type a Tale React service serves.
 *
 * Order matters because the on-demand server iterates this list until a
 * match hits. Static paths (`/llms.txt`, `/llms-full.txt`, `/sitemap.xml`,
 * `/robots.txt`) come first; the catch-all `endsWith('.md')` page-markdown
 * plugin must be last so it doesn't shadow future static `.md` paths.
 */

import type { ArtifactPlugin } from '../runtime/plugin';
import { llmsFullTxtPlugin } from './llms-full-txt';
import { llmsTxtPlugin } from './llms-txt';
import { pageMarkdownPlugin } from './page-markdown';
import { robotsPlugin } from './robots';
import { sitemapPlugin } from './sitemap';

export function defaultPlugins(): readonly ArtifactPlugin[] {
  return [
    llmsTxtPlugin,
    llmsFullTxtPlugin,
    sitemapPlugin,
    robotsPlugin,
    pageMarkdownPlugin,
  ];
}
