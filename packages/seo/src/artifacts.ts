/**
 * Pure artifact compiler. Returns a `path → content` map for every
 * artifact a Tale service might serve:
 *
 *   - `/llms.txt`         — page index for AI tools
 *   - `/llms-full.txt`    — every page body concatenated
 *   - `/sitemap.xml`      — canonical URLs + per-locale hreflang alternates
 *   - `/robots.txt`       — defaults + service-specific overrides
 *   - `/<route>.md`       — per-page markdown (when `emitPerPageMarkdown`)
 *
 * The function has no IO and no caching; the on-demand request server
 * in `./serve-artifacts` wraps it with both. Callers that want to write
 * the result to disk (e.g. a CI-only snapshot exporter) can do so by
 * iterating the returned map.
 */

import { buildLlmsFullTxt } from './llms-full-txt';
import { buildLlmsTxt } from './llms-txt';
import { pageAsMarkdown } from './page-as-markdown';
import { buildRobotsTxt } from './robots';
import { buildSitemap, type SitemapPage } from './sitemap';

// ---------------------------------------------------------------------------
// Route + section shape
// ---------------------------------------------------------------------------

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

interface RobotsConfig {
  /** Additional sitemap URLs (the main one is added automatically). */
  extraSitemaps?: readonly string[];
  disallow?: readonly string[];
  extraDisallow?: readonly string[];
  userAgent?: string;
}

// ---------------------------------------------------------------------------
// Pure layer — `compileArtifacts`
// ---------------------------------------------------------------------------

export interface CompileArtifactsParams {
  /** Absolute base URL (e.g. `https://tale.dev`). */
  siteUrl: string;
  /** llms.txt `# Title`. */
  siteTitle: string;
  /** llms.txt blockquote shown right under the title. */
  siteDescription: string;
  /** Page groups. Flattened into both the sitemap and the llms.txt index. */
  sections: readonly ArtifactSection[];
  /** Cross-link entries listed under llms.txt's trailing `## Optional`. */
  optionalPages?: readonly OptionalPage[];
  /** robots.txt overrides — the main sitemap URL is added automatically. */
  robots?: RobotsConfig;
  /**
   * Emit a `/<route>.md` entry for each route with a `body`. Default true.
   * Disable for services that produce `.md` from a separate prerender step.
   */
  emitPerPageMarkdown?: boolean;
}

export interface CompiledArtifacts {
  /**
   * Map from output-relative path (e.g. `llms.txt`, `legal/privacy.md`)
   * to file contents. Always uses POSIX separators.
   */
  files: ReadonlyMap<string, string>;
}

/**
 * Builds every artifact in-memory and returns the result as a map of
 * `<output-relative path>` → `<content>`. Pure; no IO.
 */
export function compileArtifacts(
  params: CompileArtifactsParams,
): CompiledArtifacts {
  const {
    siteUrl,
    siteTitle,
    siteDescription,
    sections,
    optionalPages,
    robots,
    emitPerPageMarkdown = true,
  } = params;

  const files = new Map<string, string>();

  const allRoutes = sections.flatMap((s) => s.routes);
  const routesWithBody = allRoutes.filter(
    (r): r is ArtifactRoute & { body: string } => typeof r.body === 'string',
  );

  // llms.txt — index of every public page, English-listing for hreflang sites.
  files.set(
    'llms.txt',
    buildLlmsTxt({
      siteTitle,
      siteDescription,
      sections: sections
        .filter((s) => !s.hideFromIndex)
        .map((s) => ({
          heading: s.heading,
          intro: s.intro,
          pages: s.routes.map((r) => ({
            title: r.title,
            url: `${siteUrl}${routeToMdUrl(r.url)}`,
            description: r.description,
          })),
        })),
      optional: optionalPages,
    }),
  );

  // llms-full.txt — every body concatenated. Only emitted when any route
  // carries a body.
  if (routesWithBody.length > 0) {
    files.set(
      'llms-full.txt',
      buildLlmsFullTxt(
        routesWithBody.map((r) => ({
          title: r.title,
          url: `${siteUrl}${r.url}`,
          body: r.body,
        })),
      ),
    );
  }

  // sitemap.xml — every route (incl. hidden-from-index alternates).
  if (allRoutes.length > 0) {
    files.set(
      'sitemap.xml',
      buildSitemap(
        allRoutes.map((r) => ({
          url: `${siteUrl}${r.url}`,
          lastModified: r.lastModified,
          alternates: r.alternates,
        })),
      ),
    );
  }

  // robots.txt — declares own sitemap automatically; supplements with extras.
  const sitemapUrls =
    allRoutes.length > 0
      ? [`${siteUrl}/sitemap.xml`, ...(robots?.extraSitemaps ?? [])]
      : (robots?.extraSitemaps ?? []);
  files.set(
    'robots.txt',
    buildRobotsTxt({
      sitemaps: sitemapUrls,
      disallow: robots?.disallow,
      extraDisallow: robots?.extraDisallow,
      userAgent: robots?.userAgent,
    }),
  );

  // Per-page .md endpoints — one per route with a body.
  if (emitPerPageMarkdown) {
    for (const r of routesWithBody) {
      files.set(
        routeToMdPath(r.url),
        pageAsMarkdown({
          frontmatter: {
            title: r.title,
            ...(r.description ? { description: r.description } : {}),
          },
          body: r.body,
          siteUrl,
        }),
      );
    }
  }

  return { files };
}

/** `/foo` → `/foo.md`, `/` → `/index.md`. Always starts with `/`. */
function routeToMdUrl(url: string): string {
  return url === '/' ? '/index.md' : `${url}.md`;
}

/** Same as {@link routeToMdUrl} but without the leading slash for filesystem use. */
function routeToMdPath(url: string): string {
  return url === '/' ? 'index.md' : `${url.replace(/^\//, '')}.md`;
}
