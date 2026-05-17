/**
 * Shared types used across the SEO + LLM artifact builders, plugins, and
 * runtime modes (on-demand and precompiled). Kept here so neither layer
 * imports the other for type-only reasons.
 */

import type { SitemapPage } from './builders/sitemap';

export interface ArtifactRoute {
  /** Site-relative URL (no origin) — `/`, `/pricing`, `/de/legal/imprint`. */
  url: string;
  title: string;
  description?: string;
  /**
   * Markdown body. When set, the route appears in `llms-full.txt` and gets
   * a per-page `.md` (subject to `emitPerPageMarkdown`).
   */
  body?: string;
  /** Per-locale absolute URL alternates emitted as sitemap `xhtml:link`. */
  alternates?: SitemapPage['alternates'];
  /** ISO-8601 last-modified date for sitemap `<lastmod>`. */
  lastModified?: string;
}

export interface ArtifactSection {
  heading: string;
  /** Intro paragraph between the section heading and the page list. */
  intro?: string;
  routes: readonly ArtifactRoute[];
  /**
   * When true, the section's routes still feed the sitemap, `llms-full.txt`,
   * and per-page `.md` output, but they're omitted from the `llms.txt`
   * index. Used for hreflang alternates: every locale variant belongs in
   * the sitemap, but the `llms.txt` index stays English-only.
   */
  hideFromIndex?: boolean;
}

export interface OptionalPage {
  title: string;
  url: string;
  description?: string;
}

export interface RobotsConfig {
  /** Additional sitemap URLs (the main one is added automatically). */
  extraSitemaps?: readonly string[];
  disallow?: readonly string[];
  extraDisallow?: readonly string[];
  userAgent?: string;
}

export interface ResolvedRoutes {
  sections: readonly ArtifactSection[];
  optionalPages?: readonly OptionalPage[];
}

export const STATIC_CACHE_CONTROL =
  'public, max-age=300, stale-while-revalidate=86400';

export const CONTENT_TYPES = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
} as const;
