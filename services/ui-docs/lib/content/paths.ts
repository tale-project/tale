import { absoluteSitePath } from '@tale/ui/seo/urls';

import { DEFAULT_UI_DOCS_SITE_URL } from '@/lib/site-url';

/**
 * The site is English-only, so a page path is just its slug under `/docs`.
 * Keeping the mapping in one module means the router, the prerenderer and
 * the SEO artifact build can never disagree about a URL.
 */

// Vite replaces `import.meta.env.VITE_UI_DOCS_SITE_URL` at build time so the
// constant is available in the browser. Build scripts (Node/Bun) override it
// via `UI_DOCS_SITE_URL`.
function resolveSiteUrl(): string {
  if (typeof import.meta !== 'undefined') {
    const fromVite = import.meta.env?.VITE_UI_DOCS_SITE_URL;
    if (typeof fromVite === 'string' && fromVite.length > 0) return fromVite;
  }
  if (typeof process !== 'undefined') {
    const fromNode = process.env?.UI_DOCS_SITE_URL;
    if (typeof fromNode === 'string' && fromNode.length > 0) return fromNode;
  }
  return DEFAULT_UI_DOCS_SITE_URL;
}

const SITE_URL = resolveSiteUrl().replace(/\/+$/, '');

/** Route prefix every documentation page lives under. */
const DOCS_PREFIX = '/docs';

/** Site-relative path for a content slug (`components/button`). */
export function docPath(slug: string): string {
  return `${DOCS_PREFIX}/${slug}`;
}

/** Absolute URL for a content slug. */
export function docUrl(slug: string): string {
  return absoluteSitePath(SITE_URL, docPath(slug));
}

/** Absolute URL of the plain-markdown twin a crawler or an agent can read. */
export function docMarkdownUrl(slug: string): string {
  return absoluteSitePath(SITE_URL, `${docPath(slug)}.md`);
}

/** Repository-relative path of the markdown file behind a slug. */
export function contentFilePath(slug: string): string {
  return `services/ui-docs/content/${slug}.md`;
}

export { SITE_URL };
