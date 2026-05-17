/**
 * On-demand SEO + LLM artifact server.
 *
 * The runtime iterates a list of {@link ArtifactPlugin}s on each request:
 * the first plugin whose `match` accepts the pathname renders the
 * response. Results are cached in-memory keyed by
 * `${plugin.id}:${plugin.cacheKey(pathname)}` so static artifacts
 * (`/llms.txt`, `/sitemap.xml`, `/robots.txt`) share one slot per service
 * while per-page `.md` artifacts cache independently.
 *
 * A single negative cache remembers `.md` pathnames that don't map to any
 * known route so a hostile flood doesn't keep re-enumerating sections.
 * It's bounded and cap-and-clears once full.
 *
 * Use this in dev (Vite plugin) for fresh-on-every-request semantics; in
 * production prefer `createPrecompiledServer` so no source IO happens at
 * request time.
 */

import { defaultPlugins } from '../plugins/default';
import type {
  ArtifactSection,
  OptionalPage,
  ResolvedRoutes,
  RobotsConfig,
} from '../types';
import { ArtifactCache } from './cache';
import { etagOf, respondWithEtag, type CachedEntry } from './etag';
import {
  pluginMatches,
  type ArtifactPlugin,
  type ArtifactResponse,
  type BuildContext,
} from './plugin';

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
   * source edits show up immediately. Defaults to `true`.
   */
  cache?: boolean;
  /**
   * Override the default plugin set. Most callers should not pass this;
   * the default covers every Tale artifact type.
   */
  plugins?: readonly ArtifactPlugin[];
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

export function createOnDemandServer(
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
    plugins = defaultPlugins(),
  } = params;

  const cache = new ArtifactCache();

  function clear(): void {
    cache.clear();
  }

  /**
   * Build a per-request context. `routes()` and `body()` are memoised so
   * the multiple plugins involved in one request don't pay duplicate IO.
   */
  function makeContext(): BuildContext {
    let routesPromise: Promise<ResolvedRoutes> | null = null;
    const bodyMemo = new Map<string, Promise<string | null>>();

    const routes = (): Promise<ResolvedRoutes> => {
      if (!routesPromise) routesPromise = loadRoutes();
      return routesPromise;
    };

    async function inlineBody(url: string): Promise<string | null> {
      const { sections } = await routes();
      for (const section of sections) {
        for (const route of section.routes) {
          if (route.url === url && typeof route.body === 'string') {
            return route.body;
          }
        }
      }
      return null;
    }

    const body = (url: string): Promise<string | null> => {
      const cached = bodyMemo.get(url);
      if (cached) return cached;
      const resolved = (async (): Promise<string | null> => {
        const inline = await inlineBody(url);
        if (inline != null) return inline;
        return loadBody ? loadBody(url) : null;
      })();
      bodyMemo.set(url, resolved);
      return resolved;
    };

    return {
      siteUrl,
      siteTitle,
      siteDescription,
      robots,
      routes,
      body,
    };
  }

  function entryFor(response: ArtifactResponse): CachedEntry {
    return {
      body: response.body,
      etag: etagOf(response.body),
      contentType: response.contentType,
      cacheControl: response.cacheControl,
    };
  }

  async function buildForPlugin(
    plugin: ArtifactPlugin,
    pathname: string,
    ctx: BuildContext,
  ): Promise<CachedEntry | null> {
    const cacheKey = `${plugin.id}:${plugin.cacheKey(pathname)}`;

    if (cacheEnabled) {
      const hit = cache.get(cacheKey);
      if (hit) return hit;
      if (cache.isKnownMiss(pathname)) return null;
    }

    const response = await plugin.build(pathname, ctx);
    if (response == null) {
      if (cacheEnabled) cache.rememberMiss(pathname);
      return null;
    }
    const entry = entryFor(response);
    if (cacheEnabled) cache.set(cacheKey, entry);
    return entry;
  }

  return {
    async handle(request) {
      const url = new URL(request.url);
      const pathname = url.pathname;

      let ctx: BuildContext | null = null;
      for (const plugin of plugins) {
        if (!pluginMatches(plugin, pathname)) continue;
        if (!ctx) ctx = makeContext();
        const entry = await buildForPlugin(plugin, pathname, ctx);
        if (entry) return respondWithEtag(request, entry);
      }

      return null;
    },
    invalidate: clear,
  };
}

/**
 * @deprecated Use {@link createOnDemandServer} for dev or
 * `createPrecompiledServer` for production. Kept as a thin alias so
 * service-local code still compiles during migration.
 */
export const createArtifactsServer = createOnDemandServer;
