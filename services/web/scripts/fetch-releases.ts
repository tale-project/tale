/**
 * Build-time fetch of GitHub Releases → `app/generated/releases-manifest.ts`.
 * The snapshot is what the prerendered HTML and the SEO/LLM artifacts carry;
 * the live page refreshes it at runtime via `/api/releases` (see
 * `lib/releases/feed.ts`), because release images are built before the GitHub
 * release exists.
 *
 * Usage: `bun run --filter @tale/web fetch-releases [--no-format]`
 * `--no-format` skips oxfmt — for the Docker builder, where the dev formatter
 * is not part of the contract and only the generated content matters.
 * Wired into `build` before prerender.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchGithubReleases } from '../lib/releases/fetch-github';
import { writeReleasesManifest } from '../lib/releases/write-manifest';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '../app/generated/releases-manifest.ts');
const MAX_PAGES = 2;

async function main(): Promise<void> {
  const format = !process.argv.includes('--no-format');
  const releases = await fetchGithubReleases({
    maxPages: MAX_PAGES,
    token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  });
  if (releases.length === 0) {
    throw new Error(
      'GitHub returned no releases — refusing to write an empty manifest',
    );
  }
  const fetchedAt = new Date().toISOString();

  await writeReleasesManifest(OUT, releases, fetchedAt, { format });
  console.log(
    `[fetch-releases] wrote ${releases.length} releases → ${OUT} (${fetchedAt})`,
  );
}

await main();
