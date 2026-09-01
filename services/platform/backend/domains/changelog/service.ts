import { compareVersions } from '../../../lib/compare-versions.ts';
import { fetchReleasesPageImpl } from '../../core/changelog/internal_actions.ts';

/**
 * The in-app changelog — the 0.5 twin of `convex/changelog/*`: the GitHub
 * releases HTML pages (no API rate limit) fetched behind a per-page 1h
 * in-process TTL cache; the orchestration pages until `from` is reached
 * (page-1 failures bubble, later pages degrade to a partial list).
 */

export interface Release {
  tag: string;
  version: string;
  name: string | null;
  body: string | null;
  htmlUrl: string;
  publishedAt: string | null;
}

const PAGE_TTL_MS = 60 * 60 * 1000;
const MAX_PAGES = 3;

type PageFetcher = (page: number) => Promise<Release[]>;

const pageCache = new Map<number, { at: number; releases: Release[] }>();

async function cachedPage(
  page: number,
  fetcher: PageFetcher,
): Promise<Release[]> {
  const cached = pageCache.get(page);
  if (cached && Date.now() - cached.at < PAGE_TTL_MS) {
    return cached.releases;
  }
  const releases = await fetcher(page);
  pageCache.set(page, { at: Date.now(), releases });
  return releases;
}

/** Releases newest-first, paged until `from` (the viewer's current version)
 * is reached — at most 3 pages; older history falls through to the "view on
 * GitHub" card. */
export async function listReleases(
  options: { from?: string; fetcher?: PageFetcher } = {},
): Promise<Release[]> {
  // A caller-supplied fetcher owns its own caching (tests, previews) — only
  // the default GitHub fetch shares the process-wide page cache.
  const fetcher = options.fetcher;
  const from = options.from;
  const collected: Release[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    let releases: Release[];
    try {
      releases =
        fetcher !== undefined
          ? await fetcher(page)
          : await cachedPage(page, fetchReleasesPageImpl);
    } catch (err) {
      if (page === 1) throw err;
      console.warn(
        `changelog: page ${page} fetch failed, returning partial`,
        err,
      );
      break;
    }
    if (releases.length === 0) break;
    for (const release of releases) {
      if (seen.has(release.tag)) continue;
      seen.add(release.tag);
      collected.push(release);
    }
    if (from === undefined || from === '') break;
    const oldest = releases[releases.length - 1]?.version ?? '';
    try {
      if (compareVersions(oldest, from) <= 0) break;
    } catch (err) {
      console.warn(
        `changelog: unparseable version while paging (oldest=${oldest}, from=${from})`,
        err,
      );
      break;
    }
  }
  return collected;
}
