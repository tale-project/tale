/**
 * Runtime release feed behind `GET /api/releases`.
 *
 * The build-time snapshot in `app/generated/releases-manifest.ts` can never
 * carry the newest release: `.github/workflows/release.yml` builds and pushes
 * the web image *before* `create-release` publishes the GitHub release, so a
 * shipped image is always at least one release behind. The server refreshes
 * the list on a TTL and the changelog page swaps it in after hydration; the
 * snapshot stays the prerendered (and offline) fallback.
 *
 * Reliability contract:
 * - `read()` never awaits the network — it returns the best-known list and
 *   kicks a background refresh when the cache went stale, so a slow or dead
 *   api.github.com can never delay or fail a request.
 * - A failed refresh keeps the previous list and backs off for `errorTtlMs`,
 *   which also caps upstream calls well under GitHub's 60-req/hour
 *   unauthenticated limit (one refresh = `maxPages` requests).
 */

import { fetchGithubReleases } from './fetch-github';
import type { Release } from './types';

/** 30 min of freshness ≈ 4 upstream requests/hour at 2 pages per refresh. */
const DEFAULT_TTL_MS = 30 * 60 * 1000;
/** Back-off after a failed refresh — ≈24 requests/hour worst case. */
const DEFAULT_ERROR_TTL_MS = 5 * 60 * 1000;
/** Shorter than the build script's: this runs on a request path. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ReleaseFeedPayload {
  releases: readonly Release[];
  /** When this list was obtained (ISO 8601). */
  fetchedAt: string;
  /** `live` once a refresh landed; `snapshot` while serving the build-time list. */
  source: 'live' | 'snapshot';
}

export interface ReleaseFeedOptions {
  /** Build-time list served until the first refresh lands. */
  snapshot: readonly Release[];
  /** `RELEASES_FETCHED_AT` from the generated manifest. */
  snapshotFetchedAt: string;
  ttlMs?: number;
  errorTtlMs?: number;
  maxPages?: number;
  timeoutMs?: number;
  /** Seams for tests. */
  fetchImpl?: typeof fetch;
  fetchReleases?: typeof fetchGithubReleases;
  now?: () => number;
}

export interface ReleaseFeed {
  /** Best-known list. Synchronous: never blocks on GitHub. */
  read(): ReleaseFeedPayload;
  /** Refresh now (concurrent calls share one in-flight fetch). Never rejects. */
  refresh(): Promise<void>;
}

export function createReleaseFeed(options: ReleaseFeedOptions): ReleaseFeed {
  const {
    snapshot,
    snapshotFetchedAt,
    ttlMs = DEFAULT_TTL_MS,
    errorTtlMs = DEFAULT_ERROR_TTL_MS,
    maxPages = 2,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl,
    fetchReleases = fetchGithubReleases,
    now = Date.now,
  } = options;

  const fallback: ReleaseFeedPayload = {
    releases: snapshot,
    fetchedAt: snapshotFetchedAt,
    source: 'snapshot',
  };

  let cached: ReleaseFeedPayload | null = null;
  let staleAt = 0;
  let inFlight: Promise<void> | null = null;

  async function run(): Promise<void> {
    try {
      const releases = await fetchReleases({
        maxPages,
        timeoutMs,
        fetchImpl,
      });
      // An empty list means the query worked but told us nothing useful —
      // treat it as a failure so we keep the snapshot instead of blanking
      // the changelog.
      if (releases.length === 0) {
        throw new Error('GitHub returned no releases');
      }
      cached = {
        releases,
        fetchedAt: new Date(now()).toISOString(),
        source: 'live',
      };
      staleAt = now() + ttlMs;
    } catch (cause) {
      staleAt = now() + errorTtlMs;
      console.warn(
        `[releases] refresh failed — serving ${cached ? 'the last good list' : 'the build-time snapshot'}, retrying in ${Math.round(errorTtlMs / 1000)}s`,
        cause,
      );
    }
  }

  function refresh(): Promise<void> {
    inFlight ??= run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    read() {
      if (now() >= staleAt) {
        // Fire-and-forget: `run()` swallows its own failures, so this can
        // never surface as an unhandled rejection.
        void refresh();
      }
      return cached ?? fallback;
    },
    refresh,
  };
}
