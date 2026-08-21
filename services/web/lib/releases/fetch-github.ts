/**
 * Paged GitHub Releases fetch, shared by the build-time snapshot script
 * (`scripts/fetch-releases.ts`) and the runtime feed (`lib/releases/feed.ts`)
 * so both agree on paging, headers, and timeouts.
 */

import { mapGithubApiReleases } from './parse-github-api';
import type { Release } from './types';

const RELEASES_API = 'https://api.github.com/repos/tale-project/tale/releases';

/** GitHub's max page size for this endpoint. */
export const RELEASES_PER_PAGE = 30;

export interface FetchGithubReleasesOptions {
  /** How many pages of `RELEASES_PER_PAGE` to walk before stopping. */
  maxPages?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Optional PAT — raises the 60-req/hour unauthenticated rate limit. */
  token?: string;
  /** Seam for tests. */
  fetchImpl?: typeof fetch;
}

interface FetchPageOptions extends Required<
  Omit<FetchGithubReleasesOptions, 'maxPages' | 'token'>
> {
  page: number;
  token: string | undefined;
}

async function fetchPage({
  page,
  timeoutMs,
  token,
  fetchImpl,
}: FetchPageOptions): Promise<unknown[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'tale-web-releases/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(
    `${RELEASES_API}?per_page=${RELEASES_PER_PAGE}&page=${page}`,
    { headers, signal: AbortSignal.timeout(timeoutMs) },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub releases API page ${page} failed: ${response.status}`,
    );
  }
  const json: unknown = await response.json();
  if (!Array.isArray(json)) {
    throw new Error(`GitHub releases API page ${page} returned non-array`);
  }
  return json;
}

/**
 * Newest-first releases from the GitHub API. Throws on any transport, HTTP,
 * or shape failure — each caller decides how to degrade (the script fails the
 * build step, the runtime feed keeps serving its last good list).
 */
export async function fetchGithubReleases({
  maxPages = 2,
  timeoutMs = 20_000,
  token,
  fetchImpl = fetch,
}: FetchGithubReleasesOptions = {}): Promise<Release[]> {
  const raw: unknown[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await fetchPage({ page, timeoutMs, token, fetchImpl });
    if (batch.length === 0) break;
    raw.push(...batch);
    if (batch.length < RELEASES_PER_PAGE) break;
  }
  return mapGithubApiReleases(
    raw as Parameters<typeof mapGithubApiReleases>[0],
  );
}
