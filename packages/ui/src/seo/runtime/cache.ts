/**
 * In-memory cache primitives shared by the on-demand and precompiled
 * servers.
 *
 * The on-demand server uses {@link ArtifactCache} to cache built
 * artifacts keyed by `${plugin.id}:${plugin.cacheKey(pathname)}`. The
 * negative cache is used to remember `.md` pathnames that don't map to
 * any known route, so a hostile flood of `/foo.md`, `/bar.md`, … doesn't
 * keep re-enumerating sections forever.
 */

import type { CachedEntry } from './etag';

/** Default upper bound for the negative cache (per server instance). */
export const DEFAULT_NEGATIVE_CACHE_MAX = 1024;

export class ArtifactCache {
  private readonly entries = new Map<string, CachedEntry>();
  private readonly negative = new Set<string>();
  private readonly negativeMax: number;

  constructor(opts: { negativeMax?: number } = {}) {
    this.negativeMax = opts.negativeMax ?? DEFAULT_NEGATIVE_CACHE_MAX;
  }

  get(key: string): CachedEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, entry: CachedEntry): void {
    this.entries.set(key, entry);
  }

  /** Has this pathname previously been flagged as a definite miss? */
  isKnownMiss(pathname: string): boolean {
    return this.negative.has(pathname);
  }

  /**
   * Record that `pathname` doesn't map to any artifact. Cheap eviction:
   * we drop the whole set when it hits the cap, so a future genuine miss
   * gets re-seeded on next request.
   */
  rememberMiss(pathname: string): void {
    if (this.negative.size >= this.negativeMax) this.negative.clear();
    this.negative.add(pathname);
  }

  clear(): void {
    this.entries.clear();
    this.negative.clear();
  }
}
