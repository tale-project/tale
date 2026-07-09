/**
 * Build-time fetch of GitHub Releases → `app/generated/releases-manifest.ts`.
 * Same source of truth as the platform changelog viewer; marketing prerenders
 * a snapshot so the static site never calls Convex or GitHub at request time.
 *
 * Usage: `bun run --filter @tale/web fetch-releases`
 * Wired into `build` before prerender.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mapGithubApiReleases } from '../lib/releases/parse-github-api';
import type { Release } from '../lib/releases/types';
import { writeReleasesManifest } from '../lib/releases/write-manifest';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '../app/generated/releases-manifest.ts');
const API =
  'https://api.github.com/repos/tale-project/tale/releases?per_page=30';
const MAX_PAGES = 2;

async function fetchPage(page: number): Promise<unknown[]> {
  const url = `${API}&page=${page}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'tale-web-fetch-releases/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
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

async function main(): Promise<void> {
  const raw: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await fetchPage(page);
    if (batch.length === 0) break;
    raw.push(...batch);
    if (batch.length < 30) break;
  }

  const releases: Release[] = mapGithubApiReleases(
    raw as Parameters<typeof mapGithubApiReleases>[0],
  );
  const fetchedAt = new Date().toISOString();

  await writeReleasesManifest(OUT, releases, fetchedAt);
  console.log(
    `[fetch-releases] wrote ${releases.length} releases → ${OUT} (${fetchedAt})`,
  );
}

await main();
