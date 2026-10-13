/**
 * The published-address ledger of a documentation site: every page slug the
 * site has ever served, in URL form (`index` for the front page, no trailing
 * `/index`). It is append-only — the content build records new pages, and a
 * slug never leaves — so a site's tests can require every recorded slug to
 * keep answering, as a page or through a redirect. A page that moves or goes
 * away without a redirect then fails CI instead of turning its old links,
 * bookmarks and search results into 404s. Build-time and test-time only.
 */

import { readFile, writeFile } from 'node:fs/promises';

import { slugRoute } from './redirects';

/** The URL-form slug of a content slug: `platform/index` → `platform`. */
export function publishedSlug(slug: string): string {
  return slugRoute(slug) || 'index';
}

interface Ledger {
  [key: string]: unknown;
  slugs: string[];
}

/** A parsed ledger file, validated: its slugs, and every other key kept. */
function readLedger(value: unknown, file: string): Ledger {
  const invalid = new Error(
    `${file} must be an object with a "slugs" string array`,
  );
  if (typeof value !== 'object' || value === null || !('slugs' in value)) {
    throw invalid;
  }
  const { slugs } = value;
  if (!Array.isArray(slugs)) throw invalid;
  const strings: string[] = [];
  for (const slug of slugs) {
    if (typeof slug !== 'string') throw invalid;
    strings.push(slug);
  }
  return { ...value, slugs: strings };
}

/** Validate a parsed ledger file and return its slugs. */
export function parsePublished(
  value: unknown,
  file = 'published.json',
): string[] {
  return readLedger(value, file).slugs;
}

/** Why a ledger entry is not in URL form, or null when it is. */
export function publishedSlugProblem(slug: string): string | null {
  if (slug === '') return 'is empty';
  if (slug.startsWith('/') || slug.endsWith('/')) {
    return 'carries a leading or trailing slash';
  }
  if (slug !== 'index' && slug.endsWith('/index')) {
    return 'ends in /index (record the section URL)';
  }
  return null;
}

/**
 * Add the slugs a build publishes to the ledger at `file`, keeping it sorted;
 * existing entries are never removed. Returns the slugs it added.
 */
export async function recordPublishedSlugs(
  file: string,
  slugs: readonly string[],
): Promise<string[]> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  const ledger = readLedger(parsed, file);
  const known = new Set(ledger.slugs);
  const added = [...new Set(slugs.map(publishedSlug))].filter(
    (slug) => !known.has(slug),
  );
  if (added.length === 0) return [];
  const next = { ...ledger, slugs: [...known, ...added].sort() };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return added;
}
