/**
 * On-demand SEO + LLM artifact server. One call returns a request handler
 * that serves every artifact type a Tale service exposes:
 *
 *   - `/llms.txt`
 *   - `/llms-full.txt`
 *   - `/sitemap.xml`
 *   - `/robots.txt`
 *   - `/<route>.md`
 *
 * Everything is rendered on demand at request time and cached in-memory
 * keyed by URL. The "static" artifacts (`llms.txt`, `sitemap.xml`,
 * `robots.txt`) share one cache slot; `llms-full.txt` and per-page `.md`
 * each have their own because their cost is different (per-route body
 * fetches).
 *
 * Services configure the server with a route loader and an optional body
 * loader. The loaders are called lazily on the first request that needs
 * them; after that everything is cached until `invalidate()` is called.
 *
 * Replaces both the per-service `scripts/build-llms-artifacts.ts` scripts
 * and the old `createOnDemandMdRenderer` helper.
 */

import { createHash } from 'node:crypto';

import {
  compileArtifacts,
  type ArtifactSection,
  type OptionalPage,
} from './artifacts';
import { buildLlmsFullTxt } from './llms-full-txt';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RobotsConfig {
  /** Additional sitemap URLs (the main one is added automatically). */
  extraSitemaps?: readonly string[];
  disallow?: readonly string[];
  extraDisallow?: readonly string[];
  userAgent?: string;
}

export interface ArtifactsServerParams {
  /** Absolute base URL (e.g. `https://tale.dev`). */
  siteUrl: string;
  /** llms.txt `# Title`. */
  siteTitle: string;
  /** llms.txt blockquote shown right under the title. */
  siteDescription: string;
  /**
   * Lazy route enumeration. Called on the first request that needs the
   * route list; the result is cached until {@link ArtifactsServer.invalidate}
   * runs.
   *
   * Routes carry `body` only when it is cheap to inline (typical for
   * file-backed pages). For SSR-rendered pages, leave `body` undefined
   * here and provide a {@link loadBody} fetcher.
   */
  loadRoutes: () => Promise<{
    sections: ArtifactSection[];
    optionalPages?: OptionalPage[];
  }>;
  /**
   * Lazy body fetcher used for routes whose `body` isn't set by
   * `loadRoutes`. Receives the site-relative URL; returns markdown body
   * or `null` if the route doesn't have one.
   */
  loadBody?: (url: string) => Promise<string | null>;
  /** robots.txt overrides — the main sitemap URL is added automatically. */
  robots?: RobotsConfig;
  /**
   * Disable in-memory caching so every request rebuilds. Useful in dev so
   * source edits show up immediately. Defaults to true.
   */
  cache?: boolean;
}

export interface ArtifactsServer {
  /**
   * Handles a request. Returns a `Response` for any artifact URL the
   * server is responsible for, or `null` so the caller can fall through
   * to other handlers (static serving, SPA shell, …).
   */
  handle(request: Request): Promise<Response | null>;
  /** Clear all cached artifacts. The next request triggers fresh builds. */
  invalidate(): void;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface CachedEntry {
  body: string;
  etag: string;
  contentType: string;
}

const STATIC_ARTIFACT_PATHS: ReadonlySet<string> = new Set([
  '/llms.txt',
  '/sitemap.xml',
  '/robots.txt',
]);
const STATIC_CACHE_CONTROL =
  'public, max-age=300, stale-while-revalidate=86400';

const CONTENT_TYPES = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
} as const;

function etagOf(content: string): string {
  return `"${createHash('sha256').update(content).digest('hex').slice(0, 16)}"`;
}

function pathnameToRouteUrl(pathname: string): string {
  return pathname === '/index.md' ? '/' : pathname.replace(/\.md$/, '');
}

