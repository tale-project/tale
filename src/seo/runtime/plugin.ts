/**
 * Artifact plugin protocol — every URL the SEO server can serve is
 * declared as one of these.
 *
 * Two runtime modes consume plugins:
 *
 *   - `on-demand-server.ts`   matches `pathname → plugin.match`, calls
 *                             `plugin.build` lazily on first request, caches
 *                             by `${plugin.id}:${plugin.cacheKey(pathname)}`;
 *   - `compile.ts`            calls `plugin.enumerate` to discover every
 *                             concrete pathname, then `plugin.build` for
 *                             each so the result can be written to disk.
 *
 * Plugins are the single source of truth for content-type, cache-control,
 * and which pathnames map to which artifact type. The runtime knows
 * nothing else about specific artifacts.
 */

import type { ResolvedRoutes, RobotsConfig } from '../types';

/**
 * Per-request build context. The runtime memoises `routes()` and `body()`
 * so a plugin can call them without worrying about duplicate IO.
 */
export interface BuildContext {
  readonly siteUrl: string;
  readonly siteTitle: string;
  readonly siteDescription: string;
  readonly robots?: RobotsConfig;
  /** Memoised — never re-invokes the underlying loader within one build pass. */
  readonly routes: () => Promise<ResolvedRoutes>;
  /** Resolves inline `route.body` first; falls back to `loadBody(url)`. */
  readonly body: (url: string) => Promise<string | null>;
}

export interface ArtifactResponse {
  body: string;
  contentType: string;
  cacheControl: string;
}

export interface ArtifactPlugin {
  /** Stable plugin id (e.g. `'llms-txt'`). Used in manifests and telemetry. */
  readonly id: string;
  /**
   * Match a request pathname. A literal string for static artifacts
   * (`/llms.txt`); a predicate for plugins that own a family of paths
   * (per-page `.md`).
   */
  readonly match: string | ((pathname: string) => boolean);
  /**
   * Cache key per request. Static artifacts return a constant
   * (`'static'`); per-page plugins return the pathname so each page caches
   * independently.
   */
  cacheKey(pathname: string): string;
  /**
   * Render the artifact for `pathname`. Return `null` to signal "no such
   * artifact" so the request falls through to the next handler.
   */
  build(pathname: string, ctx: BuildContext): Promise<ArtifactResponse | null>;
  /**
   * Enumerate every concrete pathname this plugin owns — used by the
   * precompile path to materialise files. Returns `[]` when the plugin
   * has nothing to emit (e.g. no body-bearing routes).
   */
  enumerate(ctx: BuildContext): Promise<readonly string[]>;
}

/** True if `pathname` matches `plugin.match`. */
export function pluginMatches(
  plugin: ArtifactPlugin,
  pathname: string,
): boolean {
  if (typeof plugin.match === 'string') return plugin.match === pathname;
  return plugin.match(pathname);
}