function respond(request: Request, entry: CachedEntry): Response {
  if (request.headers.get('if-none-match') === entry.etag) {
    return new Response(null, { status: 304 });
  }
  return new Response(entry.body, {
    headers: {
      'content-type': entry.contentType,
      etag: entry.etag,
      'cache-control': STATIC_CACHE_CONTROL,
    },
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function createArtifactsServer(
  params: ArtifactsServerParams,
): ArtifactsServer {
  const {
    siteUrl,
    siteTitle,
    siteDescription,
    loadRoutes,
    loadBody,
    robots,
    cache: cacheEnabled = true,
  } = params;

  // Three cache slots — see file header for why they are split.
  let staticCache: Map<string, CachedEntry> | null = null;
  let llmsFullEntry: CachedEntry | null = null;
  const mdCache = new Map<string, CachedEntry>();

  function clear(): void {
    staticCache = null;
    llmsFullEntry = null;
    mdCache.clear();
  }

  /** Compile the static artifact set (`llms.txt`, `sitemap.xml`, `robots.txt`). */
  async function getStaticArtifacts(): Promise<Map<string, CachedEntry>> {
    if (cacheEnabled && staticCache) return staticCache;
    const { sections, optionalPages } = await loadRoutes();
    const { files } = compileArtifacts({
      siteUrl,
      siteTitle,
      siteDescription,
      sections,
      optionalPages,
      robots,
      emitPerPageMarkdown: false,
    });

    const out = new Map<string, CachedEntry>();
    for (const path of ['llms.txt', 'sitemap.xml', 'robots.txt']) {
      const body = files.get(path);
      if (!body) continue;
      const ext = path.endsWith('.xml') ? CONTENT_TYPES.xml : CONTENT_TYPES.txt;
      out.set(`/${path}`, { body, etag: etagOf(body), contentType: ext });
    }
    if (cacheEnabled) staticCache = out;
    return out;
  }

  /** Render `llms-full.txt` by fetching every route's body. */
  async function getLlmsFull(): Promise<CachedEntry | null> {
    if (cacheEnabled && llmsFullEntry) return llmsFullEntry;
    const { sections } = await loadRoutes();
    const routes = sections.flatMap((s) => s.routes);

    const pages: { title: string; url: string; body: string }[] = [];
    for (const route of routes) {
      const body = route.body ?? (loadBody ? await loadBody(route.url) : null);
      if (body == null) continue;
      pages.push({ title: route.title, url: `${siteUrl}${route.url}`, body });
    }
    if (pages.length === 0) return null;

    const body = buildLlmsFullTxt(pages);
    const entry: CachedEntry = {
      body,
      etag: etagOf(body),
      contentType: CONTENT_TYPES.txt,
    };
    if (cacheEnabled) llmsFullEntry = entry;
    return entry;
  }

  /** Render a single `/<route>.md` endpoint. */
  async function getMd(pathname: string): Promise<CachedEntry | null> {
    if (cacheEnabled && mdCache.has(pathname)) {
      return mdCache.get(pathname) ?? null;
    }

    const { sections } = await loadRoutes();
    const targetUrl = pathnameToRouteUrl(pathname);
    const route = sections
      .flatMap((s) => s.routes)
      .find((r) => r.url === targetUrl);
    if (!route) return null;

    const body = route.body ?? (loadBody ? await loadBody(route.url) : null);
    if (body == null) return null;

    // We import lazily so the helper module loads only when needed.
    const { pageAsMarkdown } = await import('./page-as-markdown');
    const markdown = pageAsMarkdown({
      frontmatter: {
        title: route.title,
        ...(route.description ? { description: route.description } : {}),
      },
      body,
      siteUrl,
    });

    const entry: CachedEntry = {
      body: markdown,
      etag: etagOf(markdown),
      contentType: CONTENT_TYPES.md,
    };
    if (cacheEnabled) mdCache.set(pathname, entry);
    return entry;
  }

  return {
    async handle(request) {
      const url = new URL(request.url);
      const pathname = url.pathname;

      if (STATIC_ARTIFACT_PATHS.has(pathname)) {
        const map = await getStaticArtifacts();
        const entry = map.get(pathname);
        return entry ? respond(request, entry) : null;
      }

      if (pathname === '/llms-full.txt') {
        const entry = await getLlmsFull();
        return entry ? respond(request, entry) : null;
      }

      if (pathname.endsWith('.md')) {
        const entry = await getMd(pathname);
        return entry ? respond(request, entry) : null;
      }

      return null;
    },
    invalidate: clear,
  };
}
